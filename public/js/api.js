// Centralised API helpers
const API = {
  async get(path, extraHeaders = {}) {
    const r = await fetch(path, { headers: extraHeaders });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async post(path, body, adminPwd = null, sessionToken = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (adminPwd)     headers['x-admin-password'] = adminPwd;
    if (sessionToken) headers['x-session-token']  = sessionToken;
    const r = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async del(path, adminPwd = null) {
    const { token } = Session.load();
    const headers = {};
    if (adminPwd) headers['x-admin-password'] = adminPwd;
    if (token)    headers['x-session-token']  = token;
    const r = await fetch(path, { method: 'DELETE', headers });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },

  // Auth
  register(name, email, password, legacyPin = null, accessCode = null) {
    return API.post('/api/register', {
      name, email, password,
      ...(legacyPin   ? { legacyPin }   : {}),
      ...(accessCode  ? { accessCode }  : {})
    });
  },
  forgotPassword: (email) =>
    API.post('/api/forgot-password', { email }),
  resetPassword: (token, password) =>
    API.post('/api/reset-password', { token, password }),
  logout() {
    const { token } = Session.load();
    return fetch('/api/logout', {
      method: 'POST',
      headers: token ? { 'x-session-token': token } : {}
    }).catch(() => {});
  },
  me() {
    const { token } = Session.load();
    if (!token) return Promise.resolve({ userId: null, isAdmin: false });
    return fetch('/api/me', { headers: { 'x-session-token': token } })
      .then(r => r.json())
      .catch(() => ({ userId: null, isAdmin: false }));
  },

  // Fixtures & lock
  fixtures:   () => API.get('/api/fixtures'),
  lockStatus: () => API.get('/api/lock-status'),
  users:      () => API.get('/api/users'),

  // Predictions
  allPredictions: ()         => API.get('/api/predictions'),
  myPredictions:  (userId)   => API.get(`/api/predictions/${userId}`),
  savePredictions(userId, predictions) {
    const { token } = Session.load();
    return API.post(`/api/predictions/${userId}`, { predictions }, null, token);
  },

  // Results & leaderboard
  results:     () => API.get('/api/results'),
  leaderboard: () => API.get('/api/leaderboard'),
  verifyAdmin(pwd) {
    const { token } = Session.load();
    const headers = {};
    if (pwd)   headers['x-admin-password'] = pwd;
    if (token) headers['x-session-token']  = token;
    return fetch('/api/admin/verify', { headers }).then(r => r.ok);
  },
  saveResult(matchId, hg, ag, pwd = null) {
    const { token } = Session.load();
    return API.post('/api/results', { matchId, homeGoals: hg, awayGoals: ag }, pwd, token);
  },
  deleteResult: (matchId, pwd = null) => API.del(`/api/results/${matchId}`, pwd),

  // Admin: access codes + user management
  getAccessCodes() {
    const { token } = Session.load();
    const headers = {};
    if (token) headers['x-session-token'] = token;
    return fetch('/api/access-codes', { headers }).then(r => r.json());
  },
  adminSetPrediction(userId, matchId, home, away) {
    const { token } = Session.load();
    return API.post(`/api/admin/predictions/${userId}/${matchId}`, { home, away }, null, token);
  },
  adminDeleteUser(userId) {
    const { token } = Session.load();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['x-session-token'] = token;
    return fetch(`/api/admin/users/${userId}`, { method: 'DELETE', headers }).then(r => r.json());
  },
  adminResetAllUsers() {
    const { token } = Session.load();
    return API.post('/api/admin/reset-all-users', {}, null, token);
  },
  reinstateCode(code) {
    const { token } = Session.load();
    return API.post('/api/access-codes/reinstate', { code }, null, token);
  },
  adminBackup(pwd = null) {
    const { token } = Session.load();
    const headers = {};
    if (pwd)   headers['x-admin-password'] = pwd;
    if (token) headers['x-session-token']  = token;
    return fetch('/api/admin/backup', { headers });
  },
  adminClearResults(pwd = null) {
    const { token } = Session.load();
    return API.post('/api/admin/clear-results', {}, pwd, token);
  },
  adminRestore(data, pwd = null) {
    const { token } = Session.load();
    return API.post('/api/admin/restore', data, pwd, token);
  }
};

// Session helpers — stores userId, display name, and session token in localStorage
const Session = {
  save(userId, name, token) {
    localStorage.setItem('wc2026_userId', userId);
    localStorage.setItem('wc2026_name',   name);
    if (token) localStorage.setItem('wc2026_token', token);
  },
  load() {
    return {
      userId: localStorage.getItem('wc2026_userId'),
      name:   localStorage.getItem('wc2026_name'),
      token:  localStorage.getItem('wc2026_token')
    };
  },
  clear() {
    localStorage.removeItem('wc2026_userId');
    localStorage.removeItem('wc2026_name');
    localStorage.removeItem('wc2026_token');
  }
};
