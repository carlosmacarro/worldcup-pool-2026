const elements = {
  status: document.querySelector('#status'),
  leaderboard: document.querySelector('#leaderboard'),
  leaderTemplate: document.querySelector('#leaderTemplate'),
  participants: document.querySelector('#participants'),
  participantsCount: document.querySelector('#participantsCount'),
  scoredMatchesCount: document.querySelector('#scoredMatchesCount'),
  predictionsCount: document.querySelector('#predictionsCount'),
  lastUpdated: document.querySelector('#lastUpdated'),
  matches: document.querySelector('#matches'),
  refreshBtn: document.querySelector('#refreshBtn'),
  tabButtons: document.querySelectorAll('[data-tab]'),
  tabPanels: document.querySelectorAll('.tab-panel')
};

function formatDate(value) {
  if (!value) return '–';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function setStatus(message, type = '') {
  elements.status.className = `status-card ${type}`.trim();
  elements.status.textContent = message;
}

function renderLeaderboard(rows) {
  elements.leaderboard.replaceChildren();

  if (!rows.length) {
    elements.leaderboard.innerHTML = '<p class="subtitle">No participants yet. Run the first sync from /admin.html.</p>';
    return;
  }

  for (const row of rows) {
    const node = elements.leaderTemplate.content.cloneNode(true);
    const card = node.querySelector('.leader-card');
    card.addEventListener('click', () => {
      window.location.href = `/participant.html?participant=${encodeURIComponent(row.participantKey)}&phase=group`;
    });
    card.setAttribute('role', 'link');
    card.setAttribute('tabindex', '0');
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        window.location.href = `/participant.html?participant=${encodeURIComponent(row.participantKey)}&phase=group`;
      }
    });
    node.querySelector('.rank').textContent = row.rank === 1 ? '🏆' : `#${row.rank}`;
    node.querySelector('h3').textContent = row.name;
    node.querySelector('.points').textContent = `${row.total} pts`;
    node.querySelector('.exact').textContent = `3 pts: ${row.exact}`;
    node.querySelector('.diff').textContent = `2 pts: ${row.goalDifference}`;
    node.querySelector('.winner').textContent = `1 pt: ${row.winner}`;
    node.querySelector('.miss').textContent = `0 pts: ${row.miss}`;
    elements.leaderboard.appendChild(node);
  }
}

function renderParticipants(rows) {
  elements.participants.replaceChildren();

  if (!rows.length) {
    elements.participants.innerHTML = '<p class="subtitle">No participants yet. Run the first sync from /admin.html.</p>';
    return;
  }

  for (const row of rows) {
    const item = document.createElement('article');
    item.className = 'participant-card';
    item.innerHTML = `
      <a class="participant-main" href="/participant.html?participant=${encodeURIComponent(row.participantKey)}&phase=group">
        <strong>${escapeHtml(row.name)}</strong>
        <span>Group bets · ${row.total ?? 0} pts · ${row.played ?? 0} scored</span>
      </a>
      <a class="small-link" href="/participant.html?participant=${encodeURIComponent(row.participantKey)}&phase=knockout">Knockout bets</a>
    `;
    elements.participants.appendChild(item);
  }
}

function renderMatches(matches) {
  elements.matches.replaceChildren();
  const interesting = matches
    .filter((m) => m.status !== 'SCHEDULED' || m.isScorable)
    .slice(-8)
    .reverse();

  if (!interesting.length) {
    elements.matches.innerHTML = '<p class="subtitle">No scored group matches yet.</p>';
    return;
  }

  for (const match of interesting) {
    const card = document.createElement('article');
    card.className = 'match-card';
    const score = match.realHome === null || match.realAway === null ? '–' : `${match.realHome}–${match.realAway}`;
    card.innerHTML = `
      <div class="match-no">#${match.matchNo}</div>
      <div class="match-teams">${escapeHtml(match.homeTeam || 'TBD')} <span class="score">${score}</span> ${escapeHtml(match.awayTeam || 'TBD')}</div>
      <div class="match-status">${escapeHtml(match.status || '')}<br>${formatDate(match.kickoff)}</div>
    `;
    elements.matches.appendChild(card);
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function setActiveTab(tabId) {
  for (const panel of elements.tabPanels) panel.hidden = panel.id !== tabId;
  for (const button of elements.tabButtons) {
    button.classList.toggle('active', button.dataset.tab === tabId);
  }
}

async function loadLeaderboard() {
  elements.refreshBtn.disabled = true;
  try {
    const response = await fetch('/.netlify/functions/leaderboard?phase=group', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || 'Could not load leaderboard');

    elements.participantsCount.textContent = data.summary.participants;
    elements.scoredMatchesCount.textContent = `${data.summary.scorableMatches}/${data.summary.matches}`;
    elements.predictionsCount.textContent = data.summary.predictions;
    elements.lastUpdated.textContent = data.lastSync?.finishedAt ? `Last sync: ${formatDate(data.lastSync.finishedAt)}` : 'Waiting for first sync';

    if (data.lastSync?.ok === false) {
      setStatus(`Last sync failed: ${data.lastSync.error || 'Unknown error'}`, 'error');
    } else if (data.lastSync?.warnings?.length) {
      setStatus(`Group-stage leaderboard loaded. ${data.lastSync.warnings.length} sync warning(s). Check /admin.html for details.`, 'ok');
    } else {
      setStatus('Group-stage leaderboard loaded.', 'ok');
    }

    renderLeaderboard(data.leaderboard || []);
    renderParticipants(data.participants || []);
    renderMatches(data.matches || []);
  } catch (error) {
    setStatus(error.message || String(error), 'error');
  } finally {
    elements.refreshBtn.disabled = false;
  }
}

for (const button of elements.tabButtons) {
  button.addEventListener('click', () => setActiveTab(button.dataset.tab));
}

elements.refreshBtn.addEventListener('click', loadLeaderboard);
loadLeaderboard();
setInterval(loadLeaderboard, 30_000);
