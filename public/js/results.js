let fixtures = null;
let allPredictions = [];
let results = {};
let adminPassword = null;
let isAdmin = false;
let activeGroup = 'A';

const $ = id => document.getElementById(id);

async function init() {
  try {
    [fixtures, allPredictions, results] = await Promise.all([
      API.fixtures(), API.allPredictions(), API.results()
    ]);
  } catch {
    $('loadingState').innerHTML =
      '<p style="color:var(--red);">⚠️ Could not reach server. Make sure <code>node server.js</code> is running.</p>';
    return;
  }

  $('loadingState').style.display = 'none';
  $('resultsApp').style.display = 'block';

  buildTabs();
  showGroup(activeGroup);
  renderLeaderboard();
}

// ── Admin ─────────────────────────────────────────────────────────────────────

$('adminToggleBtn').addEventListener('click', () => {
  if (isAdmin) {
    isAdmin = false;
    adminPassword = null;
    $('adminLabel').textContent = '';
    $('adminToggleBtn').textContent = '🔑 Admin Mode';
    showGroup(activeGroup);
  } else {
    $('adminModal').classList.add('open');
    $('adminPwdInput').value = '';
    setTimeout(() => $('adminPwdInput').focus(), 50);
  }
});

$('adminLoginBtn').addEventListener('click', () => {
  const pwd = $('adminPwdInput').value.trim();
  if (!pwd) return;
  adminPassword = pwd;
  isAdmin = true;
  $('adminModal').classList.remove('open');
  $('adminLabel').textContent = '✓ Admin active';
  $('adminToggleBtn').textContent = 'Exit Admin';
  showGroup(activeGroup);
});

$('adminCancelBtn').addEventListener('click', () => $('adminModal').classList.remove('open'));
$('adminPwdInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('adminLoginBtn').click(); });

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
  const panels = $('resultsPanels');
  const group  = fixtures.groups[groupKey];

  const rounds = {};
  group.matches.forEach(m => (rounds[m.round] = rounds[m.round] || []).push(m));

  let html = `<div class="card"><div class="group-layout">`;

  // Left: results list
  html += `<div>`;
  Object.entries(rounds).forEach(([round, matches]) => {
    html += `<div class="round-heading">Round ${round}</div>`;

    matches.forEach(m => {
      const home   = group.teams.find(t => t.id === m.home);
      const away   = group.teams.find(t => t.id === m.away);
      const result = results.results?.[m.id];
      const played = result?.played;

      html += `
        <div class="result-row ${played ? '' : 'not-played'}">
          <div class="match-meta">${fmtDate(m.date, m.time)}<br>${m.venue}</div>
          <div class="team-name"><span class="flag">${home.flag}</span>${home.name}</div>
          <div class="scoreline">${played ? `${result.home} – ${result.away}` : 'vs'}</div>
          <div class="team-name right">${away.name}<span class="flag">${away.flag}</span></div>
        </div>`;

      if (played || isAdmin) {
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

  // Right: actual group table
  html += `
    <div>
      <p class="table-heading">Group ${groupKey} Table</p>
      <div id="actualTable_${groupKey}"></div>
    </div>`;

  html += `</div></div>`;
  panels.innerHTML = html;

  renderActualTable(groupKey);
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

  return `
    <div class="comparison-panel">
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

// ── Actual table ──────────────────────────────────────────────────────────────

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
  const board = await API.leaderboard().catch(() => []);
  const el = $('leaderboardContent');

  if (!board.length) {
    el.innerHTML = '<p style="color:var(--muted); font-size:13px;">No players registered yet.</p>';
    return;
  }

  // Build matchId → round lookup from fixtures
  const matchRound = {};
  const roundTotals = {};
  Object.values(fixtures.groups).forEach(g => {
    g.matches.forEach(m => {
      matchRound[m.id] = m.round;
      roundTotals[m.round] = (roundTotals[m.round] || 0) + 1;
    });
  });
  const rounds = Object.keys(roundTotals).sort();

  // Build userId → predictions lookup from allPredictions
  const predsByUser = {};
  allPredictions.forEach(u => { predsByUser[u.id] = u.predictions || {}; });

  const medals = ['🥇', '🥈', '🥉'];
  const rows = board.map((p, i) => {
    const preds = predsByUser[p.id] || {};
    const roundCounts = {};
    rounds.forEach(r => { roundCounts[r] = 0; });
    Object.entries(preds).forEach(([matchId, pred]) => {
      const r = matchRound[matchId];
      if (r && pred.home !== '' && pred.away !== '') roundCounts[r]++;
    });

    const roundCells = rounds.map(r =>
      `<td style="font-family:'JetBrains Mono',monospace; color:var(--muted);">${roundCounts[r]}/${roundTotals[r]}</td>`
    ).join('');

    return `
    <tr>
      <td class="rank">${medals[i] || i + 1}</td>
      <td>${p.name}</td>
      <td class="total-pts">${p.totalPoints}</td>
      <td style="font-family:'JetBrains Mono',monospace;">${p.correctResults}</td>
      <td style="font-family:'JetBrains Mono',monospace;">${p.correctScores}</td>
      ${roundCells}
      <td style="font-family:'JetBrains Mono',monospace; color:var(--muted);">${p.predictionsEntered}/72</td>
    </tr>`;
  }).join('');

  const roundHeaders = rounds.map(r =>
    `<th title="Round ${r} predictions entered">R${r}</th>`
  ).join('');

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
          <th title="Total predictions entered">Total Entered</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ── Admin: save / delete ──────────────────────────────────────────────────────

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

init();
