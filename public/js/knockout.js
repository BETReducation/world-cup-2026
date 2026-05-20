// ── State ─────────────────────────────────────────────────────────────────────

let fixtures       = null;
let lockStatus     = {};
let allPredictions = [];
let koPredictions  = {};   // userId's saved ko predictions (matchId → {home,away})
let results        = {};
let userId         = null;
let browseMode     = false;
let isAdmin        = false;
let adminPassword  = null;
let isSaved        = false;
let allTeams       = {};   // teamId → team object
let activeRound    = 'R32';

const ROUND_ORDER = ['R32', 'R16', 'QF', 'SF', '3P', 'F'];

const $ = id => document.getElementById(id);

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildAllTeams(fixtures) {
  const map = {};
  Object.values(fixtures.groups || {}).forEach(g => g.teams.forEach(t => { map[t.id] = t; }));
  return map;
}

function getTeam(id) {
  if (!id) return null;
  return allTeams[id] || { id, name: id, flag: '' };
}

function fmtKoDate(dateStr, timeStr) {
  if (!dateStr || dateStr === 'TBD') return 'Date TBD';
  try {
    const d = new Date(`${dateStr}T00:00:00`);
    const datePart = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    const timePart = (timeStr && timeStr !== 'TBD') ? ` · ${timeStr} ET` : ' · Time TBD';
    return datePart + timePart;
  } catch { return dateStr; }
}

function showErr(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const session = Session.load();
  if (session.userId) {
    userId = session.userId;
    $('playerName').textContent = session.name;
    await loadAndRender();
  } else {
    $('registerModal').classList.add('open');
    $('loadingState').style.display = 'none';
  }
}

// ── Registration ──────────────────────────────────────────────────────────────

$('registerBtn').addEventListener('click', async () => {
  const name = $('regName').value.trim();
  const pin  = $('regPin').value.trim();
  const err  = $('registerError');
  err.classList.add('hidden');
  if (!name) { showErr(err, 'Please enter your name.'); return; }
  if (!/^\d{4}$/.test(pin)) { showErr(err, 'PIN must be exactly 4 digits.'); return; }

  $('registerBtn').disabled  = true;
  $('registerBtn').textContent = 'Signing in…';
  try {
    const result = await API.register(name, pin);
    userId = result.userId;
    Session.save(result.userId, result.name);
    $('playerName').textContent = result.name;
    $('registerModal').classList.remove('open');
    await loadAndRender();
  } catch (e) {
    const msg = e.message.includes('PIN')
      ? 'That name already exists with a different PIN.'
      : 'Could not connect to server. Is it running?';
    showErr(err, msg);
    $('registerBtn').disabled  = false;
    $('registerBtn').textContent = 'Sign in →';
  }
});

$('regPin').addEventListener('keydown', e => { if (e.key === 'Enter') $('registerBtn').click(); });
$('regName').addEventListener('keydown', e => { if (e.key === 'Enter') $('regPin').focus(); });

$('browseBtn').addEventListener('click', async () => {
  browseMode = true;
  $('registerModal').classList.remove('open');
  await loadAndRender();
});

$('logoutBtn').addEventListener('click', () => { Session.clear(); location.reload(); });

// ── Admin ─────────────────────────────────────────────────────────────────────

$('adminToggleBtn').addEventListener('click', () => {
  if (isAdmin) {
    isAdmin = false; adminPassword = null;
    $('adminLabel').textContent   = '';
    $('adminToggleBtn').textContent = '🔑 Admin Mode';
    showRound(activeRound);
  } else {
    $('adminModal').classList.add('open');
    $('adminPwdInput').value = '';
    setTimeout(() => $('adminPwdInput').focus(), 50);
  }
});

$('adminLoginBtn').addEventListener('click', async () => {
  const pwd = $('adminPwdInput').value.trim();
  if (!pwd) return;
  $('adminLoginBtn').disabled  = true;
  $('adminLoginBtn').textContent = 'Checking…';
  const ok = await API.verifyAdmin(pwd);
  $('adminLoginBtn').disabled  = false;
  $('adminLoginBtn').textContent = 'Login';
  if (!ok) {
    $('adminError').textContent = '✗ Incorrect password';
    $('adminError').classList.remove('hidden');
    return;
  }
  adminPassword = pwd; isAdmin = true;
  $('adminError').classList.add('hidden');
  $('adminModal').classList.remove('open');
  $('adminLabel').textContent   = '✓ Admin active';
  $('adminToggleBtn').textContent = 'Exit Admin';
  showRound(activeRound);
});

$('adminCancelBtn').addEventListener('click', () => $('adminModal').classList.remove('open'));
$('adminPwdInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('adminLoginBtn').click(); });

// ── Load & render ─────────────────────────────────────────────────────────────

async function loadAndRender() {
  $('loadingState').style.display = 'block';
  try {
    [fixtures, lockStatus, allPredictions, results] = await Promise.all([
      API.fixtures(), API.lockStatus(), API.allPredictions(), API.results()
    ]);
  } catch {
    $('loadingState').innerHTML =
      '<p style="color:var(--red);">⚠️ Could not reach server. Make sure <code>node server.js</code> is running.</p>';
    return;
  }

  allTeams = buildAllTeams(fixtures);

  if (userId) {
    try {
      const saved = await API.myPredictions(userId);
      koPredictions = saved.predictions || {};
    } catch {
      Session.clear(); location.reload(); return;
    }
  }

  $('loadingState').style.display = 'none';
  $('knockoutApp').style.display  = 'block';

  if (browseMode) {
    $('playerName').textContent = 'Guest';
    $('logoutBtn').textContent  = 'Sign in';
    $('logoutBtn').onclick = () => location.reload();
    $('saveBtn').textContent  = 'Sign in to Save';
    $('saveBtn').onclick = () => location.reload();
  }

  buildTabs();
  showRound(activeRound);

  if (userId && Object.keys(koPredictions).some(id => isKnockoutId(id))) {
    enterSavedState();
  }
}

function isKnockoutId(matchId) {
  for (const round of Object.values(fixtures.knockout || {})) {
    if ((round.matches || []).some(m => m.id === matchId)) return true;
  }
  return false;
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function buildTabs() {
  const bar = $('roundTabs');
  bar.innerHTML = '';
  const roundNames = { R32: 'R32', R16: 'R16', QF: 'QF', SF: 'SF', '3P': '3P', F: 'Final' };

  ROUND_ORDER.forEach(key => {
    if (!fixtures.knockout?.[key]) return;
    const btn = document.createElement('button');
    btn.className = 'tab-btn' + (key === activeRound ? ' active' : '');
    btn.textContent = roundNames[key] || key;
    btn.addEventListener('click', () => {
      activeRound = key;
      document.querySelectorAll('#roundTabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      showRound(key);
    });
    bar.appendChild(btn);
  });
}

// ── Round panel ───────────────────────────────────────────────────────────────

function showRound(roundKey) {
  const panels = $('roundPanels');
  const round  = fixtures.knockout?.[roundKey];
  if (!round) { panels.innerHTML = ''; return; }

  const lock      = lockStatus[roundKey];
  const locked    = lock?.locked || false;
  const lockLabel = locked
    ? '🔒 Locked'
    : lock?.lockTime
      ? `Locks · ${fmtLockTimezones(lock.lockTime)}`
      : '';

  let html = `<div class="card">`;
  html += `<div class="ko-round-header">
    <span class="ko-round-title">${round.name || roundKey}</span>
    ${lockLabel ? `<span class="ko-lock-info">${lockLabel}</span>` : ''}
  </div>`;
  html += `<div class="match-list">`;

  for (const m of round.matches) {
    const home        = m.home ? getTeam(m.home) : null;
    const away        = m.away ? getTeam(m.away) : null;
    const homeName    = home ? home.name  : (m.homeLabel || m.homeSlot || 'TBD');
    const awayName    = away ? away.name  : (m.awayLabel || m.awaySlot || 'TBD');
    const homeFlag    = home ? home.flag  : '';
    const awayFlag    = away ? away.flag  : '';
    const teamsKnown  = !!(m.home && m.away);
    const inputActive = teamsKnown && !locked && !browseMode && userId;
    const dis         = inputActive ? '' : 'disabled';
    const cls         = locked ? 'round-locked' : '';
    const pred        = koPredictions[m.id] || { home: '', away: '' };

    html += `
      <div class="match-row ${cls}" id="row_${m.id}">
        <div class="match-meta">${fmtKoDate(m.date, m.time)}<br>${m.venue || 'Venue TBD'}</div>
        <div class="team-name">
          ${homeFlag ? `<span class="flag">${homeFlag}</span>` : ''}${homeName}
        </div>
        <div class="score-input">
          <input type="number" min="0" max="20" value="${pred.home}" ${dis}
            data-match="${m.id}" data-side="home" class="ko-pred-input"
            inputmode="numeric" aria-label="${homeName} goals">
          <span class="score-sep">–</span>
          <input type="number" min="0" max="20" value="${pred.away}" ${dis}
            data-match="${m.id}" data-side="away" class="ko-pred-input"
            inputmode="numeric" aria-label="${awayName} goals">
        </div>
        <div class="team-name right">
          ${awayName}${awayFlag ? `<span class="flag">${awayFlag}</span>` : ''}
        </div>
        ${locked    ? '<span class="lock-badge">LOCKED</span>' : ''}
        ${!teamsKnown && !locked ? '<span class="tbd-badge">TEAMS TBD</span>' : ''}
      </div>`;

    // Show existing result if played
    const result = results.results?.[m.id];
    if (result?.played && teamsKnown) {
      html += buildKoComparisonBlock(m, result, home, away);
    }

    // Admin result entry
    if (isAdmin && teamsKnown) {
      const h = result?.played ? result.home : '';
      const a = result?.played ? result.away : '';
      html += `
        <div class="admin-panel">
          <h4>${homeName} vs ${awayName} — record result (90 mins)</h4>
          <div class="score-entry">
            <input type="number" min="0" max="20" value="${h}" id="h_${m.id}" placeholder="0">
            <span class="score-sep">–</span>
            <input type="number" min="0" max="20" value="${a}" id="a_${m.id}" placeholder="0">
            <button class="btn btn-primary btn-sm" onclick="saveResult('${m.id}')">Save</button>
            ${result?.played ? `<button class="btn btn-danger btn-sm" onclick="deleteResult('${m.id}')">Clear</button>` : ''}
            <span id="status_${m.id}" style="font-family:'JetBrains Mono',monospace; font-size:11px; color:var(--accent);"></span>
          </div>
        </div>`;
    }
  }

  html += `</div></div>`;
  panels.innerHTML = html;

  panels.querySelectorAll('.ko-pred-input').forEach(input => {
    input.addEventListener('input', onPredInput);
    if (isSaved) input.classList.add('saved');
  });
}

// ── Comparison block (same style as results.js) ───────────────────────────────

function buildKoComparisonBlock(match, result, home, away) {
  if (!allPredictions.length) return '';
  const rows = allPredictions.map(user => {
    const pred = user.predictions?.[match.id];
    if (pred === undefined || pred === null)
      return `<tr><td>${user.name}</td><td class="pred-score" colspan="2" style="color:var(--muted);">—</td></tr>`;
    const predStr = `${pred.home} – ${pred.away}`;
    const aSign = Math.sign(result.home - result.away);
    const pSign = Math.sign(pred.home - pred.away);
    let pts = 0;
    if (aSign === pSign) {
      pts = 3;
      if (pred.home === result.home && pred.away === result.away) pts = 5;
    }
    const cls = pts === 5 ? 'pts-5' : pts === 3 ? 'pts-3' : 'pts-0';
    return `<tr>
      <td>${user.name}</td>
      <td class="pred-score">${predStr}</td>
      <td><span class="pts-badge ${cls}">${pts} pts</span></td>
    </tr>`;
  }).join('');

  return `
    <div class="comparison-panel">
      <table>
        <thead><tr>
          <th>Player</th><th>Prediction</th><th>Points</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ── Input handler ─────────────────────────────────────────────────────────────

function onPredInput(e) {
  const { match, side } = e.target.dataset;
  let val = e.target.value === '' ? '' : Math.max(0, Math.min(20, parseInt(e.target.value) || 0));
  if (e.target.value !== '' && val !== parseInt(e.target.value)) e.target.value = val;
  if (!koPredictions[match]) koPredictions[match] = { home: '', away: '' };
  koPredictions[match][side] = val === '' ? '' : Number(val);
  $('saveStatus').textContent = '';
  isSaved = false;
}

// ── Saved / edit state ────────────────────────────────────────────────────────

function enterSavedState() {
  isSaved = true;
  document.querySelectorAll('.ko-pred-input').forEach(el => el.classList.add('saved'));
  $('editBtn').style.display = 'inline-flex';
  $('saveBtn').style.display = 'none';
  $('saveStatus').textContent = '';
}

function enterEditState() {
  isSaved = false;
  document.querySelectorAll('.ko-pred-input').forEach(el => el.classList.remove('saved'));
  $('editBtn').style.display = 'none';
  $('saveBtn').style.display = 'inline-flex';
  $('saveStatus').textContent = '';
}

$('editBtn').addEventListener('click', enterEditState);

// ── Save predictions ──────────────────────────────────────────────────────────

$('saveBtn').addEventListener('click', async () => {
  if (browseMode) { location.reload(); return; }
  $('saveBtn').disabled  = true;
  $('saveBtn').textContent = 'Saving…';
  $('saveStatus').textContent = '';

  try {
    const result = await API.savePredictions(userId, koPredictions);
    $('saveStatus').textContent = `✓ Saved ${result.saved} predictions`;
    $('saveStatus').style.color = 'var(--accent)';
    enterSavedState();
  } catch {
    $('saveStatus').textContent = '✗ Save failed';
    $('saveStatus').style.color = 'var(--red)';
  } finally {
    $('saveBtn').disabled  = false;
    $('saveBtn').textContent = 'Save Predictions';
  }
});

// ── Admin: save / delete result ───────────────────────────────────────────────

async function saveResult(matchId) {
  const h = parseInt(document.getElementById(`h_${matchId}`).value);
  const a = parseInt(document.getElementById(`a_${matchId}`).value);
  const status = document.getElementById(`status_${matchId}`);
  if (isNaN(h) || isNaN(a)) { status.textContent = '⚠ Enter both scores'; return; }
  status.textContent = 'Saving…';
  try {
    await API.saveResult(matchId, h, a, adminPassword);
    [fixtures, results, allPredictions] = await Promise.all([
      API.fixtures(), API.results(), API.allPredictions()
    ]);
    allTeams = buildAllTeams(fixtures);
    showRound(activeRound);
  } catch (e) {
    status.textContent = e.message.includes('401') ? '✗ Wrong password' : '✗ Error';
    status.style.color = 'var(--red)';
  }
}

async function deleteResult(matchId) {
  if (!confirm('Clear this result?')) return;
  try {
    await API.deleteResult(matchId, adminPassword);
    [fixtures, results, allPredictions] = await Promise.all([
      API.fixtures(), API.results(), API.allPredictions()
    ]);
    allTeams = buildAllTeams(fixtures);
    showRound(activeRound);
  } catch {
    document.getElementById(`status_${matchId}`).textContent = '✗ Error';
  }
}

init();
