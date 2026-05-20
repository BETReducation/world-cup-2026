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
  return null;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

app.get('/api/fixtures', (req, res) => {
  res.json(readJSON(FIXTURES_FILE, { groups: {}, lockDates: {} }));
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
