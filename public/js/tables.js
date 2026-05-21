// Calculate a group's standing table from a predictions/results map
// scores = { matchId: { home: n, away: n }, ... }
function calcGroupTable(teams, matches, scores) {
  const stats = {};
  teams.forEach(t => {
    stats[t.id] = { team: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
  });

  matches.forEach(m => {
    const s = scores[m.id];
    if (s === undefined || s.home === '' || s.away === '') return;
    const h = parseInt(s.home), a = parseInt(s.away);
    if (isNaN(h) || isNaN(a)) return;

    const hs = stats[m.home], as = stats[m.away];
    if (!hs || !as) return;

    hs.p++; as.p++;
    hs.gf += h; hs.ga += a;
    as.gf += a; as.ga += h;

    if (h > a)      { hs.w++; hs.pts += 3; as.l++; }
    else if (h < a) { as.w++; as.pts += 3; hs.l++; }
    else            { hs.d++; hs.pts++; as.d++; as.pts++; }
  });

  return Object.values(stats).sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    const gdB = b.gf - b.ga, gdA = a.gf - a.ga;
    if (gdB !== gdA) return gdB - gdA;
    return b.gf - a.gf;
  });
}

// Render a group standings table into a DOM element
function renderTable(container, rows, label = '') {
  const qualifiers = [0, 1];

  container.innerHTML = `
    ${label ? `<p class="table-heading">${label}</p>` : ''}
    <div style="overflow-x:auto;">
    <table class="standings-table">
      <thead>
        <tr>
          <th class="pos">#</th>
          <th class="team-col">Team</th>
          <th title="Played">P</th>
          <th title="Won">W</th>
          <th title="Drawn">D</th>
          <th title="Lost">L</th>
          <th title="Goals For">GF</th>
          <th title="Goals Against">GA</th>
          <th title="Goal Difference">GD</th>
          <th title="Points">Pts</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r, i) => `
          <tr class="${qualifiers.includes(i) ? 'qualifies' : ''}${i === 2 ? ' third-place' : ''}">
            <td class="pos">${i + 1}</td>
            <td class="team-col"><span class="flag fi fi-${r.team.flagCode}"></span>${r.team.name}</td>
            <td>${r.p}</td>
            <td>${r.w}</td>
            <td>${r.d}</td>
            <td>${r.l}</td>
            <td>${r.gf}</td>
            <td>${r.ga}</td>
            <td class="${r.gf - r.ga > 0 ? 'pos-gd' : r.gf - r.ga < 0 ? 'neg-gd' : ''}">${r.gf - r.ga > 0 ? '+' : ''}${r.gf - r.ga}</td>
            <td class="pts">${r.pts}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    </div>
    <p class="table-legend">
      <span class="dot qualify"></span>Qualify &nbsp;
      <span class="dot third"></span>Possible 3rd
    </p>
  `;
}

// Format a lock deadline across ET, UK (BST), and VN (ICT) timezones
function fmtLockTimezones(isoStr) {
  const d = new Date(isoStr);
  const fmt = (tz) => {
    const date = d.toLocaleDateString('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' });
    const time = d.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
    return `${date} ${time}`;
  };
  return `${fmt('America/New_York')} ET · ${fmt('Europe/London')} UK · ${fmt('Asia/Ho_Chi_Minh')} VN`;
}

// Format a date + time string nicely
function fmtDate(dateStr, timeStr) {
  const d = new Date(`${dateStr}T${timeStr}:00`);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
    + ' · ' + timeStr;
}
