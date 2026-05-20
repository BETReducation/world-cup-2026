// Centralised API helpers
const API = {
  async get(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async post(path, body, adminPwd = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (adminPwd) headers['x-admin-password'] = adminPwd;
    const r = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async del(path, adminPwd) {
    const r = await fetch(path, { method: 'DELETE', headers: { 'x-admin-password': adminPwd } });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },

  fixtures: () => API.get('/api/fixtures'),
  lockStatus: () => API.get('/api/lock-status'),
  users: () => API.get('/api/users'),
  register: (name, pin) => API.post('/api/register', { name, pin }),
  allPredictions: () => API.get('/api/predictions'),
  myPredictions: (userId) => API.get(`/api/predictions/${userId}`),
  savePredictions: (userId, predictions) => API.post(`/api/predictions/${userId}`, { predictions }),
  results: () => API.get('/api/results'),
  saveResult: (matchId, homeGoals, awayGoals, pwd) =>
    API.post('/api/results', { matchId, homeGoals, awayGoals }, pwd),
  deleteResult: (matchId, pwd) => API.del(`/api/results/${matchId}`, pwd),
  leaderboard: () => API.get('/api/leaderboard')
};

// Session helpers
const Session = {
  save(userId, name) {
    localStorage.setItem('wc2026_userId', userId);
    localStorage.setItem('wc2026_name', name);
  },
  load() {
    return {
      userId: localStorage.getItem('wc2026_userId'),
      name: localStorage.getItem('wc2026_name')
    };
  },
  clear() {
    localStorage.removeItem('wc2026_userId');
    localStorage.removeItem('wc2026_name');
  }
};
