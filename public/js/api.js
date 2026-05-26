// Centralised API helpers
const API = {
  async get(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async post(path, body, adminPwd = null, sessionToken = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (adminPwd)     headers['x-admin-password']  = adminPwd;
    if (sessionToken) headers['x-session-token']   = sessionToken;
    const r = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async del(path, adminPwd) {
    const r = await fetch(path, { method: 'DELETE', headers: { 'x-admin-password': adminPwd } });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },

  fixtures:      ()                     => API.get('/api/fixtures'),
  lockStatus:    ()                     => API.get('/api/lock-status'),
  users:         ()                     => API.get('/api/users'),
  register:      (name, pin)            => API.post('/api/register', { name, pin }),
  allPredictions:()                     => API.get('/api/predictions'),
  myPredictions: (userId)               => API.get(`/api/predictions/${userId}`),
  savePredictions(userId, predictions)  {
    const { token } = Session.load();
    return API.post(`/api/predictions/${userId}`, { predictions }, null, token);
  },
  logout() {
    const { token } = Session.load();
    return fetch('/api/logout', {
      method: 'POST',
      headers: token ? { 'x-session-token': token } : {}
    }).catch(() => {});
  },
  results:      ()                        => API.get('/api/results'),
  verifyAdmin:  (pwd)                     => fetch('/api/admin/verify', { headers: { 'x-admin-password': pwd } }).then(r => r.ok),
  saveResult:   (matchId, hg, ag, pwd)    => API.post('/api/results', { matchId, homeGoals: hg, awayGoals: ag }, pwd),
  deleteResult: (matchId, pwd)            => API.del(`/api/results/${matchId}`, pwd),
  leaderboard:  ()                        => API.get('/api/leaderboard')
};

// Session helpers — now stores token alongside userId and name
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
