const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin2026';

const DATA_DIR = path.join(__dirname, 'data');
const FIXTURES_FILE = path.join(DATA_DIR, 'fixtures.json');
const PREDICTIONS_FILE = path.join(DATA_DIR, 'predictions.json');
const RESULTS_FILE = path.join(DATA_DIR, 'results.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function readJSON(filePath, defaultValue = {}) {
  if (!fs.existsSync(filePath)) return defaultValue;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return defaultValue;
  }
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function isRoundLocked(round, fixtures) {
  const lockTime = fixtures.lockDates?.[String(round)];
  if (!lockTime) return false;
  return new Date() >= new Date(lockTime);
}

function getMatchRound(matchId, fixtures) {
  for (const group of Object.values(fixtures.groups || {})) {
    const match = (group.matches || []).find(m => m.id === matchId);
    if (match) return match.round;
  }
  for (const [roundKey, round] of Object.entries(fixtures.knockout || {})) {
    const match = (round.matches || []).find(m => m.id === matchId);
    if (match) return roundKey;
  }
  return null;
}

// ── Knockout bracket auto-resolution ─────────────────────────────────────────

function calcGroupStandings(teams, matches, results) {
  const stats = {};
  teams.forEach(t => {
    stats[t.id] = { team: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
  });
  matches.forEach(m => {
    const r = results[m.id];
    if (!r?.played) return;
    const h = r.home, a = r.away;
    const hs = stats[m.home], as = stats[m.away];
    if (!hs || !as) return;
    hs.p++; as.p++;
    hs.gf += h; hs.ga += a;
    as.gf += a; as.ga += h;
    if (h > a)      { hs.w++; hs.pts += 3; as.l++; }
    else if (h < a) { as.w++; as.pts += 3; hs.l++; }
    else            { hs.d++; hs.pts++;    as.d++; as.pts++; }
  });
  return Object.values(stats).sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    const gdB = b.gf - b.ga, gdA = a.gf - a.ga;
    if (gdB !== gdA) return gdB - gdA;
    return b.gf - a.gf;
  });
}

function findTeamById(fixtures, id) {
  for (const group of Object.values(fixtures.groups || {})) {
    const t = group.teams.find(t => t.id === id);
    if (t) return t;
  }
  return null;
}

function resolveSlot(slot, slotMap, resolvedMatches, results) {
  if (!slot) return null;
  if (slotMap[slot] !== undefined) return slotMap[slot];
  const m = slot.match(/^([WL]):(.+)$/);
  if (m) {
    const [, type, matchId] = m;
    const resolved = resolvedMatches[matchId];
    if (!resolved) return null;
    const result = results[matchId];
    if (!result?.played) return null;
    if (result.home > result.away) return type === 'W' ? resolved.home : resolved.away;
    if (result.away > result.home) return type === 'W' ? resolved.away : resolved.home;
    return null; // draw — shouldn't occur in knockout
  }
  return null;
}

function resolveKnockoutFixtures(fixtures, results) {
  if (!fixtures.knockout) return fixtures;

  // Build slot map from group standings: "1A" → teamId, "2B" → teamId, "3rd_N" → teamId
  const slotMap = {};
  const thirdPlaceTeams = [];

  for (const [groupKey, group] of Object.entries(fixtures.groups || {})) {
    const rows = calcGroupStandings(group.teams, group.matches, results);
    if (rows[0]) slotMap[`1${groupKey}`] = rows[0].team.id;
    if (rows[1]) slotMap[`2${groupKey}`] = rows[1].team.id;
    if (rows[2]) thirdPlaceTeams.push({
      team: rows[2].team, pts: rows[2].pts,
      gd: rows[2].gf - rows[2].ga, gf: rows[2].gf
    });
  }

  // Rank best 8 third-place teams
  thirdPlaceTeams.sort((a, b) =>
    b.pts !== a.pts ? b.pts - a.pts :
    b.gd  !== a.gd  ? b.gd  - a.gd  :
    b.gf  - a.gf
  );
  thirdPlaceTeams.slice(0, 8).forEach((t, i) => { slotMap[`3rd_${i + 1}`] = t.team.id; });

  // Resolve each round in bracket order
  const resolvedMatches = {};
  for (const roundKey of ['R32', 'R16', 'QF', 'SF', '3P', 'F']) {
    const round = fixtures.knockout[roundKey];
    if (!round) continue;
    for (const match of round.matches) {
      const homeId = resolveSlot(match.homeSlot, slotMap, resolvedMatches, results);
      const awayId = resolveSlot(match.awaySlot, slotMap, resolvedMatches, results);
      resolvedMatches[match.id] = { home: homeId, away: awayId };
      match.home = homeId || null;
      match.away = awayId || null;
      const ht = homeId ? findTeamById(fixtures, homeId) : null;
      const at = awayId ? findTeamById(fixtures, awayId) : null;
      match.homeLabel = ht ? `${ht.flag} ${ht.name}` : (match.homeSlot || 'TBD');
      match.awayLabel = at ? `${at.flag} ${at.name}` : (match.awaySlot || 'TBD');
    }
  }
  return fixtures;
}

// ── Admin verify ─────────────────────────────────────────────────────────────

app.get('/api/admin/verify', (req, res) => {
  if (req.headers['x-admin-password'] !== ADMIN_PASSWORD)
    return res.status(401).json({ error: 'Unauthorized' });
  res.json({ ok: true });
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

app.get('/api/fixtures', (req, res) => {
  const fixtures = readJSON(FIXTURES_FILE, { groups: {}, lockDates: {} });
  const results  = readJSON(RESULTS_FILE,  { results: {} }).results || {};
  res.json(resolveKnockoutFixtures(fixtures, results));
});

// ── Lock status ───────────────────────────────────────────────────────────────

app.get('/api/lock-status', (req, res) => {
  const fixtures = readJSON(FIXTURES_FILE, { lockDates: {} });
  const status = {};
  for (const [round, lockTime] of Object.entries(fixtures.lockDates || {})) {
    status[round] = { locked: new Date() >= new Date(lockTime), lockTime };
  }
  res.json(status);
});

// ── Users / registration ──────────────────────────────────────────────────────

app.get('/api/users', (req, res) => {
  const data = readJSON(PREDICTIONS_FILE, { users: [] });
  res.json(data.users.map(u => ({ id: u.id, name: u.name })));
});

app.post('/api/register', (req, res) => {
  const { name, pin } = req.body;
  if (!name || !pin) return res.status(400).json({ error: 'Name and PIN required' });

  const data = readJSON(PREDICTIONS_FILE, { users: [] });
  const existing = data.users.find(u => u.name.toLowerCase() === name.toLowerCase());

  if (existing) {
    if (String(existing.pin) !== String(pin))
      return res.status(401).json({ error: 'Incorrect PIN for that name' });
    return res.json({ userId: existing.id, name: existing.name });
  }

  const userId = `user_${Date.now()}`;
  data.users.push({
    id: userId,
    name: name.trim(),
    pin: String(pin),
    predictions: {},
    registeredAt: new Date().toISOString()
  });
  writeJSON(PREDICTIONS_FILE, data);
  res.json({ userId, name: name.trim() });
});

// ── Predictions ───────────────────────────────────────────────────────────────

app.get('/api/predictions', (req, res) => {
  const data = readJSON(PREDICTIONS_FILE, { users: [] });
  res.json(data.users.map(u => ({ id: u.id, name: u.name, predictions: u.predictions })));
});

app.get('/api/predictions/:userId', (req, res) => {
  const data = readJSON(PREDICTIONS_FILE, { users: [] });
  const user = data.users.find(u => u.id === req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ id: user.id, name: user.name, predictions: user.predictions });
});

app.post('/api/predictions/:userId', (req, res) => {
  const { predictions } = req.body;
  const fixtures = readJSON(FIXTURES_FILE, { groups: {}, lockDates: {} });
  const data = readJSON(PREDICTIONS_FILE, { users: [] });

  const user = data.users.find(u => u.id === req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const updated = { ...user.predictions };
  for (const [matchId, score] of Object.entries(predictions)) {
    const round = getMatchRound(matchId, fixtures);
    if (round && !isRoundLocked(round, fixtures)) {
      updated[matchId] = { home: parseInt(score.home) || 0, away: parseInt(score.away) || 0 };
    }
  }

  user.predictions = updated;
  user.lastUpdated = new Date().toISOString();
  writeJSON(PREDICTIONS_FILE, data);
  res.json({ success: true, saved: Object.keys(updated).length });
});

// ── Results (admin) ───────────────────────────────────────────────────────────

app.get('/api/results', (req, res) => {
  res.json(readJSON(RESULTS_FILE, { results: {} }));
});

app.post('/api/results', (req, res) => {
  if (req.headers['x-admin-password'] !== ADMIN_PASSWORD)
    return res.status(401).json({ error: 'Unauthorized' });

  const { matchId, homeGoals, awayGoals } = req.body;
  if (!matchId || homeGoals === undefined || awayGoals === undefined)
    return res.status(400).json({ error: 'matchId, homeGoals, awayGoals required' });

  const data = readJSON(RESULTS_FILE, { results: {} });
  data.results[matchId] = {
    home: parseInt(homeGoals),
    away: parseInt(awayGoals),
    played: true,
    recordedAt: new Date().toISOString()
  };
  writeJSON(RESULTS_FILE, data);
  res.json({ success: true });
});

app.delete('/api/results/:matchId', (req, res) => {
  if (req.headers['x-admin-password'] !== ADMIN_PASSWORD)
    return res.status(401).json({ error: 'Unauthorized' });

  const data = readJSON(RESULTS_FILE, { results: {} });
  delete data.results[req.params.matchId];
  writeJSON(RESULTS_FILE, data);
  res.json({ success: true });
});

// ── Leaderboard ───────────────────────────────────────────────────────────────

app.get('/api/leaderboard', (req, res) => {
  const users = readJSON(PREDICTIONS_FILE, { users: [] }).users;
  const results = readJSON(RESULTS_FILE, { results: {} }).results;

  const board = users.map(user => {
    let pts = 0, correctResults = 0, correctScores = 0;
    const matchPoints = {};

    for (const [matchId, result] of Object.entries(results)) {
      if (!result.played) continue;
      const pred = user.predictions[matchId];
      if (!pred) continue;

      const actualSign = Math.sign(result.home - result.away);
      const predSign = Math.sign(pred.home - pred.away);
      let p = 0;

      if (actualSign === predSign) {
        p += 3;
        correctResults++;
        if (pred.home === result.home && pred.away === result.away) {
          p += 2;
          correctScores++;
        }
      }

      matchPoints[matchId] = p;
      pts += p;
    }

    return {
      id: user.id,
      name: user.name,
      totalPoints: pts,
      correctResults,
      correctScores,
      matchPoints,
      predictionsEntered: Object.keys(user.predictions).length
    };
  }).sort((a, b) => b.totalPoints - a.totalPoints);

  res.json(board);
});

// ── Profile ───────────────────────────────────────────────────────────────────

function calcLeaderboard() {
  const users = readJSON(PREDICTIONS_FILE, { users: [] }).users;
  const results = readJSON(RESULTS_FILE, { results: {} }).results;

  return users.map(user => {
    let pts = 0, correctResults = 0, correctScores = 0;
    const matchPoints = {};

    for (const [matchId, result] of Object.entries(results)) {
      if (!result.played) continue;
      const pred = user.predictions[matchId];
      if (!pred) continue;

      const actualSign = Math.sign(result.home - result.away);
      const predSign = Math.sign(pred.home - pred.away);
      let p = 0;

      if (actualSign === predSign) {
        p += 3;
        correctResults++;
        if (pred.home === result.home && pred.away === result.away) {
          p += 2;
          correctScores++;
        }
      }

      matchPoints[matchId] = p;
      pts += p;
    }

    return {
      id: user.id,
      name: user.name,
      totalPoints: pts,
      correctResults,
      correctScores,
      matchPoints,
      predictionsEntered: Object.keys(user.predictions).length
    };
  }).sort((a, b) => b.totalPoints - a.totalPoints);
}

app.get('/api/profile/:userId', (req, res) => {
  const data = readJSON(PREDICTIONS_FILE, { users: [] });
  const user = data.users.find(u => u.id === req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const board = calcLeaderboard();
  const rank = board.findIndex(u => u.id === req.params.userId) + 1;
  const entry = board.find(u => u.id === req.params.userId) || {};

  res.json({
    id: user.id,
    name: user.name,
    displayName: user.displayName || user.name,
    bio: user.bio || '',
    avatar: user.avatar || null,
    joinedAt: user.registeredAt,
    stats: {
      totalPoints: entry.totalPoints || 0,
      rank,
      totalPlayers: board.length,
      correctResults: entry.correctResults || 0,
      correctScores: entry.correctScores || 0,
      predictionsEntered: entry.predictionsEntered || 0
    },
    matchPoints: entry.matchPoints || {}
  });
});

app.post('/api/profile/:userId/update', (req, res) => {
  const { pin, displayName, bio } = req.body;
  const data = readJSON(PREDICTIONS_FILE, { users: [] });
  const user = data.users.find(u => u.id === req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (String(user.pin) !== String(pin)) return res.status(401).json({ error: 'Incorrect PIN' });
  if (!displayName || !displayName.trim()) return res.status(400).json({ error: 'Display name required' });

  user.displayName = displayName.trim();
  if (bio !== undefined) user.bio = String(bio).slice(0, 200);
  writeJSON(PREDICTIONS_FILE, data);
  res.json({ success: true });
});

app.post('/api/profile/:userId/avatar', (req, res) => {
  const { pin, avatar } = req.body;
  const data = readJSON(PREDICTIONS_FILE, { users: [] });
  const user = data.users.find(u => u.id === req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (String(user.pin) !== String(pin)) return res.status(401).json({ error: 'Incorrect PIN' });
  if (!avatar || !avatar.startsWith('data:image/')) return res.status(400).json({ error: 'Invalid image' });
  if (avatar.length > 250000) return res.status(400).json({ error: 'Image too large — please use a smaller photo' });

  user.avatar = avatar;
  writeJSON(PREDICTIONS_FILE, data);
  res.json({ success: true });
});

// ── Change PIN ────────────────────────────────────────────────────────────────

app.post('/api/users/:userId/change-pin', (req, res) => {
  const { currentPin, newPin } = req.body;
  const data = readJSON(PREDICTIONS_FILE, { users: [] });
  const user = data.users.find(u => u.id === req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (String(user.pin) !== String(currentPin)) return res.status(401).json({ error: 'Current PIN incorrect' });
  if (!/^\d{4}$/.test(String(newPin))) return res.status(400).json({ error: 'New PIN must be exactly 4 digits' });

  user.pin = String(newPin);
  writeJSON(PREDICTIONS_FILE, data);
  res.json({ success: true });
});

// ── Reset predictions ─────────────────────────────────────────────────────────

app.post('/api/predictions/:userId/reset', (req, res) => {
  const { pin } = req.body;
  const data = readJSON(PREDICTIONS_FILE, { users: [] });
  const user = data.users.find(u => u.id === req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (String(user.pin) !== String(pin)) return res.status(401).json({ error: 'Incorrect PIN' });

  user.predictions = {};
  user.lastUpdated = new Date().toISOString();
  writeJSON(PREDICTIONS_FILE, data);
  res.json({ success: true });
});

// ── Delete user ───────────────────────────────────────────────────────────────

app.delete('/api/users/:userId', (req, res) => {
  const { pin } = req.body;
  const data = readJSON(PREDICTIONS_FILE, { users: [] });
  const idx = data.users.findIndex(u => u.id === req.params.userId);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  if (String(data.users[idx].pin) !== String(pin)) return res.status(401).json({ error: 'Incorrect PIN' });

  data.users.splice(idx, 1);
  writeJSON(PREDICTIONS_FILE, data);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`⚽  World Cup 2026 running at http://localhost:${PORT}`);
  console.log(`🔑  Admin password: ${ADMIN_PASSWORD}`);
});
