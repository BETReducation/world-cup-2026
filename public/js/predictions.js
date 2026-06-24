let fixtures = null;
let lockStatus = {};
let userPredictions = {};
let allPredictions = [];
let userId = null;
let browseMode = false;
let isSaved = false;
let activeGroup = 'A';

const $ = id => document.getElementById(id);

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

// ── Registration ─────────────────────────────────────────────────────────────

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
  const em   = $('regForgotEmail').value.trim();
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
    $('registerBtn').textContent = 'Sign in / Sign up →';
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


function showErr(el, msg) {
  el.textContent = msg;
  el.style.display = 'block';
}

// ── Load & render ─────────────────────────────────────────────────────────────

async function loadAndRender() {
  $('loadingState').style.display = 'block';
  try {
    [fixtures, lockStatus] = await Promise.all([API.fixtures(), API.lockStatus()]);
  } catch {
    $('loadingState').innerHTML =
      '<p style="color:var(--red);">⚠️ Could not reach server. Make sure <code>node server.js</code> is running.</p>';
    return;
  }

  if (userId) {
    try {
      const saved = await API.myPredictions(userId);
      userPredictions = saved.predictions || {};
    } catch (e) {
      const msg = e.message || '';
      // Only clear the session on a definitive auth rejection, not transient errors.
      if (msg.includes('401') || msg.includes('Unauthorized')) {
        Session.clear();
        location.reload();
        return;
      }
      // Network error or 404 — keep session, continue with empty predictions.
      userPredictions = {};
    }
  }

  // Fetch all players' predictions for any round that is already locked
  const anyLocked = Object.values(lockStatus).some(s => s.locked);
  if (anyLocked) {
    try { allPredictions = await API.allPredictions(); } catch { allPredictions = []; }
  }

  $('loadingState').style.display = 'none';
  $('predictionsApp').style.display = 'block';

  if (browseMode) {
    $('playerName').textContent = 'Guest';
    $('saveBtn').textContent = 'Sign in to Save';
    $('saveBtn').onclick = () => { location.reload(); };
  } else if (userId) {
    $('clearBtn').style.display      = 'inline-flex';
    $('clearGroupBtn').style.display = 'inline-flex';
  }

  buildTabs();
  showGroup(activeGroup);

  if (userId && Object.keys(userPredictions).length > 0) {
    enterSavedState();
  }
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function buildTabs() {
  const bar = $('groupTabs');
  bar.innerHTML = '';
  Object.keys(fixtures.groups).forEach(key => {
    const btn = document.createElement('button');
    btn.className = 'tab-btn' + (key === activeGroup ? ' active' : '');
    btn.dataset.group = key;
    btn.innerHTML = `<span class="tab-label-long">Group ${key}</span><span class="tab-label-short">${key}</span>`;
    btn.addEventListener('click', () => {
      activeGroup = key;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      showGroup(key);
      const cgb = $('clearGroupBtn');
      if (cgb) cgb.textContent = `Reset Group ${key}`;
    });
    bar.appendChild(btn);
  });
}

// ── Group panel ───────────────────────────────────────────────────────────────

function showGroup(groupKey) {
  const panels  = $('groupPanels');
  const group   = fixtures.groups[groupKey];

  const rounds = {};
  group.matches.forEach(m => (rounds[m.round] = rounds[m.round] || []).push(m));

  let html = `<div class="card"><div class="group-layout predictions-layout">`;

  // Left: match inputs
  html += `<div>`;
  Object.entries(rounds).forEach(([round, matches]) => {
    const locked   = lockStatus[round]?.locked;
    const lockTime = lockStatus[round]?.lockTime;
    let lockHtml = '';
    if (locked) {
      lockHtml = '<span class="lock-list-label"><i class="fa-solid fa-lock"></i> Predictions locked on:</span><span><i class="fa-solid fa-lock"></i> Locked</span>';
    } else if (lockTime) {
      lockHtml = '<span class="lock-list-label"><i class="fa-solid fa-lock"></i> Predictions locked on:</span>' + fmtLockLines(lockTime).map(l => `<span>${l}</span>`).join('');
    }

    html += `<div class="round-heading">
      <span class="round-label">Round ${round} – Predictions</span>
      <div class="round-lock-list">${lockHtml}</div>
    </div>`;
    html += `<div class="match-list">`;

    matches.forEach(m => {
      const home = group.teams.find(t => t.id === m.home);
      const away = group.teams.find(t => t.id === m.away);
      const pred = userPredictions[m.id] || { home: '', away: '' };
      const dis  = locked ? 'disabled' : '';
      const cls  = locked ? 'round-locked' : '';

      const hasComparison = locked && allPredictions.length > 0;
      html += `
        <div class="match-row ${cls}${hasComparison ? ' has-predictions' : ''}"${hasComparison ? ` onclick="togglePredComparison('cmp_${m.id}', this)"` : ''}>
          <div class="match-meta">${fmtDate(m.date, m.time)}${m.note ? `<span class="match-note">(${m.note})</span>` : ''}</div>
          <div class="team-name">
            <span class="flag fi fi-${home.flagCode}"></span>${home.name}
          </div>
          <div class="score-input">
            <input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" value="${pred.home}" ${dis}
              data-match="${m.id}" data-side="home" class="pred-input"
              autocomplete="off" aria-label="${home.name} goals">
            <span class="score-sep">–</span>
            <input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" value="${pred.away}" ${dis}
              data-match="${m.id}" data-side="away" class="pred-input"
              autocomplete="off" aria-label="${away.name} goals">
          </div>
          <div class="team-name right">
            ${away.name}<span class="flag fi fi-${away.flagCode}"></span>
          </div>
          ${locked ? '<span class="lock-badge">LOCKED</span>' : ''}
          ${hasComparison ? '<span class="pred-chevron">▶</span>' : ''}
        </div>`;

      if (hasComparison) {
        const rows = allPredictions.map(user => {
          const p = user.predictions?.[m.id];
          if (p == null)
            return `<tr><td>${user.name}</td><td class="pred-score" colspan="2" style="color:var(--muted);">—</td></tr>`;
          return `<tr><td>${user.name}</td><td class="pred-score">${p.home} – ${p.away}</td><td>—</td></tr>`;
        }).join('');
        html += `
          <div class="comparison-panel" id="cmp_${m.id}" style="display:none;">
            <table>
              <thead><tr><th>Player</th><th>Prediction</th><th>Points</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>`;
      }
    });

    html += `</div>`;
  });
  html += `</div>`;

  html += `</div></div>`;
  panels.innerHTML = html;

  panels.querySelectorAll('.pred-input').forEach(input => {
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

  if (!userPredictions[match]) userPredictions[match] = { home: '', away: '' };
  userPredictions[match][side] = val === '' ? '' : Number(val);

  $('saveStatus').textContent = '';
}


// ── Saved / edit state ────────────────────────────────────────────────────────

function enterSavedState() {
  isSaved = true;
  document.querySelectorAll('.pred-input').forEach(el => el.classList.add('saved'));
  $('editBtn').style.display = 'inline-flex';
  $('saveBtn').style.display = 'none';
  $('saveStatus').textContent = '';
}

function enterEditState() {
  isSaved = false;
  document.querySelectorAll('.pred-input').forEach(el => el.classList.remove('saved'));
  $('editBtn').style.display = 'none';
  $('saveBtn').style.display = 'inline-flex';
  $('saveStatus').textContent = '';
}

$('editBtn').addEventListener('click', enterEditState);

// ── Save ──────────────────────────────────────────────────────────────────────

$('saveBtn').addEventListener('click', async () => {
  if (browseMode) { location.reload(); return; }
  $('saveBtn').disabled = true;
  $('saveBtn').textContent = 'Saving…';
  $('saveStatus').textContent = '';

  try {
    const result = await API.savePredictions(userId, userPredictions);
    $('saveStatus').textContent = `✓ Saved ${result.saved} predictions`;
    $('saveStatus').style.color = 'var(--accent)';
    enterSavedState();
  } catch (e) {
    const expired = e.message && e.message.includes('Session');
    $('saveStatus').textContent = expired ? '✗ Session expired — please sign in again' : '✗ Save failed';
    $('saveStatus').style.color = 'var(--red)';
    if (expired) { Session.clear(); setTimeout(() => location.reload(), 2000); }
  } finally {
    $('saveBtn').disabled = false;
    $('saveBtn').textContent = 'Save Predictions';
  }
});

// ── Reset unlocked predictions for the active group only ─────────────────────

$('clearGroupBtn').addEventListener('click', async () => {
  if (!fixtures) return;
  const group = fixtures.groups[activeGroup];
  if (!group) return;

  const toDelete = [];
  const byRound = {};
  group.matches.forEach(m => (byRound[m.round] = byRound[m.round] || []).push(m));
  Object.entries(byRound).forEach(([round, matches]) => {
    if (!lockStatus[round]?.locked) matches.forEach(m => toDelete.push(m.id));
  });

  if (toDelete.length === 0) {
    alert(`Group ${activeGroup} predictions are all locked — nothing to reset.`);
    return;
  }

  if (!confirm(`Reset predictions for Group ${activeGroup} (${toDelete.length} unlocked match${toDelete.length === 1 ? '' : 'es'})? Locked rounds will not be affected.`)) return;

  toDelete.forEach(id => delete userPredictions[id]);

  $('clearGroupBtn').disabled = true;
  $('clearGroupBtn').textContent = 'Resetting…';
  try {
    await API.savePredictions(userId, userPredictions);
    showGroup(activeGroup);
    renderAllTables();
    enterEditState();
    $('saveStatus').textContent = `✓ Group ${activeGroup} predictions reset`;
    $('saveStatus').style.color = 'var(--accent)';
  } catch (e) {
    const expired = e.message && e.message.includes('Session');
    $('saveStatus').textContent = expired ? '✗ Session expired — please sign in again' : '✗ Reset failed';
    $('saveStatus').style.color = 'var(--red)';
    if (expired) { Session.clear(); setTimeout(() => location.reload(), 2000); }
  } finally {
    $('clearGroupBtn').disabled = false;
    $('clearGroupBtn').textContent = `Reset Group ${activeGroup}`;
  }
});

// ── Reset unlocked group stage predictions ───────────────────────────────────

$('clearBtn').addEventListener('click', async () => {
  if (!fixtures) return;

  // Collect match IDs whose round is not yet locked
  const toDelete = [];
  Object.values(fixtures.groups).forEach(g => {
    const byRound = {};
    g.matches.forEach(m => (byRound[m.round] = byRound[m.round] || []).push(m));
    Object.entries(byRound).forEach(([round, matches]) => {
      if (!lockStatus[round]?.locked) {
        matches.forEach(m => toDelete.push(m.id));
      }
    });
  });

  if (toDelete.length === 0) {
    alert('All rounds are locked — there are no predictions to reset.');
    return;
  }

  if (!confirm(`Reset predictions for ${toDelete.length} unlocked match${toDelete.length === 1 ? '' : 'es'}? Locked rounds will not be affected.`)) return;

  toDelete.forEach(id => delete userPredictions[id]);

  $('clearBtn').disabled = true;
  $('clearBtn').textContent = 'Resetting…';
  try {
    await API.savePredictions(userId, userPredictions);
    showGroup(activeGroup);
    renderAllTables();
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
    $('clearBtn').textContent = 'Reset All';
  }
});

// ── All-predictions comparison toggle ─────────────────────────────────────────

function togglePredComparison(panelId, row) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  const open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : '';
  const chevron = row.querySelector('.pred-chevron');
  if (chevron) chevron.textContent = open ? '▶' : '▼';
}

init();
