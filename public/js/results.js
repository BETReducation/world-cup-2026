let fixtures       = null;
let allPredictions = [];
let results        = {};
let adminPassword  = null;
let isAdmin        = false;
let activeGroup    = 'A';
let allTeams       = {};
let lockStatus     = {};
let activeKoRound  = null;

const $ = id => document.getElementById(id);

const KO_ROUND_ORDER = ['R32', 'R16', 'QF', 'SF', '3P', 'F'];
const KO_ROUND_NAMES = { R32: 'R32', R16: 'R16', QF: 'QF', SF: 'SF', '3P': '3P', F: 'Final' };

async function init() {
  try {
    [fixtures, allPredictions, results, lockStatus] = await Promise.all([
      API.fixtures(), API.allPredictions(), API.results(), API.lockStatus()
    ]);
  } catch {
    $('loadingState').innerHTML =
      '<p style="color:var(--red);">⚠️ Could not reach server. Make sure <code>node server.js</code> is running.</p>';
    return;
  }

  allTeams = buildKoTeamsMap(fixtures);

  $('loadingState').style.display = 'none';
  $('resultsApp').style.display   = 'block';

  // Auto-detect admin account (Gary) via session token
  try {
    const me = await API.me();
    if (me.isAdmin) {
      isAdmin = true;
      $('adminLabel').textContent    = '✓ Admin active';
      $('adminToggleBtn').style.display = 'none';
      $('adminBackup').classList.remove('hidden');
    }
  } catch {}

  buildTabs();
  showGroup(activeGroup);
  renderLeaderboard();
}

// ── Admin ─────────────────────────────────────────────────────────────────────

$('adminToggleBtn').addEventListener('click', async () => {
  if (isAdmin) {
    isAdmin       = false;
    adminPassword = null;
    $('adminLabel').textContent   = '';
    $('adminToggleBtn').innerHTML = '<i class="fa-solid fa-key"></i> Admin Mode';
    $('adminBackup').classList.add('hidden');
    if (activeKoRound) showKoRound(activeKoRound); else showGroup(activeGroup);
  } else {
    // Check if session already grants admin access (Gary)
    const me = await API.me().catch(() => ({}));
    if (me.isAdmin) {
      isAdmin = true;
      $('adminLabel').textContent   = '✓ Admin active';
      $('adminToggleBtn').innerHTML = 'Exit Admin';
      $('adminBackup').classList.remove('hidden');
      if (activeKoRound) showKoRound(activeKoRound); else showGroup(activeGroup);
    } else {
      $('adminModal').classList.add('open');
      $('adminPwdInput').value = '';
      setTimeout(() => $('adminPwdInput').focus(), 50);
    }
  }
});

$('adminLoginBtn').addEventListener('click', async () => {
  const pwd = $('adminPwdInput').value.trim();
  if (!pwd) return;
  $('adminLoginBtn').disabled    = true;
  $('adminLoginBtn').textContent = 'Checking…';
  const ok = await API.verifyAdmin(pwd);
  $('adminLoginBtn').disabled    = false;
  $('adminLoginBtn').textContent = 'Login';
  if (!ok) {
    $('adminError').textContent = '✗ Incorrect password';
    $('adminError').classList.remove('hidden');
    return;
  }
  adminPassword = pwd;
  isAdmin = true;
  $('adminError').classList.add('hidden');
  $('adminModal').classList.remove('open');
  $('adminLabel').textContent     = '✓ Admin active';
  $('adminToggleBtn').textContent = 'Exit Admin';
  $('adminBackup').classList.remove('hidden');
  if (activeKoRound) showKoRound(activeKoRound); else showGroup(activeGroup);
});

$('adminCancelBtn').addEventListener('click', () => $('adminModal').classList.remove('open'));
$('adminPwdInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('adminLoginBtn').click(); });

// ── Clear Results ─────────────────────────────────────────────────────────────

$('downloadBackupBtn').addEventListener('click', async () => {
  const pwd = adminPassword || '';
  const res = await fetch('/api/admin/backup', { headers: { 'x-admin-password': pwd } });
  if (!res.ok) { alert('Backup failed — are you logged in as admin?'); return; }
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || 'wc2026-backup.json';
  a.click();
  URL.revokeObjectURL(url);
});

$('clearResultsBtn').addEventListener('click', async () => {
  if (!confirm('Clear ALL results? This cannot be undone.')) return;
  const status = $('restoreStatus');
  status.textContent = 'Clearing…';
  status.style.color = 'var(--text-muted)';
  try {
    await API.adminClearResults(adminPassword);
    status.textContent = '✓ Results cleared — reloading…';
    status.style.color = 'var(--accent)';
    setTimeout(() => location.reload(), 1000);
  } catch {
    status.textContent = '✗ Failed to clear results';
    status.style.color = 'var(--red)';
  }
});

// ── Tabs ──────────────────────────────────────────────────────────────────────

function buildTabs() {
  const bar = $('groupTabs');
  bar.innerHTML = '';

  Object.keys(fixtures.groups).forEach(key => {
    const btn = document.createElement('button');
    btn.className = 'tab-btn' + (key === activeGroup ? ' active' : '');
    btn.textContent = `Group ${key}`;
    btn.addEventListener('click', () => {
      activeGroup   = key;
      activeKoRound = null;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      showGroup(key);
    });
    bar.appendChild(btn);
  });

  KO_ROUND_ORDER.forEach(key => {
    if (!fixtures.knockout?.[key]) return;
    const btn = document.createElement('button');
    btn.className = 'tab-btn';
    btn.textContent = KO_ROUND_NAMES[key] || key;
    btn.addEventListener('click', () => {
      activeKoRound = key;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      showKoRound(key);
    });
    bar.appendChild(btn);
  });
}

// ── Group panel ───────────────────────────────────────────────────────────────

function showGroup(groupKey) {
  const panels = $('resultsPanels');
  const group  = fixtures.groups[groupKey];

  const rounds = {};
  group.matches.forEach(m => (rounds[m.round] = rounds[m.round] || []).push(m));

  let html = `<div class="card"><div class="group-layout">`;

  html += `<div>`;
  Object.entries(rounds).forEach(([round, matches]) => {
    html += `<div class="round-heading">Round ${round}</div>`;

    matches.forEach(m => {
      const home   = group.teams.find(t => t.id === m.home);
      const away   = group.teams.find(t => t.id === m.away);
      const result = results.results?.[m.id];
      const played = result?.played;

      const hasComparison = played || isAdmin;
      html += `
        <div class="result-row ${played ? '' : 'not-played'}${hasComparison ? ' has-predictions' : ''}"${hasComparison ? ` onclick="toggleComparison('cmp_${m.id}', this)"` : ''}>
          <div class="match-meta">${fmtDate(m.date, m.time)}${m.note ? `<span class="match-note">(${m.note})</span>` : ''}</div>
          <div class="team-name"><span class="flag fi fi-${home.flagCode}"></span>${home.name}</div>
          <div class="scoreline">${played ? `${result.home} – ${result.away}` : 'vs'}</div>
          <div class="team-name right">${away.name}<span class="flag fi fi-${away.flagCode}"></span></div>
          ${hasComparison ? `<span class="pred-chevron">▶</span>` : ''}
        </div>`;

      if (hasComparison) {
        html += buildComparisonBlock(m, result, played);
      }

      if (isAdmin) {
        const h = played ? result.home : '';
        const a = played ? result.away : '';
        html += `
          <div class="admin-panel">
            <h4>${home.name} vs ${away.name}</h4>
            <div class="score-entry">
              <input type="number" min="0" max="20" value="${h}" id="h_${m.id}" placeholder="0">
              <span class="score-sep">–</span>
              <input type="number" min="0" max="20" value="${a}" id="a_${m.id}" placeholder="0">
              <button class="btn btn-primary btn-sm" onclick="saveResult('${m.id}')">Save</button>
              ${played ? `<button class="btn btn-danger btn-sm" onclick="deleteResult('${m.id}')">Clear</button>` : ''}
              <span id="status_${m.id}" style="font-family:'JetBrains Mono',monospace; font-size:11px; color:var(--accent);"></span>
            </div>
          </div>`;
      }
    });
  });
  html += `</div>`;

  html += `
    <div class="table-scroll-wrap">
      <p class="table-heading">Group ${groupKey} Table</p>
      <div id="actualTable_${groupKey}"></div>
    </div>`;

  html += `</div></div>`;
  panels.innerHTML = html;

  renderActualTable(groupKey);
}

// ── Knockout panel ────────────────────────────────────────────────────────────

function buildKoTeamsMap(fixtures) {
  const map = {};
  Object.values(fixtures.groups || {}).forEach(g => g.teams.forEach(t => { map[t.id] = t; }));
  return map;
}

function getKoTeam(id) {
  if (!id) return null;
  return allTeams[id] || { id, name: id, flag: '', flagCode: '' };
}

function fmtKoMatchDate(dateStr, timeStr) {
  return fmtDate(dateStr || 'TBD', timeStr || 'TBD');
}

function showKoRound(roundKey) {
  const panels = $('resultsPanels');
  const round  = fixtures.knockout?.[roundKey];
  if (!round) { panels.innerHTML = ''; return; }

  let html = `<div class="card">`;
  html += `<div class="ko-round-header">
    <span class="ko-round-title">${round.name || roundKey}</span>
  </div>`;
  html += `<div class="match-list">`;

  for (const m of round.matches) {
    const home       = m.home ? getKoTeam(m.home) : null;
    const away       = m.away ? getKoTeam(m.away) : null;
    const homeName   = home ? home.name : (m.homeLabel || m.homeSlot || 'TBD');
    const awayName   = away ? away.name : (m.awayLabel || m.awaySlot || 'TBD');
    const homeFlag   = home ? home.flagCode : '';
    const awayFlag   = away ? away.flagCode : '';
    const teamsKnown = !!(m.home && m.away);
    const result     = results.results?.[m.id];
    const played     = result?.played;

    const hasComparison = played || isAdmin;
    html += `
      <div class="result-row ${played ? '' : 'not-played'}${hasComparison ? ' has-predictions' : ''}" id="row_${m.id}"${hasComparison ? ` onclick="toggleComparison('cmp_${m.id}', this)"` : ''}>
        <div class="match-meta">${fmtKoMatchDate(m.date, m.time)}</div>
        <div class="team-name">
          ${homeFlag ? `<span class="flag fi fi-${homeFlag}"></span>` : ''}${homeName}
        </div>
        <div class="scoreline">${played ? `${result.home} – ${result.away}` : 'vs'}</div>
        <div class="team-name right">
          ${awayName}${awayFlag ? `<span class="flag fi fi-${awayFlag}"></span>` : ''}
        </div>
        ${hasComparison ? `<span class="pred-chevron">▶</span>` : ''}
      </div>`;

    if (hasComparison) {
      html += buildComparisonBlock(m, result, played);
    }

    if (isAdmin && teamsKnown) {
      const h = played ? result.home : '';
      const a = played ? result.away : '';
      html += `
        <div class="admin-panel">
          <h4>${homeName} vs ${awayName} — record result (90 mins)</h4>
          <div class="score-entry">
            <input type="number" min="0" max="20" value="${h}" id="h_${m.id}" placeholder="0">
            <span class="score-sep">–</span>
            <input type="number" min="0" max="20" value="${a}" id="a_${m.id}" placeholder="0">
            <button class="btn btn-primary btn-sm" onclick="saveKoResult('${m.id}')">Save</button>
            ${played ? `<button class="btn btn-danger btn-sm" onclick="deleteKoResult('${m.id}')">Clear</button>` : ''}
            <span id="status_${m.id}" style="font-family:'JetBrains Mono',monospace; font-size:11px; color:var(--accent);"></span>
          </div>
        </div>`;
    }
  }

  html += `</div></div>`;
  panels.innerHTML = html;
}

// ── Comparison toggle ─────────────────────────────────────────────────────────

function toggleComparison(panelId, row) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  const open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : '';
  const chevron = row.querySelector('.pred-chevron');
  if (chevron) chevron.textContent = open ? '▶' : '▼';
}

// ── Comparison block ──────────────────────────────────────────────────────────

function buildComparisonBlock(match, result, played) {
  if (!allPredictions.length) return '';

  const rows = allPredictions.map(user => {
    const pred = user.predictions?.[match.id];
    if (pred === undefined || pred === null)
      return `<tr><td>${user.name}</td><td class="pred-score" colspan="2" style="color:var(--muted);">—</td></tr>`;

    const predStr = `${pred.home} – ${pred.away}`;
    let pts = 0, ptsClass = 'pts-0';

    if (played) {
      const aSign = Math.sign(result.home - result.away);
      const pSign = Math.sign(pred.home - pred.away);
      if (aSign === pSign) {
        pts = 3;
        if (pred.home === result.home && pred.away === result.away) pts = 5;
      }
      ptsClass = pts === 5 ? 'pts-5' : pts === 3 ? 'pts-3' : 'pts-0';
    }

    return `<tr>
      <td>${user.name}</td>
      <td class="pred-score">${predStr}</td>
      <td>${played ? `<span class="pts-badge ${ptsClass}">${pts} pts</span>` : '—'}</td>
    </tr>`;
  }).join('');

  const panelId = `cmp_${match.id}`;
  return `
    <div class="comparison-panel" id="${panelId}" style="display:none;">
      <table>
        <thead><tr>
          <th>Player</th>
          <th>Prediction</th>
          <th>${played ? 'Points' : 'Pending'}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ── Actual group table ────────────────────────────────────────────────────────

function renderActualTable(groupKey) {
  const el = document.getElementById(`actualTable_${groupKey}`);
  if (!el) return;
  const group  = fixtures.groups[groupKey];
  const scores = {};
  group.matches.forEach(m => {
    if (results.results?.[m.id]?.played) scores[m.id] = results.results[m.id];
  });
  renderTable(el, calcGroupTable(group.teams, group.matches, scores));
}

// ── Leaderboard ───────────────────────────────────────────────────────────────

async function renderLeaderboard() {
  const [board, prevData] = await Promise.all([
    API.leaderboard().catch(() => []),
    fetch('/api/leaderboard/previous').then(r => r.json()).catch(() => ({ positions: {} }))
  ]);
  const prevPos = prevData.positions || {};
  const el = $('leaderboardContent');

  if (!board.length) {
    el.innerHTML = '<p style="color:var(--muted); font-size:13px;">No players registered yet.</p>';
    return;
  }

  const matchRound  = {};
  const roundTotals = {};
  let totalGroupMatches = 0;
  Object.values(fixtures.groups).forEach(g => {
    g.matches.forEach(m => {
      matchRound[m.id] = m.round;
      roundTotals[m.round] = (roundTotals[m.round] || 0) + 1;
      totalGroupMatches++;
    });
  });
  const groupRounds = Object.keys(roundTotals).sort();

  const koMatchIds = new Set();
  let totalKoMatches = 0;
  Object.values(fixtures.knockout || {}).forEach(r => {
    (r.matches || []).forEach(m => { koMatchIds.add(m.id); totalKoMatches++; });
  });

  const totalMatches = totalGroupMatches + totalKoMatches;

  const predsByUser = {};
  allPredictions.forEach(u => { predsByUser[u.id] = u.predictions || {}; });

  const medals = [
    '<i class="fa-solid fa-medal" style="color:var(--gold)"></i>',
    '<i class="fa-solid fa-medal" style="color:#a0a5b0"></i>',
    '<i class="fa-solid fa-medal" style="color:#c77d2e"></i>'
  ];
  const rows = board.map((p, i) => {
    const currentPos = i + 1;
    const oldPos = prevPos[p.id];
    let moveBadge = '';
    if (oldPos !== undefined && oldPos !== currentPos) {
      const diff = oldPos - currentPos;
      if (diff > 0) {
        moveBadge = `<span class="pos-move pos-up">▲${diff}</span>`;
      } else {
        moveBadge = `<span class="pos-move pos-down">▼${Math.abs(diff)}</span>`;
      }
    }
    const preds = predsByUser[p.id] || {};

    const roundCounts = {};
    groupRounds.forEach(r => { roundCounts[r] = 0; });

    let koPredCount = 0;
    let koPts = 0;
    Object.entries(preds).forEach(([matchId, pred]) => {
      if (pred.home === '' || pred.away === '') return;
      if (koMatchIds.has(matchId)) {
        koPredCount++;
      } else {
        const r = matchRound[matchId];
        if (r !== undefined) roundCounts[r]++;
      }
    });
    Object.entries(p.matchPoints || {}).forEach(([matchId, pts]) => {
      if (koMatchIds.has(matchId)) koPts += pts;
    });

    const roundCells = groupRounds.map(r =>
      `<td style="font-family:'JetBrains Mono',monospace; color:var(--muted);">${roundCounts[r]}/${roundTotals[r]}</td>`
    ).join('');

    const koCell = totalKoMatches > 0
      ? `<td style="font-family:'JetBrains Mono',monospace; color:${koPts > 0 ? 'var(--teal)' : 'var(--muted)'};">${koPts > 0 ? '+' : ''}${koPts}</td>`
      : '';

    return `
    <tr>
      <td class="rank">${medals[i] || i + 1}${moveBadge}</td>
      <td>${p.name}</td>
      <td class="total-pts">${p.totalPoints}</td>
      <td style="font-family:'JetBrains Mono',monospace;">${p.correctResults}</td>
      <td style="font-family:'JetBrains Mono',monospace;">${p.correctScores}</td>
      ${roundCells}
      ${koCell}
      <td style="font-family:'JetBrains Mono',monospace; color:var(--muted);">${p.predictionsEntered}/${totalMatches}</td>
    </tr>`;
  }).join('');

  const roundHeaders = groupRounds.map(r =>
    `<th title="Round ${r} predictions entered">R${r}</th>`
  ).join('');

  const koHeader = totalKoMatches > 0
    ? `<th title="Knockout points">KO Pts</th>`
    : '';

  el.innerHTML = `
    <table class="leaderboard-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Player</th>
          <th title="Total points">Pts</th>
          <th title="Correct results (3 pts)">Results</th>
          <th title="Exact scores (+2 pts)">Exact</th>
          ${roundHeaders}
          ${koHeader}
          <th title="Total predictions entered">Entered</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ── Admin: save / delete (group stage) ───────────────────────────────────────

async function saveResult(matchId) {
  const h = parseInt(document.getElementById(`h_${matchId}`).value);
  const a = parseInt(document.getElementById(`a_${matchId}`).value);
  const status = document.getElementById(`status_${matchId}`);

  if (isNaN(h) || isNaN(a)) { status.textContent = '⚠ Enter both scores'; return; }

  status.textContent = 'Saving…';
  try {
    await API.saveResult(matchId, h, a, adminPassword);
    results = await API.results();
    await renderLeaderboard();
    showGroup(activeGroup);
  } catch (e) {
    status.textContent = e.message.includes('401') ? '✗ Wrong password' : '✗ Error';
    status.style.color = 'var(--red)';
  }
}

async function deleteResult(matchId) {
  if (!confirm('Clear this result?')) return;
  try {
    await API.deleteResult(matchId, adminPassword);
    results = await API.results();
    await renderLeaderboard();
    showGroup(activeGroup);
  } catch {
    document.getElementById(`status_${matchId}`).textContent = '✗ Error';
  }
}

// ── Admin: save / delete (knockout) ──────────────────────────────────────────

async function saveKoResult(matchId) {
  const h = parseInt(document.getElementById(`h_${matchId}`).value);
  const a = parseInt(document.getElementById(`a_${matchId}`).value);
  const status = document.getElementById(`status_${matchId}`);

  if (isNaN(h) || isNaN(a)) { status.textContent = '⚠ Enter both scores'; return; }

  status.textContent = 'Saving…';
  try {
    await API.saveResult(matchId, h, a, adminPassword);
    [fixtures, results] = await Promise.all([API.fixtures(), API.results()]);
    allTeams = buildKoTeamsMap(fixtures);
    await renderLeaderboard();
    showKoRound(activeKoRound);
  } catch (e) {
    status.textContent = e.message.includes('401') ? '✗ Wrong password' : '✗ Error';
    status.style.color = 'var(--red)';
  }
}

async function deleteKoResult(matchId) {
  if (!confirm('Clear this result?')) return;
  try {
    await API.deleteResult(matchId, adminPassword);
    [fixtures, results] = await Promise.all([API.fixtures(), API.results()]);
    allTeams = buildKoTeamsMap(fixtures);
    await renderLeaderboard();
    showKoRound(activeKoRound);
  } catch {
    document.getElementById(`status_${matchId}`).textContent = '✗ Error';
  }
}

init();
