const express    = require('express');
const fs         = require('fs');
const path       = require('path');
const cors       = require('cors');
const crypto     = require('crypto');
const nodemailer = require('nodemailer');

const app  = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin2026';

// ── Paths ──────────────────────────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, 'data');

// In production (Railway) set PERSISTENT_DATA_DIR to a mounted volume path
// so predictions and results survive redeployments.
const PERSISTENT_DIR = process.env.PERSISTENT_DATA_DIR
  ? path.resolve(process.env.PERSISTENT_DATA_DIR)
  : DATA_DIR;

if (!fs.existsSync(PERSISTENT_DIR)) fs.mkdirSync(PERSISTENT_DIR, { recursive: true });

const FIXTURES_FILE    = path.join(DATA_DIR,       'fixtures.json');
const PREDICTIONS_FILE = path.join(PERSISTENT_DIR, 'predictions.json');
const RESULTS_FILE     = path.join(PERSISTENT_DIR, 'results.json');
const ACCESS_CODES_FILE = path.join(PERSISTENT_DIR, 'access-codes.json');
const SESSIONS_FILE     = path.join(PERSISTENT_DIR, 'sessions.json');
const BONUS_FILE        = path.join(PERSISTENT_DIR, 'bonus-extras.json');

const ADMIN_EMAIL = 'gbyatt@gmail.com';

// ── One-time invite codes (50 footballer name mashups) ─────────────────────────

const INITIAL_ACCESS_CODES = [
  'Cristiano Maldini',    'Lionel Ronaldo',       'Zinedine Lampard',
  'Thierry Ibrahimovic',  'Didier Pirlo',          'Frank Torres',
  'Steven Zidane',        'Wayne Iniesta',          'Fernando Gerrard',
  'Andres Rooney',        'Cesc Buffon',            'Zlatan Fabregas',
  'Arjen Henry',          'Samuel Beckham',         'Pavel Drogba',
  'Michael Totti',        'Patrick Bale',           'Hidetoshi Messi',
  'David Nedved',         'Dimitar Ribery',         'Sergio Robben',
  'Iker Hazard',          'Gianluigi Suarez',       'Andrea Salah',
  'Gareth Seedorf',       'Eden Cannavaro',         'Luis Vieira',
  'Virgil van Ballack',   'Mohamed Scholes',        'Sadio Nesta',
  'Luka Del Piero',       'Toni van Nistelrooy',    'Thomas Essien',
  'Franck Bergkamp',      'Alessandro Aguero',      'Paolo Modric',
  'Francesco Berbatov',   'Ruud Gattuso',           'Juan Makelele',
  'Diego Sneijder',       'Kaka Terry',             'Roberto Ferdinand',
  'Ronaldinho Neville',   'Xavi Muller',            'Petr Mane',
  'Rio Casillas',         'Raul van Persie',         'Robbie Nakata',
  'John Eto',             'Dennis Gerrard'
];

// ── Startup seeding ────────────────────────────────────────────────────────────

function seedAdminAccount() {
  const data  = readJSON(PREDICTIONS_FILE, { users: [] });
  const admin = data.users.find(u => u.email && u.email.toLowerCase() === ADMIN_EMAIL);
  if (admin) {
    if (!admin.isAdmin) {
      admin.isAdmin = true;
      writeJSON(PREDICTIONS_FILE, data);
      console.log(`✅  Admin flag added to existing account: ${ADMIN_EMAIL}`);
    }
    return;
  }
  // Create fresh admin account
  const adminPw = process.env.ADMIN_USER_PASSWORD || crypto.randomBytes(8).toString('hex');
  const userId  = 'user_' + crypto.randomBytes(8).toString('hex');
  const salt    = crypto.randomBytes(16).toString('hex');
  data.users.push({
    id: userId, name: 'Gary', email: ADMIN_EMAIL,
    passwordSalt: salt, passwordHash: hashStr(adminPw, salt),
    isAdmin: true, predictions: {}, registeredAt: new Date().toISOString()
  });
  writeJSON(PREDICTIONS_FILE, data);
  if (!process.env.ADMIN_USER_PASSWORD) {
    console.log(`\n⚑   ADMIN ACCOUNT CREATED`);
    console.log(`    Email:    ${ADMIN_EMAIL}`);
    console.log(`    Password: ${adminPw}`);
    console.log(`    ⚠️  Change this after first sign-in!\n`);
  } else {
    console.log(`✅  Admin account created for ${ADMIN_EMAIL}`);
  }
}

function seedAccessCodes() {
  // Seed if file is missing OR exists but has a broken/non-array codes field
  if (fs.existsSync(ACCESS_CODES_FILE)) {
    const existing = readJSON(ACCESS_CODES_FILE, null);
    if (existing && Array.isArray(existing.codes)) return; // looks healthy, skip
    console.warn('⚠️   access-codes.json exists but has unexpected structure — re-seeding');
  }
  writeJSON(ACCESS_CODES_FILE, {
    codes: INITIAL_ACCESS_CODES.map(code => ({ code, used: false, usedBy: null, usedAt: null }))
  });
  console.log(`✅  ${INITIAL_ACCESS_CODES.length} invite codes seeded`);
}

app.use(cors());
app.use(express.json({ limit: '400kb' }));

// JS and CSS: always revalidate so browsers + Cloudflare never serve
// stale versions after a deploy. ETags still let the browser skip the
// download when nothing changed (304 Not Modified).
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// ── Health check (used by Railway to confirm startup) ─────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// ── Email ──────────────────────────────────────────────────────────────────────
// Provider priority (first one configured wins):
//   1. Resend  — set RESEND_API_KEY  (uses HTTPS API, not SMTP — works on Railway)
//   2. Gmail   — set GMAIL_USER + GMAIL_APP_PASSWORD  (requires App Password)
// Also set APP_URL to your public URL so reset links work.
// Set MAIL_FROM to override the sender address (e.g. "WC26 <admin@wc26.win>").

const emailEnabled = !!(process.env.RESEND_API_KEY || (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD));

// Gmail fallback only — Resend uses its HTTP API directly (no SMTP needed)
let gmailMailer = null;
if (!process.env.RESEND_API_KEY && process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
  gmailMailer = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    connectionTimeout: 10000,
    socketTimeout:     10000
  });
}

function getFromAddress() {
  if (process.env.MAIL_FROM) return process.env.MAIL_FROM;
  if (process.env.RESEND_API_KEY) return '"WC26 Prediction League" <onboarding@resend.dev>';
  if (process.env.GMAIL_USER)     return `"WC26 Prediction League" <${process.env.GMAIL_USER}>`;
  return '"WC26 Prediction League" <noreply@example.com>';
}

const EMAIL_TEXT = (name, resetLink) =>
  `Hi ${name},\n\nWe received a request to reset your WC26 Prediction League password.\n\nClick the link below to set a new password. This link expires in 1 hour.\n\n${resetLink}\n\nIf you didn't request this, you can safely ignore this email.\n\n— WC26 Prediction League`;

const EMAIL_HTML = (name, resetLink) => `
  <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0b0f1a;color:#e2e8f4;border-radius:12px;">
    <h2 style="font-size:20px;font-weight:700;margin:0 0 8px;color:#4dc97a;">WC26 Prediction League</h2>
    <p style="margin:0 0 20px;color:#6b7a99;font-size:14px;">Password reset request</p>
    <p style="margin:0 0 16px;">Hi <strong>${name}</strong>,</p>
    <p style="margin:0 0 24px;color:#a0aec0;">We received a request to reset your password. Click the button below — the link expires in <strong>1 hour</strong>.</p>
    <a href="${resetLink}" style="display:inline-block;padding:12px 28px;background:#4dc97a;color:#0b0f1a;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;">Reset my password →</a>
    <p style="margin:24px 0 0;font-size:12px;color:#6b7a99;">If you didn't request this, you can safely ignore this email. Your password won't change.</p>
  </div>`;

async function sendPasswordResetEmail(to, name, resetLink) {
  if (!emailEnabled) throw new Error('Email is not configured on this server.');

  // ── Resend HTTP API (bypasses SMTP — works on Railway) ───────────────────
  if (process.env.RESEND_API_KEY) {
    const r = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from:    getFromAddress(),
        to:      [to],
        subject: 'WC26 — Reset your password',
        text:    EMAIL_TEXT(name, resetLink),
        html:    EMAIL_HTML(name, resetLink)
      })
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.message || `Resend API error ${r.status}`);
    }
    return;
  }

  // ── Gmail fallback (nodemailer) ───────────────────────────────────────────
  if (gmailMailer) {
    await gmailMailer.sendMail({
      from: getFromAddress(), to,
      subject: 'WC26 — Reset your password',
      text:    EMAIL_TEXT(name, resetLink),
      html:    EMAIL_HTML(name, resetLink)
    });
    return;
  }

  throw new Error('No email provider configured.');
}

// ── JSON helpers ───────────────────────────────────────────────────────────────

function readJSON(filePath, defaultValue = {}) {
  if (!fs.existsSync(filePath)) return defaultValue;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return defaultValue; }
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ── Input sanitisation ────────────────────────────────────────────────────────

function sanitise(str, maxLen) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').trim().slice(0, maxLen);
}

// ── Password hashing (PBKDF2 via Node built-in crypto) ────────────────────────

function hashStr(value, salt) {
  return crypto.pbkdf2Sync(String(value), salt, 100_000, 32, 'sha256').toString('hex');
}

// Checks a submitted password against a user record.
// Supports new passwordSalt/passwordHash fields, legacy hashed PINs (pinSalt/pinHash),
// and legacy plaintext PINs — enabling transparent migration.
function checkPassword(input, user) {
  if (user.passwordSalt && user.passwordHash)
    return hashStr(input, user.passwordSalt) === user.passwordHash;
  if (user.pinSalt && user.pinHash)                       // legacy hashed PIN
    return hashStr(input, user.pinSalt)     === user.pinHash;
  if (user.pin !== undefined)                             // legacy plaintext PIN
    return String(user.pin) === String(input);
  return false;
}

// Writes a new hashed password onto a user record and removes legacy PIN fields.
// Caller must persist the data file.
function setPassword(user, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  user.passwordSalt = salt;
  user.passwordHash = hashStr(password, salt);
  delete user.pinSalt;
  delete user.pinHash;
  delete user.pin;
}

// ── Rate limiting (in-memory, per IP) ─────────────────────────────────────────

const loginAttempts = new Map();
const RATE_MAX    = 10;
const RATE_WINDOW = 15 * 60 * 1000;

function getIP(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
}

function isRateLimited(req) {
  const key   = getIP(req);
  const entry = loginAttempts.get(key);
  if (!entry) return false;
  if (Date.now() - entry.firstAt > RATE_WINDOW) { loginAttempts.delete(key); return false; }
  return entry.count >= RATE_MAX;
}

function recordFailure(req) {
  const key  = getIP(req);
  const now  = Date.now();
  const prev = loginAttempts.get(key);
  if (!prev || now - prev.firstAt > RATE_WINDOW) {
    loginAttempts.set(key, { count: 1, firstAt: now });
  } else {
    loginAttempts.set(key, { count: prev.count + 1, firstAt: prev.firstAt });
  }
}

function clearFailures(req) { loginAttempts.delete(getIP(req)); }

// ── Session tokens (persisted to disk, 30-day TTL) ────────────────────────────

const sessions = new Map();
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;

function saveSessions() {
  try {
    const obj = {};
    for (const [token, s] of sessions) obj[token] = s;
    writeJSON(SESSIONS_FILE, obj);
  } catch {}
}

function loadSessions() {
  const saved = readJSON(SESSIONS_FILE, {});
  const now   = Date.now();
  for (const [token, s] of Object.entries(saved)) {
    if (s.expiresAt > now) sessions.set(token, s);   // skip expired
  }
  if (sessions.size > 0) console.log(`✅  Restored ${sessions.size} session(s) from disk`);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { userId, expiresAt: Date.now() + SESSION_TTL });
  saveSessions();
  return token;
}

function validateSession(token, userId) {
  if (!token) return false;
  const s = sessions.get(token);
  if (!s) return false;
  if (Date.now() > s.expiresAt) { sessions.delete(token); saveSessions(); return false; }
  return s.userId === userId;
}

function destroySession(token) {
  if (token) { sessions.delete(token); saveSessions(); }
}

function destroyAllSessions(userId) {
  for (const [t, s] of sessions) if (s.userId === userId) sessions.delete(t);
  saveSessions();
}

// Sweep expired sessions hourly.
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [t, s] of sessions) if (now > s.expiresAt) { sessions.delete(t); changed = true; }
  if (changed) saveSessions();
}, 60 * 60 * 1000);

// ── Fixtures helpers ───────────────────────────────────────────────────────────

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

// ── Knockout bracket auto-resolution ──────────────────────────────────────────

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
    return null;
  }
  return null;
}

function formatSlotLabel(slot) {
  if (!slot) return 'TBD';
  const m3rd = slot.match(/^3rd_([A-L]{2,})$/);
  if (m3rd) return `Best 3rd (${m3rd[1].split('').join('/')})`;
  const mPos = slot.match(/^([12])([A-L])$/);
  if (mPos) return `${mPos[1] === '1' ? '1st' : '2nd'} Group ${mPos[2]}`;
  const mWL = slot.match(/^([WL]):(.+)$/);
  if (mWL) return `${mWL[1] === 'W' ? 'Winner' : 'Loser'} ${mWL[2].replace('_', '-')}`;
  return 'TBD';
}

function resolveKnockoutFixtures(fixtures, results) {
  if (!fixtures.knockout) return fixtures;
  const slotMap = {};
  const thirdPlaceTeams = [];

  for (const [groupKey, group] of Object.entries(fixtures.groups || {})) {
    const groupComplete = group.matches.every(m => results[m.id]?.played);
    if (!groupComplete) continue;
    const rows = calcGroupStandings(group.teams, group.matches, results);
    if (rows[0]) slotMap[`1${groupKey}`] = rows[0].team.id;
    if (rows[1]) slotMap[`2${groupKey}`] = rows[1].team.id;
    if (rows[2]) thirdPlaceTeams.push({
      team: rows[2].team, pts: rows[2].pts,
      gd: rows[2].gf - rows[2].ga, gf: rows[2].gf, groupKey
    });
  }

  thirdPlaceTeams.sort((a, b) =>
    b.pts !== a.pts ? b.pts - a.pts : b.gd !== a.gd ? b.gd - a.gd : b.gf - a.gf
  );

  const usedIn3rd = new Set();
  for (const roundKey of ['R32', 'R16', 'QF', 'SF', '3P', 'F']) {
    const round = fixtures.knockout[roundKey];
    if (!round) continue;
    for (const match of round.matches) {
      for (const slot of [match.homeSlot, match.awaySlot]) {
        if (!slot || slotMap[slot] !== undefined) continue;
        const m3rd = slot.match(/^3rd_([A-L]{2,})$/);
        if (!m3rd) continue;
        const groupLetters = m3rd[1];
        const allComplete = groupLetters.split('').every(
          g => fixtures.groups[g]?.matches.every(m => results[m.id]?.played)
        );
        if (!allComplete) continue;
        const eligible = thirdPlaceTeams.filter(
          t => groupLetters.includes(t.groupKey) && !usedIn3rd.has(t.team.id)
        );
        if (eligible.length > 0) {
          slotMap[slot] = eligible[0].team.id;
          usedIn3rd.add(eligible[0].team.id);
        }
      }
    }
  }

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
      match.homeLabel = ht ? `${ht.flag} ${ht.name}` : formatSlotLabel(match.homeSlot);
      match.awayLabel = at ? `${at.flag} ${at.name}` : formatSlotLabel(match.awaySlot);
    }
  }
  return fixtures;
}

// ── Admin middleware ───────────────────────────────────────────────────────────

function requireAdmin(req, res, next) {
  // Accept legacy admin-password header
  if (req.headers['x-admin-password'] === ADMIN_PASSWORD) return next();
  // Accept session token from an admin user (auto-admin)
  const token = req.headers['x-session-token'];
  if (token) {
    const s = sessions.get(token);
    if (s && Date.now() <= s.expiresAt) {
      const data = readJSON(PREDICTIONS_FILE, { users: [] });
      const user = data.users.find(u => u.id === s.userId);
      if (user?.isAdmin) return next();
    }
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

// ── Admin routes ───────────────────────────────────────────────────────────────

app.get('/api/admin/verify', requireAdmin, (req, res) => res.json({ ok: true }));

app.get('/api/admin/backup', requireAdmin, (req, res) => {
  const backup = {
    exportedAt:  new Date().toISOString(),
    predictions: readJSON(PREDICTIONS_FILE, { users: [] }),
    results:     readJSON(RESULTS_FILE,     { results: {} })
  };
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Disposition', `attachment; filename="wc2026-backup-${date}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(backup, null, 2));
});

app.post('/api/admin/restore', requireAdmin, (req, res) => {
  const { predictions, results } = req.body;
  if (!predictions || !results)
    return res.status(400).json({ error: 'Invalid backup — must contain predictions and results' });
  writeJSON(PREDICTIONS_FILE, predictions);
  writeJSON(RESULTS_FILE, results);
  res.json({ ok: true });
});

app.post('/api/admin/clear-results', requireAdmin, (req, res) => {
  writeJSON(RESULTS_FILE, { results: {} });
  res.json({ ok: true });
});

// Delete all non-admin accounts (keeps Gary's admin account)
app.post('/api/admin/reset-all-users', requireAdmin, (req, res) => {
  const data    = readJSON(PREDICTIONS_FILE, { users: [] });
  const toRemove = data.users.filter(u => !u.isAdmin);
  toRemove.forEach(u => destroyAllSessions(u.id));
  data.users = data.users.filter(u => u.isAdmin);
  writeJSON(PREDICTIONS_FILE, data);
  res.json({ ok: true, removed: toRemove.length });
});

// Return all access codes (admin only)
app.get('/api/access-codes', requireAdmin, (req, res) => {
  res.json(readJSON(ACCESS_CODES_FILE, { codes: [] }).codes);
});

// Reinstate (un-use) a specific access code (admin only)
app.post('/api/access-codes/reinstate', requireAdmin, (req, res) => {
  const code = sanitise(req.body.code || '', 100);
  if (!code) return res.status(400).json({ error: 'Code required.' });
  const codesData = readJSON(ACCESS_CODES_FILE, { codes: [] });
  const codesArr  = Array.isArray(codesData.codes) ? codesData.codes : [];
  const entry     = codesArr.find(c => c.code.toLowerCase() === code.toLowerCase());
  if (!entry) return res.status(404).json({ error: 'Code not found.' });
  entry.used   = false;
  entry.usedBy = null;
  entry.usedAt = null;
  writeJSON(ACCESS_CODES_FILE, codesData);
  res.json({ ok: true });
});

// ── Fixtures ───────────────────────────────────────────────────────────────────

app.get('/api/fixtures', (req, res) => {
  const fixtures = readJSON(FIXTURES_FILE, { groups: {}, lockDates: {} });
  const results  = readJSON(RESULTS_FILE,  { results: {} }).results || {};
  res.json(resolveKnockoutFixtures(fixtures, results));
});

// ── Lock status ────────────────────────────────────────────────────────────────

app.get('/api/lock-status', (req, res) => {
  const fixtures = readJSON(FIXTURES_FILE, { lockDates: {} });
  const now = new Date();
  const status = {};
  for (const [round, lockTime] of Object.entries(fixtures.lockDates || {})) {
    status[round] = { locked: !!(lockTime && now >= new Date(lockTime)), lockTime };
  }
  res.json(status);
});

// ── Users / registration ───────────────────────────────────────────────────────

app.get('/api/users', (req, res) => {
  const data = readJSON(PREDICTIONS_FILE, { users: [] });
  res.json(data.users.map(u => ({ id: u.id, name: u.name })));
});

app.post('/api/register', (req, res) => {
  if (isRateLimited(req))
    return res.status(429).json({ error: 'Too many sign-in attempts. Please wait 15 minutes and try again.' });

  const name      = sanitise(req.body.name, 30);
  const email     = sanitise(req.body.email || '', 254).toLowerCase();
  const password  = String(req.body.password || '').trim();
  const legacyPin = req.body.legacyPin ? String(req.body.legacyPin).trim() : null;

  // Validate email
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'A valid email address is required.' });

  // Validate password
  if (!password || password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  const data = readJSON(PREDICTIONS_FILE, { users: [] });

  // ── Sign in to existing email account ───────────────────────────────────────
  const existing = data.users.find(u => u.email && u.email.toLowerCase() === email);
  if (existing) {
    if (!checkPassword(password, existing)) {
      recordFailure(req);
      return res.status(401).json({ error: 'Email or password incorrect.' });
    }
    clearFailures(req);
    const token = createSession(existing.id);
    return res.json({ userId: existing.id, name: existing.displayName || existing.name, token });
  }

  // ── Optional migration: claim a legacy PIN-based account ────────────────────
  if (legacyPin && name) {
    const legacy = data.users.find(u =>
      !u.email && u.name.toLowerCase() === name.toLowerCase()
    );
    if (legacy && checkPassword(legacyPin, legacy)) {
      // Merge: attach email + new password to existing account, keep userId + predictions
      legacy.email = email;
      setPassword(legacy, password);
      writeJSON(PREDICTIONS_FILE, data);
      const token = createSession(legacy.id);
      return res.json({
        userId: legacy.id,
        name:   legacy.displayName || legacy.name,
        token,
        migrated: true
      });
    }
    // Wrong legacy PIN or no match — fall through to create a fresh account
  }

  // ── New account ──────────────────────────────────────────────────────────────
  if (!name)
    return res.status(400).json({ error: 'Please enter your display name to create an account.' });

  // Validate invite code
  const accessCode = sanitise(req.body.accessCode || '', 100);
  const codesData  = readJSON(ACCESS_CODES_FILE, { codes: [] });
  const codesArr   = Array.isArray(codesData.codes) ? codesData.codes : [];
  const codeEntry  = codesArr.find(
    c => c.code.toLowerCase() === accessCode.toLowerCase()
  );
  if (!codeEntry)
    return res.status(400).json({ error: 'A valid invite code is required to create an account.' });
  if (codeEntry.used)
    return res.status(400).json({ error: 'This invite code has already been used.' });

  const userId = 'user_' + crypto.randomBytes(8).toString('hex');
  const salt   = crypto.randomBytes(16).toString('hex');
  data.users.push({
    id:           userId,
    name,
    email,
    passwordSalt: salt,
    passwordHash: hashStr(password, salt),
    predictions:  {},
    registeredAt: new Date().toISOString(),
    inviteCode:   accessCode
  });

  try {
    writeJSON(PREDICTIONS_FILE, data);
    // Mark code as used
    codeEntry.used   = true;
    codeEntry.usedBy = userId;
    codeEntry.usedAt = new Date().toISOString();
    writeJSON(ACCESS_CODES_FILE, codesData);
  } catch (err) {
    console.error('Registration write error:', err);
    return res.status(500).json({ error: 'Server error saving your account. Please try again.' });
  }

  const token = createSession(userId);
  res.json({ userId, name, token });
});

// ── Logout ─────────────────────────────────────────────────────────────────────

app.post('/api/logout', (req, res) => {
  destroySession(req.headers['x-session-token']);
  res.json({ ok: true });
});

// ── Whoami ─────────────────────────────────────────────────────────────────────

app.get('/api/me', (req, res) => {
  const token = req.headers['x-session-token'];
  if (!token) return res.json({ userId: null, isAdmin: false });
  const s = sessions.get(token);
  if (!s) return res.json({ userId: null, isAdmin: false });
  if (Date.now() > s.expiresAt) { sessions.delete(token); return res.json({ userId: null, isAdmin: false }); }
  const data = readJSON(PREDICTIONS_FILE, { users: [] });
  const user = data.users.find(u => u.id === s.userId);
  if (!user) return res.json({ userId: null, isAdmin: false });
  res.json({ userId: user.id, name: user.displayName || user.name, isAdmin: !!user.isAdmin });
});

// ── Forgot password ────────────────────────────────────────────────────────────

app.post('/api/forgot-password', async (req, res) => {
  const email = sanitise(req.body.email || '', 254).toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'A valid email address is required.' });

  // Always return 200 so attackers can't enumerate registered emails.
  const data = readJSON(PREDICTIONS_FILE, { users: [] });
  const user = data.users.find(u => u.email && u.email.toLowerCase() === email);
  if (!user) return res.json({ ok: true });

  // Generate a 1-hour reset token
  const token = crypto.randomBytes(32).toString('hex');
  user.resetToken       = token;
  user.resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  writeJSON(PREDICTIONS_FILE, data);

  const appUrl    = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
  const resetLink = `${appUrl}/reset.html?token=${token}`;

  try {
    await sendPasswordResetEmail(user.email, user.displayName || user.name, resetLink);
  } catch (err) {
    console.error('Password reset email failed:', err.message);
    // Use 422 (not 503) — Railway intercepts 5xx responses and returns HTML,
    // which breaks the frontend JSON error parsing.
    return res.status(422).json({ error: err.message || 'Could not send the reset email.' });
  }

  res.json({ ok: true });
});

// ── Reset password (via email token) ──────────────────────────────────────────

app.post('/api/reset-password', (req, res) => {
  const { token, password } = req.body;
  if (!token)
    return res.status(400).json({ error: 'Reset token required.' });
  if (!password || password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  const data = readJSON(PREDICTIONS_FILE, { users: [] });
  const user = data.users.find(u =>
    u.resetToken === token &&
    u.resetTokenExpiry &&
    new Date(u.resetTokenExpiry) > new Date()
  );

  if (!user)
    return res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });

  setPassword(user, password);
  delete user.resetToken;
  delete user.resetTokenExpiry;
  writeJSON(PREDICTIONS_FILE, data);

  // Invalidate all existing sessions so the user must sign in with new password
  destroyAllSessions(user.id);

  res.json({ ok: true });
});

// ── Predictions ────────────────────────────────────────────────────────────────

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
  if (!validateSession(req.headers['x-session-token'], req.params.userId))
    return res.status(401).json({ error: 'Session invalid or expired. Please sign in again.' });

  const { predictions } = req.body;
  const fixtures = readJSON(FIXTURES_FILE, { groups: {}, lockDates: {} });
  const data     = readJSON(PREDICTIONS_FILE, { users: [] });
  const user     = data.users.find(u => u.id === req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const updated = {};
  for (const [matchId, score] of Object.entries(user.predictions)) {
    const round = getMatchRound(matchId, fixtures);
    if (!round || isRoundLocked(round, fixtures)) updated[matchId] = score;
  }
  for (const [matchId, score] of Object.entries(predictions)) {
    const round = getMatchRound(matchId, fixtures);
    if (round && !isRoundLocked(round, fixtures)) {
      const h = parseInt(score.home);
      const a = parseInt(score.away);
      // Only save if both sides have a valid integer — cleared/empty inputs are skipped (treated as deleted)
      if (!isNaN(h) && !isNaN(a)) {
        updated[matchId] = { home: h, away: a };
      }
    }
  }

  user.predictions = updated;
  user.lastUpdated = new Date().toISOString();
  writeJSON(PREDICTIONS_FILE, data);
  res.json({ success: true, saved: Object.keys(updated).length });
});

// ── Results (admin) ────────────────────────────────────────────────────────────

app.get('/api/results', (req, res) => {
  res.json(readJSON(RESULTS_FILE, { results: {} }));
});

app.post('/api/results', requireAdmin, (req, res) => {
  const { matchId, homeGoals, awayGoals } = req.body;
  if (!matchId || homeGoals === undefined || awayGoals === undefined)
    return res.status(400).json({ error: 'matchId, homeGoals, awayGoals required' });
  const data = readJSON(RESULTS_FILE, { results: {} });
  data.results[matchId] = {
    home: parseInt(homeGoals), away: parseInt(awayGoals),
    played: true, recordedAt: new Date().toISOString()
  };
  writeJSON(RESULTS_FILE, data);
  res.json({ success: true });
});

app.delete('/api/results/:matchId', requireAdmin, (req, res) => {
  const data = readJSON(RESULTS_FILE, { results: {} });
  delete data.results[req.params.matchId];
  writeJSON(RESULTS_FILE, data);
  res.json({ success: true });
});

// ── Leaderboard ────────────────────────────────────────────────────────────────

function calcLeaderboard() {
  const users   = readJSON(PREDICTIONS_FILE, { users: [] }).users;
  const results = readJSON(RESULTS_FILE,     { results: {} }).results;

  return users.map(user => {
    let pts = 0, correctResults = 0, correctScores = 0;
    const matchPoints = {};
    for (const [matchId, result] of Object.entries(results)) {
      if (!result.played) continue;
      const pred = user.predictions[matchId];
      if (!pred) continue;
      const actualSign = Math.sign(result.home - result.away);
      const predSign   = Math.sign(pred.home   - pred.away);
      let p = 0;
      if (actualSign === predSign) {
        p += 3; correctResults++;
        if (pred.home === result.home && pred.away === result.away) { p += 2; correctScores++; }
      }
      matchPoints[matchId] = p;
      pts += p;
    }
    return {
      id: user.id, name: user.name,
      totalPoints: pts, correctResults, correctScores,
      matchPoints,
      predictionsEntered: Object.keys(user.predictions).length
    };
  }).sort((a, b) => b.totalPoints - a.totalPoints);
}

app.get('/api/leaderboard', (req, res) => res.json(calcLeaderboard()));

// ── Profile ────────────────────────────────────────────────────────────────────

app.get('/api/profile/:userId', (req, res) => {
  const data  = readJSON(PREDICTIONS_FILE, { users: [] });
  const user  = data.users.find(u => u.id === req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const board = calcLeaderboard();
  const rank  = board.findIndex(u => u.id === req.params.userId) + 1;
  const entry = board.find(u => u.id === req.params.userId) || {};
  res.json({
    id: user.id, name: user.name,
    displayName: user.displayName || user.name,
    bio: user.bio || '', avatar: user.avatar || null,
    isAdmin: !!user.isAdmin,
    joinedAt: user.registeredAt,
    inviteCode: user.inviteCode || null,
    stats: {
      totalPoints:        entry.totalPoints        || 0,
      rank, totalPlayers: board.length,
      correctResults:     entry.correctResults     || 0,
      correctScores:      entry.correctScores      || 0,
      predictionsEntered: entry.predictionsEntered || 0
    },
    matchPoints: entry.matchPoints || {}
  });
});

app.post('/api/profile/:userId/update', (req, res) => {
  const { password, displayName, bio } = req.body;
  const data = readJSON(PREDICTIONS_FILE, { users: [] });
  const user = data.users.find(u => u.id === req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!checkPassword(password, user)) return res.status(401).json({ error: 'Incorrect password.' });
  const cleanName = sanitise(displayName, 30);
  if (!cleanName) return res.status(400).json({ error: 'Display name required.' });
  user.displayName = cleanName;
  if (bio !== undefined) user.bio = sanitise(String(bio), 200);
  writeJSON(PREDICTIONS_FILE, data);
  res.json({ success: true });
});

app.post('/api/profile/:userId/avatar', (req, res) => {
  const { password, avatar } = req.body;
  const data = readJSON(PREDICTIONS_FILE, { users: [] });
  const user = data.users.find(u => u.id === req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!checkPassword(password, user)) return res.status(401).json({ error: 'Incorrect password.' });
  if (!avatar || !/^data:image\/(jpeg|png|gif|webp);base64,/.test(avatar))
    return res.status(400).json({ error: 'Invalid image format. Please use JPEG, PNG, GIF or WebP.' });
  if (avatar.length > 250_000)
    return res.status(400).json({ error: 'Image too large — please use a smaller photo.' });
  user.avatar = avatar;
  writeJSON(PREDICTIONS_FILE, data);
  res.json({ success: true });
});

// ── Change password ────────────────────────────────────────────────────────────

app.post('/api/users/:userId/change-password', (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const data = readJSON(PREDICTIONS_FILE, { users: [] });
  const user = data.users.find(u => u.id === req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!checkPassword(currentPassword, user)) return res.status(401).json({ error: 'Current password incorrect.' });
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  setPassword(user, newPassword);
  writeJSON(PREDICTIONS_FILE, data);
  res.json({ success: true });
});

// ── Reset predictions ──────────────────────────────────────────────────────────

app.post('/api/predictions/:userId/reset', (req, res) => {
  const { password } = req.body;
  const data = readJSON(PREDICTIONS_FILE, { users: [] });
  const user = data.users.find(u => u.id === req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!checkPassword(password, user)) return res.status(401).json({ error: 'Incorrect password.' });
  user.predictions = {};
  user.lastUpdated = new Date().toISOString();
  writeJSON(PREDICTIONS_FILE, data);
  res.json({ success: true });
});

// ── Delete user ────────────────────────────────────────────────────────────────

app.delete('/api/users/:userId', (req, res) => {
  const { password } = req.body;
  const data = readJSON(PREDICTIONS_FILE, { users: [] });
  const idx  = data.users.findIndex(u => u.id === req.params.userId);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  if (!checkPassword(password, data.users[idx])) return res.status(401).json({ error: 'Incorrect password.' });
  destroyAllSessions(data.users[idx].id);
  data.users.splice(idx, 1);
  writeJSON(PREDICTIONS_FILE, data);
  res.json({ success: true });
});

// ── Bonus Extras ───────────────────────────────────────────────────────────────

const BONUS_SEED = {
  lockTime: '2026-06-11T19:59:00Z',
  predictions: {},
  results: { topGoalscorer: null, mostRedCards: null, highestScoringMatch: null }
};

function readBonus() {
  if (!fs.existsSync(BONUS_FILE)) {
    const src = path.join(DATA_DIR, 'bonus-extras.json');
    if (fs.existsSync(src)) return readJSON(src, BONUS_SEED);
    return JSON.parse(JSON.stringify(BONUS_SEED));
  }
  return readJSON(BONUS_FILE, BONUS_SEED);
}

function isBonusLocked(bonus) {
  return !!(bonus.lockTime && new Date() >= new Date(bonus.lockTime));
}

function calcBonusLeaderboard(bonus) {
  const results = bonus.results || {};
  const entries = Object.entries(bonus.predictions || {});
  const data = readJSON(PREDICTIONS_FILE, { users: [] });

  return entries.map(([userId, preds]) => {
    const user = data.users.find(u => u.id === userId);
    const name = user ? (user.displayName || user.name) : userId;
    let pts = 0;
    const breakdown = {};
    for (const key of ['topGoalscorer', 'mostRedCards', 'highestScoringMatch']) {
      const actual = (results[key] || '').toLowerCase().trim();
      const guess  = (preds[key]  || '').toLowerCase().trim();
      const correct = actual && guess && actual === guess;
      breakdown[key] = correct ? 3 : 0;
      pts += breakdown[key];
    }
    return { userId, name, pts, breakdown };
  }).sort((a, b) => b.pts - a.pts);
}

app.get('/api/bonus-extras/lock-status', (req, res) => {
  const bonus = readBonus();
  res.json({ locked: isBonusLocked(bonus), lockTime: bonus.lockTime });
});

app.get('/api/bonus-extras/predictions', (req, res) => {
  const bonus = readBonus();
  res.json(bonus.predictions || {});
});

app.post('/api/bonus-extras/predictions/:userId', (req, res) => {
  if (!validateSession(req.headers['x-session-token'], req.params.userId))
    return res.status(401).json({ error: 'Session invalid or expired. Please sign in again.' });

  const bonus = readBonus();
  if (isBonusLocked(bonus))
    return res.status(403).json({ error: 'Bonus predictions are locked.' });

  const { topGoalscorer, mostRedCards, highestScoringMatch } = req.body;
  bonus.predictions[req.params.userId] = {
    topGoalscorer:        sanitise(topGoalscorer || '', 100),
    mostRedCards:         sanitise(mostRedCards || '', 100),
    highestScoringMatch:  sanitise(highestScoringMatch || '', 100)
  };
  writeJSON(BONUS_FILE, bonus);
  res.json({ success: true });
});

app.get('/api/bonus-extras/results', (req, res) => {
  const bonus = readBonus();
  res.json(bonus.results || {});
});

app.post('/api/bonus-extras/results', requireAdmin, (req, res) => {
  const { topGoalscorer, mostRedCards, highestScoringMatch } = req.body;
  const bonus = readBonus();
  if (topGoalscorer        !== undefined) bonus.results.topGoalscorer        = sanitise(topGoalscorer, 100);
  if (mostRedCards         !== undefined) bonus.results.mostRedCards          = sanitise(mostRedCards, 100);
  if (highestScoringMatch  !== undefined) bonus.results.highestScoringMatch   = sanitise(highestScoringMatch, 100);
  writeJSON(BONUS_FILE, bonus);
  res.json({ success: true });
});

app.get('/api/bonus-extras/leaderboard', (req, res) => {
  const bonus = readBonus();
  res.json(calcBonusLeaderboard(bonus));
});

// ── Global error handler (returns JSON for all unhandled route errors) ─────────

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({ error: 'An unexpected server error occurred. Please try again.' });
});

// ── Start ──────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`⚽  World Cup 2026 running at http://localhost:${PORT}`);
  console.log(`🔑  Admin password: ${ADMIN_PASSWORD}`);
  if (!emailEnabled) console.log('⚠️   Email not configured — set RESEND_API_KEY (recommended) or GMAIL_USER + GMAIL_APP_PASSWORD to enable password reset.');
  loadSessions();
  seedAdminAccount();
  seedAccessCodes();
});
