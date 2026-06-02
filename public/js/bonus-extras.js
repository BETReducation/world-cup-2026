/* Tie Breakers page */

let bonusLocked = false;
let currentUserId = null;
let isAdmin = false;
let bonusResults = {};

const QUESTION_LABELS = {
  topGoalscorer:       'Top Goalscorer',
  mostRedCards:        'Team with Most Red Cards',
  highestScoringMatch: 'Highest Scoring Match'
};

function show(id)  { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id)  { document.getElementById(id)?.classList.add('hidden'); }
function el(id)    { return document.getElementById(id); }

function formatLockTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
  });
}

async function init() {
  // Determine auth state
  const meData = await API.me().catch(() => ({ userId: null, isAdmin: false }));
  currentUserId = meData.userId;
  isAdmin = meData.isAdmin;

  // Lock status
  const lockData = await fetch('/api/bonus-extras/lock-status').then(r => r.json()).catch(() => ({}));
  bonusLocked = !!lockData.locked;

  // Lock banner
  const banner = el('lockBanner');
  if (bonusLocked) {
    banner.innerHTML = `<i class="fa-solid fa-lock" style="color:var(--red);"></i>
      <span>Bonus predictions are <strong>locked</strong>. Locked ${lockData.lockTime ? formatLockTime(lockData.lockTime) : ''}.</span>`;
    banner.style.borderColor = 'rgba(240,122,90,0.3)';
  } else {
    banner.innerHTML = `<i class="fa-solid fa-lock-open" style="color:var(--accent);"></i>
      <span>Bonus predictions are <strong>open</strong>. Locks <strong>${lockData.lockTime ? formatLockTime(lockData.lockTime) : 'before Round 1'}</strong> — 1 minute before Mexico vs South Africa kicks off.</span>`;
    banner.style.borderColor = 'rgba(77,201,122,0.25)';
  }
  banner.style.display = 'flex';
  banner.classList.remove('hidden');

  // Results
  bonusResults = await fetch('/api/bonus-extras/results').then(r => r.json()).catch(() => ({}));
  const hasResults = Object.values(bonusResults).some(v => v);

  // Predictions form / locked display
  if (bonusLocked || !currentUserId) {
    if (currentUserId) {
      await renderLockedPreds();
    } else if (!bonusLocked) {
      show('signInPrompt');
    }
  } else {
    await renderForm();
  }

  // Leaderboard (always show once locked, or if results are in)
  if (bonusLocked || hasResults) {
    await renderLeaderboard(hasResults);
  }

  // Admin panel
  if (isAdmin) {
    show('adminPanel');
    if (bonusResults.topGoalscorer)       el('adminGoalscorer').value  = bonusResults.topGoalscorer;
    if (bonusResults.mostRedCards)        el('adminRedCards').value    = bonusResults.mostRedCards;
    if (bonusResults.highestScoringMatch) el('adminHighScoring').value = bonusResults.highestScoringMatch;
    el('adminSaveBtn').addEventListener('click', saveAdminResults);
  }
}

async function renderForm() {
  show('predForm');

  // Load existing predictions
  const allPreds = await fetch('/api/bonus-extras/predictions').then(r => r.json()).catch(() => ({}));
  const mine = allPreds[currentUserId] || {};
  if (mine.topGoalscorer)       el('inputGoalscorer').value  = mine.topGoalscorer;
  if (mine.mostRedCards)        el('inputRedCards').value    = mine.mostRedCards;
  if (mine.highestScoringMatch) el('inputHighScoring').value = mine.highestScoringMatch;

  el('savePredBtn').addEventListener('click', savePredictions);
}

async function renderLockedPreds() {
  const allPreds = await fetch('/api/bonus-extras/predictions').then(r => r.json()).catch(() => ({}));
  const mine = allPreds[currentUserId];
  if (!mine) return;

  show('lockedPreds');
  const list = el('lockedPredsList');
  list.innerHTML = Object.entries(QUESTION_LABELS).map(([key, label]) => {
    const val   = mine[key] || '<span style="color:var(--muted);">Not entered</span>';
    const actual = bonusResults[key];
    let badge = '';
    if (actual) {
      const correct = actual.toLowerCase().trim() === (mine[key] || '').toLowerCase().trim();
      badge = correct
        ? `<span style="color:var(--accent);margin-left:0.5rem;font-size:0.8rem;"><i class="fa-solid fa-check"></i> +3 pts</span>`
        : `<span style="color:var(--red);margin-left:0.5rem;font-size:0.8rem;"><i class="fa-solid fa-xmark"></i> 0 pts</span>`;
    }
    return `<div style="display:flex;justify-content:space-between;align-items:center;
                        padding:0.6rem 0;border-bottom:1px solid var(--border);flex-wrap:wrap;gap:0.25rem;">
      <span style="color:var(--muted);font-size:0.85rem;">${label}</span>
      <span style="font-weight:500;">${val}${badge}</span>
    </div>`;
  }).join('');
}

async function renderLeaderboard(hasResults) {
  show('leaderboardSection');
  const divider = el('lbDivider');
  if (divider) divider.style.display = 'block';

  if (hasResults) {
    show('resultsSummary');
    el('resultsList').innerHTML = Object.entries(QUESTION_LABELS).map(([key, label]) => {
      const val = bonusResults[key] || '<span style="color:var(--muted);">TBC</span>';
      return `<div style="display:flex;justify-content:space-between;align-items:center;
                          padding:0.5rem 0;border-bottom:1px solid var(--border);">
        <span style="color:var(--muted);font-size:0.85rem;">${label}</span>
        <span style="font-weight:600;">${val}</span>
      </div>`;
    }).join('');
  }

  const board = await fetch('/api/bonus-extras/leaderboard').then(r => r.json()).catch(() => []);
  const tbody = el('leaderboardBody');

  if (!board.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding:1.5rem;text-align:center;color:var(--muted);">No predictions yet.</td></tr>`;
    return;
  }

  const KEYS = ['topGoalscorer', 'mostRedCards', 'highestScoringMatch'];

  tbody.innerHTML = board.map((row, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
    const isMe  = row.userId === currentUserId;
    const cells = KEYS.map(k => {
      if (!hasResults) return `<td style="padding:0.6rem 0.75rem;text-align:center;color:var(--muted);">–</td>`;
      const got = row.breakdown[k];
      const icon = got === 3
        ? `<i class="fa-solid fa-check" style="color:var(--accent);"></i>`
        : `<i class="fa-solid fa-xmark" style="color:var(--red);opacity:0.5;"></i>`;
      return `<td style="padding:0.6rem 0.75rem;text-align:center;">${icon}</td>`;
    }).join('');

    return `<tr style="${isMe ? 'background:var(--accent-dim);' : ''}border-bottom:1px solid var(--border);">
      <td style="padding:0.6rem 1rem;font-weight:700;color:var(--muted);">${medal}</td>
      <td style="padding:0.6rem 1rem;font-weight:${isMe ? '700' : '500'};">${row.name}${isMe ? ' <span style="font-size:0.75rem;color:var(--accent);">(you)</span>' : ''}</td>
      ${cells}
      <td style="padding:0.6rem 1rem;text-align:right;font-weight:700;font-family:'JetBrains Mono',monospace;">${row.pts}</td>
    </tr>`;
  }).join('');
}

async function savePredictions() {
  const btn = el('savePredBtn');
  btn.disabled = true;
  hide('formSaveMsg');
  hide('formErrMsg');

  const { token } = Session.load();
  try {
    await fetch(`/api/bonus-extras/predictions/${currentUserId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-token': token },
      body: JSON.stringify({
        topGoalscorer:       el('inputGoalscorer').value.trim(),
        mostRedCards:        el('inputRedCards').value.trim(),
        highestScoringMatch: el('inputHighScoring').value.trim()
      })
    }).then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.error); }); });

    const msg = el('formSaveMsg');
    msg.textContent = 'Predictions saved!';
    show('formSaveMsg');
    setTimeout(() => hide('formSaveMsg'), 3000);
  } catch (err) {
    const msg = el('formErrMsg');
    msg.textContent = err.message || 'Failed to save. Please try again.';
    show('formErrMsg');
  } finally {
    btn.disabled = false;
  }
}

async function saveAdminResults() {
  const btn = el('adminSaveBtn');
  btn.disabled = true;
  hide('adminSaveMsg');

  const { token } = Session.load();
  try {
    await fetch('/api/bonus-extras/results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-token': token },
      body: JSON.stringify({
        topGoalscorer:       el('adminGoalscorer').value.trim(),
        mostRedCards:        el('adminRedCards').value.trim(),
        highestScoringMatch: el('adminHighScoring').value.trim()
      })
    }).then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.error); }); });

    const msg = el('adminSaveMsg');
    msg.textContent = 'Results saved! Refreshing leaderboard…';
    show('adminSaveMsg');

    // Reload leaderboard
    bonusResults = await fetch('/api/bonus-extras/results').then(r => r.json()).catch(() => ({}));
    hide('leaderboardSection');
    hide('resultsSummary');
    await renderLeaderboard(Object.values(bonusResults).some(v => v));

    // Reload locked preds display for current user
    if (bonusLocked && currentUserId) {
      hide('lockedPreds');
      await renderLockedPreds();
    }
  } catch (err) {
    const msg = el('adminSaveMsg');
    msg.style.background = 'rgba(240,122,90,0.12)';
    msg.style.color = 'var(--red)';
    msg.textContent = err.message || 'Failed to save results.';
    show('adminSaveMsg');
  } finally {
    btn.disabled = false;
  }
}

// Sign-in button
document.addEventListener('DOMContentLoaded', () => {
  el('signInBtn')?.addEventListener('click', () => {
    if (typeof openRegisterModal === 'function') openRegisterModal();
  });
  init();
});
