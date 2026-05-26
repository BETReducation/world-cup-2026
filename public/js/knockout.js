// ── State ─────────────────────────────────────────────────────────────────────

let fixtures       = null;
let lockStatus     = {};
let koPredictions  = {};
let userId         = null;
let browseMode     = false;
let isSaved        = false;
let allTeams       = {};
let activeRound    = 'R32';
let matchNumMap    = {};  // matchId → FIFA match number

const ROUND_ORDER = ['R32', 'R16', 'QF', 'SF', '3P', 'F'];

const $ = id => document.getElementById(id);

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildAllTeams(fixtures) {
  const map = {};
  Object.values(fixtures.groups || {}).forEach(g => g.teams.forEach(t => { map[t.id] = t; }));
  return map;
}

function buildMatchNumMap(fixtures) {
  const map = {};
  Object.values(fixtures.knockout || {}).forEach(round => {
    (round.matches || []).forEach(m => { if (m.num) map[m.id] = m.num; });
  });
  return map;
}

function getTeam(id) {
  if (!id) return null;
  return allTeams[id] || { id, name: id, flag: '', flagCode: '' };
}

function fmtKoDate(dateStr, timeStr) {
  return fmtDate(dateStr || 'TBD', timeStr || 'TBD');
}

function fmtSlot(slot) {
  if (!slot) return '?';
  // 3rd-place group slot
  const m3rd = slot.match(/^3rd_([A-L]{2,})$/);
  if (m3rd) return `3rd(${m3rd[1]})`;
  // Group position: "1A", "2B" etc.
  if (/^[12][A-L]$/.test(slot)) return slot;
  // Winner/Loser of another match — use FIFA match number
  const mWL = slot.match(/^([WL]):(.+)$/);
  if (mWL) {
    const num = matchNumMap[mWL[2]];
    return num ? `${mWL[1]}${num}` : `${mWL[1]} ${mWL[2].replace('_', '-')}`;
  }
  return slot;
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

// Toggle between sign-in and forgot-password views
$('regForgotLink').addEventListener('click', e => {
  e.preventDefault();
  $('regSigninView').style.display = 'none';
  $('regForgotView').style.display = '';
  setTimeout(() => $('regForgotEmail').focus(), 50);
});
$('regForgotBack').addEventListener('click', e => {
  e.preventDefault();
  $('regForgotView').style.display = 'none';
  $('regSigninView').style.display = '';
});

$('regForgotSubmit').addEventListener('click', async () => {
  const em    = $('regForgotEmail').value.trim();
  const errEl = $('regForgotError');
  errEl.classList.add('hidden');
  if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
    errEl.textContent = 'Please enter a valid email address.';
    errEl.classList.remove('hidden');
    return;
  }
  const btn = $('regForgotSubmit');
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    await API.forgotPassword(em);
  } catch (e) {
    let msg = 'Could not send email. Please try again.';
    try { const d = JSON.parse(e.message); msg = d.error || msg; } catch {}
    errEl.textContent = msg; errEl.classList.remove('hidden');
    btn.disabled = false; btn.textContent = 'Send reset link →';
    return;
  }
  $('regForgotSuccess').classList.remove('hidden');
  $('regForgotEmailGroup').style.display = 'none';
  btn.style.display = 'none';
});

$('registerBtn').addEventListener('click', async () => {
  const name = $('regName').value.trim();
  const em   = $('regEmail').value.trim();
  const pw   = $('regPassword').value.trim();
  const lp   = $('regLegacyPin')?.value.trim() || null;
  const ac   = $('regAccessCode')?.value.trim() || null;
  const err  = $('registerError');
  err.classList.add('hidden');

  if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { showErr(err, 'Please enter a valid email address.'); return; }
  if (!pw || pw.length < 8) { showErr(err, 'Password must be at least 8 characters.'); return; }

  $('registerBtn').disabled    = true;
  $('registerBtn').textContent = 'Signing in…';
  try {
    const result = await API.register(name, em, pw, lp || null, ac || null);
    Session.save(result.userId, result.name, result.token);
    location.reload();
  } catch (e) {
    let msg = 'Could not connect to server. Is it running?';
    try { const d = JSON.parse(e.message); msg = d.error || msg; } catch {}
    showErr(err, msg);
    $('registerBtn').disabled    = false;
    $('registerBtn').textContent = 'Sign in →';
  }
});

$('regEmail').addEventListener('keydown',    e => { if (e.key === 'Enter') $('regPassword').focus(); });
$('regPassword').addEventListener('keydown', e => { if (e.key === 'Enter') $('registerBtn').click(); });
$('regName').addEventListener('keydown',     e => { if (e.key === 'Enter') $('regEmail').focus(); });

$('browseBtn').addEventListener('click', async () => {
  browseMode = true;
  $('registerModal').classList.remove('open');
  await loadAndRender();
});


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

  allTeams     = buildAllTeams(fixtures);
  matchNumMap  = buildMatchNumMap(fixtures);

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
    $('saveBtn').textContent  = 'Sign in to Save';
    $('saveBtn').onclick = () => location.reload();
  } else if (userId) {
    $('clearBtn').style.display = 'inline-flex';
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

  const lock   = lockStatus[roundKey];
  const locked = lock?.locked || false;
  let lockHtml = '';
  if (locked) {
    lockHtml = '<span class="lock-list-label"><i class="fa-solid fa-lock"></i> Predictions locked on:</span><span><i class="fa-solid fa-lock"></i> Locked</span>';
  } else if (lock?.lockTime) {
    lockHtml = '<span class="lock-list-label"><i class="fa-solid fa-lock"></i> Predictions locked on:</span>' +
      fmtLockLines(lock.lockTime).map(l => `<span>${l}</span>`).join('');
  }

  let html = `<div class="card">`;
  html += `<div class="ko-round-header">
    <span class="ko-round-title">${round.name || roundKey}</span>
    ${lockHtml ? `<div class="ko-lock-info">${lockHtml}</div>` : ''}
  </div>`;
  html += `<div class="match-list">`;

  const sortedMatches = [...round.matches].sort((a, b) => (a.num || 0) - (b.num || 0));
  for (const m of sortedMatches) {
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
        <div class="match-meta">${m.num ? `<span class="match-num">#${m.num}</span>` : ''}${fmtKoDate(m.date, m.time)}</div>
        <div class="team-name">
          ${homeFlag ? `<span class="flag fi fi-${homeFlag}"></span>` : ''}${homeName}
        </div>
        <div class="score-input">
          <input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" value="${pred.home}" ${dis}
            data-match="${m.id}" data-side="home" class="ko-pred-input"
            autocomplete="off" aria-label="${homeName} goals">
          <span class="score-sep">–</span>
          <input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" value="${pred.away}" ${dis}
            data-match="${m.id}" data-side="away" class="ko-pred-input"
            autocomplete="off" aria-label="${awayName} goals">
          <div class="slot-hint">${fmtSlot(m.homeSlot)} vs ${fmtSlot(m.awaySlot)}</div>
        </div>
        <div class="team-name right">
          ${awayName}${awayFlag ? `<span class="flag fi fi-${awayFlag}"></span>` : ''}
        </div>
        ${locked ? '<span class="lock-badge">LOCKED</span>' : ''}
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
  e.target.value = e.target.value.replace(/[^0-9]/g, '');
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
  } catch (e) {
    const expired = e.message && e.message.includes('Session');
    $('saveStatus').textContent = expired ? '✗ Session expired — please sign in again' : '✗ Save failed';
    $('saveStatus').style.color = 'var(--red)';
    if (expired) { Session.clear(); setTimeout(() => location.reload(), 2000); }
  } finally {
    $('saveBtn').disabled    = false;
    $('saveBtn').textContent = 'Save Predictions';
  }
});

// ── Reset unlocked knockout predictions ──────────────────────────────────────

$('clearBtn').addEventListener('click', async () => {
  if (!fixtures) return;

  // Collect match IDs whose round is not yet locked
  const toDelete = [];
  Object.entries(fixtures.knockout || {}).forEach(([roundKey, round]) => {
    if (!lockStatus[roundKey]?.locked) {
      (round.matches || []).forEach(m => toDelete.push(m.id));
    }
  });

  if (toDelete.length === 0) {
    alert('All rounds are locked — there are no predictions to reset.');
    return;
  }

  if (!confirm(`Reset predictions for ${toDelete.length} unlocked match${toDelete.length === 1 ? '' : 'es'}? Locked rounds will not be affected.`)) return;

  toDelete.forEach(id => delete koPredictions[id]);

  $('clearBtn').disabled = true;
  $('clearBtn').textContent = 'Resetting…';
  try {
    await API.savePredictions(userId, koPredictions);
    showRound(activeRound);
    enterEditState();
    $('saveStatus').textContent = '✓ Predictions reset';
    $('saveStatus').style.color = 'var(--accent)';
  } catch (e) {
    const expired = e.message && e.message.includes('Session');
    $('saveStatus').textContent = expired ? '✗ Session expired — please sign in again' : '✗ Reset failed';
    $('saveStatus').style.color = 'var(--red)';
    if (expired) { Session.clear(); setTimeout(() => location.reload(), 2000); }
  } finally {
    $('clearBtn').disabled = false;
    $('clearBtn').textContent = 'Reset Predictions';
  }
});

init();
