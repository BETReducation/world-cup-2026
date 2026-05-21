// ── State ─────────────────────────────────────────────────────────────────────

let fixtures       = null;
let lockStatus     = {};
let koPredictions  = {};
let userId         = null;
let browseMode     = false;
let isSaved        = false;
let allTeams       = {};
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
  return allTeams[id] || { id, name: id, flag: '', flagCode: '' };
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

  $('registerBtn').disabled    = true;
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
    $('registerBtn').disabled    = false;
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

// ── Load & render ─────────────────────────────────────────────────────────────

async function loadAndRender() {
  $('loadingState').style.display = 'block';
  try {
    [fixtures, lockStatus] = await Promise.all([
      API.fixtures(), API.lockStatus()
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
    const home       = m.home ? getTeam(m.home) : null;
    const away       = m.away ? getTeam(m.away) : null;
    const homeName   = home ? home.name  : (m.homeLabel || m.homeSlot || 'TBD');
    const awayName   = away ? away.name  : (m.awayLabel || m.awaySlot || 'TBD');
    const homeFlag   = home ? home.flagCode : '';
    const awayFlag   = away ? away.flagCode : '';
    const teamsKnown = !!(m.home && m.away);
    const inputActive = teamsKnown && !locked && !browseMode && userId;
    const dis        = inputActive ? '' : 'disabled';
    const cls        = locked ? 'round-locked' : '';
    const pred       = koPredictions[m.id] || { home: '', away: '' };

    html += `
      <div class="match-row ${cls}" id="row_${m.id}">
        <div class="match-meta">${fmtKoDate(m.date, m.time)}<br>${m.venue || 'Venue TBD'}</div>
        <div class="team-name">
          ${homeFlag ? `<span class="flag fi fi-${homeFlag}"></span>` : ''}${homeName}
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
          ${awayName}${awayFlag ? `<span class="flag fi fi-${awayFlag}"></span>` : ''}
        </div>
        ${locked     ? '<span class="lock-badge">LOCKED</span>' : ''}
        ${!teamsKnown && !locked ? '<span class="tbd-badge">TEAMS TBD</span>' : ''}
      </div>`;
  }

  html += `</div></div>`;
  panels.innerHTML = html;

  panels.querySelectorAll('.ko-pred-input').forEach(input => {
    input.addEventListener('input', onPredInput);
    if (isSaved) input.classList.add('saved');
  });
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
  $('editBtn').style.display  = 'inline-flex';
  $('saveBtn').style.display  = 'none';
  $('saveStatus').textContent = '';
}

function enterEditState() {
  isSaved = false;
  document.querySelectorAll('.ko-pred-input').forEach(el => el.classList.remove('saved'));
  $('editBtn').style.display  = 'none';
  $('saveBtn').style.display  = 'inline-flex';
  $('saveStatus').textContent = '';
}

$('editBtn').addEventListener('click', enterEditState);

// ── Save predictions ──────────────────────────────────────────────────────────

$('saveBtn').addEventListener('click', async () => {
  if (browseMode) { location.reload(); return; }
  $('saveBtn').disabled    = true;
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
    $('saveBtn').disabled    = false;
    $('saveBtn').textContent = 'Save Predictions';
  }
});

init();
