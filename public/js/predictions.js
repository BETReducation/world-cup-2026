let fixtures = null;
let lockStatus = {};
let userPredictions = {};
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

$('registerBtn').addEventListener('click', async () => {
  const name = $('regName').value.trim();
  const pin  = $('regPin').value.trim();
  const err  = $('registerError');

  err.style.display = 'none';
  if (!name) { showErr(err, 'Please enter your name.'); return; }
  if (!/^\d{4}$/.test(pin)) { showErr(err, 'PIN must be exactly 4 digits.'); return; }

  $('registerBtn').disabled = true;
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
    $('registerBtn').disabled = false;
    $('registerBtn').textContent = 'Continue →';
  }
});

$('regPin').addEventListener('keydown', e => { if (e.key === 'Enter') $('registerBtn').click(); });
$('regName').addEventListener('keydown', e => { if (e.key === 'Enter') $('regPin').focus(); });

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
    } catch {
      // User not found — session is stale (e.g. server redeployed). Clear and re-register.
      Session.clear();
      location.reload();
      return;
    }
  }

  $('loadingState').style.display = 'none';
  $('predictionsApp').style.display = 'block';
  $('allTablesSection').style.display = 'block';

  if (browseMode) {
    $('playerName').textContent = 'Guest';
    $('saveBtn').textContent = 'Sign in to Save';
    $('saveBtn').onclick = () => { location.reload(); };
  }

  buildTabs();
  showGroup(activeGroup);
  renderAllTables();

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
    btn.textContent = `Group ${key}`;
    btn.addEventListener('click', () => {
      activeGroup = key;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      showGroup(key);
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

  let html = `<div class="card"><div class="group-layout">`;

  // Left: match inputs
  html += `<div>`;
  Object.entries(rounds).forEach(([round, matches]) => {
    const locked   = lockStatus[round]?.locked;
    const lockTime = lockStatus[round]?.lockTime;
    const lockLabel = locked
      ? '🔒 Locked'
      : lockTime
        ? `Locks · ${fmtLockTimezones(lockTime)}`
        : '';

    html += `<div class="round-heading">Round ${round}<br><span class="lock-info">${lockLabel}</span></div>`;
    html += `<div class="match-list">`;

    matches.forEach(m => {
      const home = group.teams.find(t => t.id === m.home);
      const away = group.teams.find(t => t.id === m.away);
      const pred = userPredictions[m.id] || { home: '', away: '' };
      const dis  = locked ? 'disabled' : '';
      const cls  = locked ? 'round-locked' : '';

      html += `
        <div class="match-row ${cls}">
          <div class="match-meta">${fmtDate(m.date, m.time)}</div>
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
        </div>`;
    });

    html += `</div>`;
  });
  html += `</div>`;

  // Right: live predicted table
  html += `
    <div>
      <p class="table-heading">Predicted Standings</p>
      <div id="liveTable_${groupKey}"></div>
    </div>`;

  html += `</div></div>`;
  panels.innerHTML = html;

  panels.querySelectorAll('.pred-input').forEach(input => {
    input.addEventListener('input', onPredInput);
    if (isSaved) input.classList.add('saved');
  });

  renderLiveTable(groupKey);
}

// ── Input handler ─────────────────────────────────────────────────────────────

function onPredInput(e) {
  e.target.value = e.target.value.replace(/[^0-9]/g, '');
  const { match, side } = e.target.dataset;
  let val = e.target.value === '' ? '' : Math.max(0, Math.min(20, parseInt(e.target.value) || 0));
  if (e.target.value !== '' && val !== parseInt(e.target.value)) e.target.value = val;

  if (!userPredictions[match]) userPredictions[match] = { home: '', away: '' };
  userPredictions[match][side] = val === '' ? '' : Number(val);

  renderLiveTable(activeGroup);
  renderAllTables();
  $('saveStatus').textContent = '';
}

// ── Live table ────────────────────────────────────────────────────────────────

function renderLiveTable(groupKey) {
  const el = document.getElementById(`liveTable_${groupKey}`);
  if (!el) return;
  const group = fixtures.groups[groupKey];
  renderTable(el, calcGroupTable(group.teams, group.matches, userPredictions));
}

// ── All tables grid ───────────────────────────────────────────────────────────

function renderAllTables() {
  const grid = $('allTablesGrid');
  grid.innerHTML = '';
  Object.entries(fixtures.groups).forEach(([key, group]) => {
    const rows = calcGroupTable(group.teams, group.matches, userPredictions);
    const div  = document.createElement('div');
    div.className = 'card';
    renderTable(div, rows, `Group ${key}`);
    grid.appendChild(div);
  });
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
  } catch {
    $('saveStatus').textContent = '✗ Save failed';
    $('saveStatus').style.color = 'var(--red)';
  } finally {
    $('saveBtn').disabled = false;
    $('saveBtn').textContent = 'Save Predictions';
  }
});

init();
