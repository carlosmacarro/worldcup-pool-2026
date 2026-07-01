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
  groupPositionPoints: document.querySelector('#groupPositionPoints'),
  specialPoints: document.querySelector('#specialPoints'),
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

function pointClass(bet) {
  if (bet.type === 'exact') return 'exact';
  if (bet.type === 'goal-difference') return 'diff';
  if (bet.type === 'winner') return 'winner';
  return 'miss';
}

function renderGroupPositionBet(bet) {
  const card = document.createElement('article');
  card.className = 'bet-card bonus-bet';
  card.innerHTML = `
    <div class="bet-header">
      <span class="match-no">Grupo ${escapeHtml(bet.groupName)} · ${bet.position}º</span>
      <span class="pill ${bet.points > 0 ? 'exact' : 'miss'}">${bet.points > 0 ? `+${bet.points} pts` : 'Pendiente'}</span>
    </div>
    <div class="bet-teams">Apuesta: <strong>${escapeHtml(bet.predictedTeam || '–')}</strong></div>
    ${bet.actualTeam ? `<div class="bet-actual">Real: <strong>${escapeHtml(bet.actualTeam)}</strong></div>` : ''}
  `;
  return card;
}

const SPECIAL_LABELS = {
  winner: 'Campeón del mundo',
  second: 'Subcampeón',
  third: 'Tercer puesto',
  balon_de_oro: 'Balón de Oro',
  bota_de_oro: 'Bota de Oro'
};

function renderSpecialBet(bet) {
  const card = document.createElement('article');
  card.className = 'bet-card bonus-bet';
  const label = SPECIAL_LABELS[bet.category] || bet.category;
  card.innerHTML = `
    <div class="bet-header">
      <span class="match-no">${escapeHtml(label)}</span>
      <span class="pill ${bet.points > 0 ? 'exact' : 'miss'}">${bet.points > 0 ? `+${bet.points} pts` : 'Pendiente'}</span>
    </div>
    <div class="bet-teams">Apuesta: <strong>${escapeHtml(bet.predictedValue || '–')}</strong></div>
    ${bet.actualValue ? `<div class="bet-actual">Real: <strong>${escapeHtml(bet.actualValue)}</strong></div>` : ''}
  `;
  return card;
}

function pointsLabel(bet) {
  if (bet.type === 'pending') return 'Pending';
  if (bet.type === 'wrong-matchup') return 'Cruce no jugado · 0 pts';
  return `${bet.points} pts`;
}

function renderBets(bets) {
  elements.bets.replaceChildren();
  if (!bets.length) {
    elements.bets.innerHTML = '<p class="subtitle">Sin apuestas para esta fase.</p>';
    return;
  }

  for (const bet of bets) {
    const card = document.createElement('article');
    if (bet.phase === 'group-position') {
      elements.bets.appendChild(renderGroupPositionBet(bet));
      continue;
    }
    if (bet.phase === 'special') {
      elements.bets.appendChild(renderSpecialBet(bet));
      continue;
    }

    card.className = 'bet-card';
    const pointsLabelText = pointsLabel(bet);
    card.innerHTML = `
      <div class="bet-header">
        <span class="match-no">#${bet.matchNo}${bet.roundLabel ? ` · ${escapeHtml(bet.roundLabel)}` : ''}</span>
        <span class="pill ${pointClass(bet)}">${pointsLabelText}</span>
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
    elements.participantSubtitle.textContent = '';
    elements.betsTitle.textContent = data.phaseLabel;
    elements.lastUpdated.textContent = data.lastSync?.finishedAt ? `Last sync: ${formatDate(data.lastSync.finishedAt)}` : 'Waiting for first sync';
    elements.totalPoints.textContent = data.summary.total;
    elements.groupPositionPoints.textContent = data.summary.groupPosition ?? 0;
    elements.specialPoints.textContent = data.summary.special ?? 0;
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