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
  matchesTitle: document.querySelector('#matchesTitle'),
  matchesSubtitle: document.querySelector('#matchesSubtitle'),
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
        <span>Open bets · Group: ${row.total ?? 0} pts · ${row.played ?? 0} scored</span>
      </a>
    `;
    elements.participants.appendChild(item);
  }
}

const LIVE_STATUSES = new Set(['IN_PLAY', 'PAUSED', 'LIVE']);
const UPCOMING_STATUSES = new Set(['SCHEDULED', 'TIMED']);
const MAX_MATCH_CARDS = 8;

function matchTime(match) {
  if (!match.kickoff) return Number.POSITIVE_INFINITY;
  const date = new Date(match.kickoff);
  return Number.isNaN(date.getTime()) ? Number.POSITIVE_INFINITY : date.getTime();
}

function byKickoffThenMatchNo(a, b) {
  return matchTime(a) - matchTime(b) || Number(a.matchNo || 0) - Number(b.matchNo || 0);
}

function isLiveMatch(match) {
  return LIVE_STATUSES.has(String(match.status || '').toUpperCase());
}

function isUpcomingMatch(match, now = Date.now()) {
  const status = String(match.status || '').toUpperCase();
  if (!UPCOMING_STATUSES.has(status)) return false;
  const kickoff = matchTime(match);
  return kickoff === Number.POSITIVE_INFINITY || kickoff >= now - 15 * 60 * 1000;
}

function selectMatchesToShow(matches) {
  const now = Date.now();
  const live = matches.filter(isLiveMatch).sort(byKickoffThenMatchNo);
  const upcoming = matches
    .filter((match) => !isLiveMatch(match) && isUpcomingMatch(match, now))
    .sort(byKickoffThenMatchNo);

  if (live.length) {
    return {
      title: 'Live / next group matches',
      subtitle: 'Live matches first, followed by the next scheduled group matches',
      matches: [...live, ...upcoming].slice(0, MAX_MATCH_CARDS)
    };
  }

  if (upcoming.length) {
    return {
      title: 'Next group matches',
      subtitle: 'The following scheduled group-stage matches',
      matches: upcoming.slice(0, MAX_MATCH_CARDS)
    };
  }

  const recentFinished = matches
    .filter((match) => match.isScorable || String(match.status || '').toUpperCase() === 'FINISHED')
    .sort((a, b) => byKickoffThenMatchNo(b, a));

  return {
    title: 'Recent group results',
    subtitle: 'All group matches appear to be finished, so showing the latest scored results',
    matches: recentFinished.slice(0, MAX_MATCH_CARDS)
  };
}

function renderMatches(matches) {
  elements.matches.replaceChildren();
  const selection = selectMatchesToShow(matches || []);

  if (elements.matchesTitle) elements.matchesTitle.textContent = selection.title;
  if (elements.matchesSubtitle) elements.matchesSubtitle.textContent = selection.subtitle;

  if (!selection.matches.length) {
    elements.matches.innerHTML = '<p class="subtitle">No group-stage matches available yet.</p>';
    return;
  }

  for (const match of selection.matches) {
    const card = document.createElement('article');
    const status = String(match.status || '').toUpperCase();
    card.className = `match-card ${isLiveMatch(match) ? 'match-live' : isUpcomingMatch(match) ? 'match-upcoming' : 'match-finished'}`;
    const score = match.realHome === null || match.realAway === null ? '–' : `${match.realHome}–${match.realAway}`;
    const statusLabel = isLiveMatch(match) ? 'LIVE' : status || 'SCHEDULED';
    card.innerHTML = `
      <div class="match-no">#${match.matchNo}</div>
      <div class="match-teams">${escapeHtml(match.homeTeam || 'TBD')} <span class="score">${score}</span> ${escapeHtml(match.awayTeam || 'TBD')}</div>
      <div class="match-status"><span class="match-status-label">${escapeHtml(statusLabel)}</span><br>${formatDate(match.kickoff)}</div>
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
