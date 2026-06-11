const params = new URLSearchParams(window.location.search);
const participantKey = params.get('participant') || '';
const phase = params.get('phase') === 'knockout' ? 'knockout' : 'group';

const elements = {
  status: document.querySelector('#status'),
  participantName: document.querySelector('#participantName'),
  participantSubtitle: document.querySelector('#participantSubtitle'),
  betsTitle: document.querySelector('#betsTitle'),
  lastUpdated: document.querySelector('#lastUpdated'),
  totalPoints: document.querySelector('#totalPoints'),
  playedBets: document.querySelector('#playedBets'),
  pendingBets: document.querySelector('#pendingBets'),
  bets: document.querySelector('#bets'),
  groupLink: document.querySelector('#groupLink'),
  knockoutLink: document.querySelector('#knockoutLink')
};

function formatDate(value) {
  if (!value) return '–';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function setStatus(message, type = '') {
  elements.status.className = `status-card ${type}`.trim();
  elements.status.textContent = message;
}

function scoreText(bet) {
  if (bet.actual.home === null || bet.actual.away === null) return 'Pending';
  return `${bet.actual.home}–${bet.actual.away}`;
}

function pointClass(points) {
  if (points === 3) return 'exact';
  if (points === 2) return 'diff';
  if (points === 1) return 'winner';
  return 'miss';
}

function renderBets(bets) {
  elements.bets.replaceChildren();
  if (!bets.length) {
    elements.bets.innerHTML = '<p class="subtitle">Sin apuestas para esta fase.</p>';
    return;
  }

  for (const bet of bets) {
    const card = document.createElement('article');
    card.className = 'bet-card';
    const pointsLabel = bet.type === 'pending' ? 'Pending' : `${bet.points} pts`;
    card.innerHTML = `
      <div class="bet-header">
        <span class="match-no">#${bet.matchNo}</span>
        <span class="pill ${pointClass(bet.points)}">${pointsLabel}</span>
      </div>
      <div class="bet-teams">${escapeHtml(bet.homeTeam || 'TBD')} <strong>${bet.predicted.home}–${bet.predicted.away}</strong> ${escapeHtml(bet.awayTeam || 'TBD')}</div>
      <div class="bet-meta">
        <span>Actual: ${escapeHtml(scoreText(bet))}</span>
        <span>${escapeHtml(bet.status || 'PENDING')}</span>
        <span>${formatDate(bet.kickoff)}</span>
      </div>
    `;
    elements.bets.appendChild(card);
  }
}

async function loadParticipant() {
  if (!participantKey) {
    setStatus('Missing participant in URL.', 'error');
    return;
  }

  elements.groupLink.href = `/participant.html?participant=${encodeURIComponent(participantKey)}&phase=group`;
  elements.knockoutLink.href = `/participant.html?participant=${encodeURIComponent(participantKey)}&phase=knockout`;
  elements.groupLink.classList.toggle('active', phase === 'group');
  elements.knockoutLink.classList.toggle('active', phase === 'knockout');

  try {
    const response = await fetch(`/.netlify/functions/participant?participant=${encodeURIComponent(participantKey)}&phase=${phase}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || 'Could not load participant');

    elements.participantName.textContent = data.participant.name;
    elements.participantSubtitle.textContent = `${data.phaseLabel} bets from ${data.participant.fileName || 'Excel file'}.`;
    elements.betsTitle.textContent = data.phaseLabel;
    elements.lastUpdated.textContent = data.lastSync?.finishedAt ? `Last sync: ${formatDate(data.lastSync.finishedAt)}` : 'Waiting for first sync';
    elements.totalPoints.textContent = data.summary.total;
    elements.playedBets.textContent = data.summary.played;
    elements.pendingBets.textContent = data.summary.pending;

    setStatus(`${data.phaseLabel} loaded.`, 'ok');
    renderBets(data.bets || []);
  } catch (error) {
    elements.participantName.textContent = 'Participant';
    setStatus(error.message || String(error), 'error');
  }
}

loadParticipant();
