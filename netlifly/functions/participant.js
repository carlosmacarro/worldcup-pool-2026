const params         = new URLSearchParams(window.location.search);
const participantKey = params.get('participant') || '';
const phase          = params.get('phase') === 'knockout' ? 'knockout' : 'group';

const elements = {
  status:              document.querySelector('#status'),
  participantName:     document.querySelector('#participantName'),
  participantSubtitle: document.querySelector('#participantSubtitle'),
  betsTitle:           document.querySelector('#betsTitle'),
  lastUpdated:         document.querySelector('#lastUpdated'),
  totalPoints:         document.querySelector('#totalPoints'),
  playedBets:          document.querySelector('#playedBets'),
  pendingBets:         document.querySelector('#pendingBets'),
  bets:                document.querySelector('#bets'),
  groupLink:           document.querySelector('#groupLink'),
  knockoutLink:        document.querySelector('#knockoutLink')
};

function formatDate(value) {
  if (!value) return '–';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function setStatus(message, type = '') {
  elements.status.className = `status-card ${type}`.trim();
  elements.status.textContent = message;
}

function pointClass(bet) {
  if (bet.type === 'exact')           return 'exact';
  if (bet.type === 'goal-difference') return 'diff';
  if (bet.type === 'winner')          return 'winner';
  return 'miss';
}

function pointsLabel(bet) {
  if (bet.type === 'pending')       return 'Pendiente';
  if (bet.type === 'wrong-matchup') return 'Cruce no jugado · 0 pts';
  return `${bet.points} pts`;
}

// ─── Bet card builders ──────────────────────────────────────────────────────

function renderGroupBet(bet) {
  const actualScore = (bet.actual.home === null || bet.actual.away === null)
    ? '–'
    : `${bet.actual.home}–${bet.actual.away}`;

  const card = document.createElement('article');
  card.className = 'bet-card';
  card.innerHTML = `
    <div class="bet-header">
      <span class="match-no">#${bet.matchNo}${bet.roundLabel ? ` · ${escapeHtml(bet.roundLabel)}` : ''}</span>
      <span class="pill ${pointClass(bet)}">${pointsLabel(bet)}</span>
    </div>
    <div class="bet-teams">
      ${escapeHtml(bet.homeTeam || 'TBD')}
      <strong>${bet.predicted.home}–${bet.predicted.away}</strong>
      ${escapeHtml(bet.awayTeam || 'TBD')}
    </div>
    <div class="bet-meta">
      <span>Resultado: ${escapeHtml(actualScore)}</span>
      <span>${escapeHtml(bet.status || 'PENDING')}</span>
      <span>${formatDate(bet.kickoff)}</span>
    </div>
  `;
  return card;
}

function renderKnockoutBet(bet) {
  const card = document.createElement('article');
  card.className = 'bet-card knockout-bet';

  const isWrongMatchup = bet.type === 'wrong-matchup';
  const isPending      = bet.type === 'pending';

  // Predicted matchup line
  const predLine = `${escapeHtml(bet.homeTeam || 'TBD')} <strong>${bet.predicted.home}–${bet.predicted.away}</strong> ${escapeHtml(bet.awayTeam || 'TBD')}`;

  // Actual result line — only shown once there's a real score or wrong matchup
  let actualLine = '';
  if (isWrongMatchup) {
    // We know who actually played in that round but it wasn't this pair
    actualLine = `<div class="bet-actual wrong-matchup">⚠ Este cruce no se disputó</div>`;
  } else if (!isPending && bet.actual.home !== null && bet.actual.away !== null) {
    const sameTeams =
      bet.actualHomeTeam &&
      bet.actualAwayTeam &&
      bet.actualHomeTeam.toUpperCase() === bet.homeTeam?.toUpperCase() &&
      bet.actualAwayTeam.toUpperCase() === bet.awayTeam?.toUpperCase();

    const actualScore = `${bet.actual.home}–${bet.actual.away}`;

    if (sameTeams) {
      // Predicted teams played each other – just show the score
      actualLine = `<div class="bet-actual">Resultado: <strong>${escapeHtml(actualScore)}</strong></div>`;
    } else {
      // Teams match but were stored in reversed order by the API
      const actualTeamsLabel = `${escapeHtml(bet.actualHomeTeam || '?')} ${actualScore} ${escapeHtml(bet.actualAwayTeam || '?')}`;
      actualLine = `<div class="bet-actual">Resultado: <strong>${actualTeamsLabel}</strong></div>`;
    }
  }

  card.innerHTML = `
    <div class="bet-header">
      <span class="match-no">${escapeHtml(bet.roundLabel || bet.round || 'KO')}</span>
      <span class="pill ${pointClass(bet)}">${pointsLabel(bet)}</span>
    </div>
    <div class="bet-teams">${predLine}</div>
    ${actualLine}
    <div class="bet-meta">
      <span>${escapeHtml(bet.status || 'PENDING')}</span>
      <span>${formatDate(bet.kickoff)}</span>
    </div>
  `;
  return card;
}

function renderGroupPositionBet(bet) {
  const card = document.createElement('article');
  card.className = 'bet-card bonus-bet';
  const pointPill = `<span class="pill ${bet.points > 0 ? 'exact' : (bet.actualTeam ? 'miss' : 'miss')}">${bet.points > 0 ? `+${bet.points} pts` : (bet.actualTeam ? '0 pts' : 'Pendiente')}</span>`;
  card.innerHTML = `
    <div class="bet-header">
      <span class="match-no">Grupo ${escapeHtml(bet.groupName)} · ${bet.position}º</span>
      ${pointPill}
    </div>
    <div class="bet-teams">Apuesta: <strong>${escapeHtml(bet.predictedTeam || '–')}</strong></div>
    ${bet.actualTeam ? `<div class="bet-actual">Real: <strong>${escapeHtml(bet.actualTeam)}</strong></div>` : ''}
  `;
  return card;
}

const SPECIAL_LABELS = {
  winner:      'Campeón del mundo',
  second:      'Subcampeón',
  third:       'Tercer puesto',
  balon_de_oro:'Balón de Oro',
  bota_de_oro: 'Bota de Oro'
};

function renderSpecialBet(bet) {
  const card = document.createElement('article');
  card.className = 'bet-card bonus-bet';
  const label = SPECIAL_LABELS[bet.category] || bet.category;
  const pointPill = `<span class="pill ${bet.points > 0 ? 'exact' : (bet.actualValue ? 'miss' : 'miss')}">${bet.points > 0 ? `+${bet.points} pts` : (bet.actualValue ? '0 pts' : 'Pendiente')}</span>`;
  card.innerHTML = `
    <div class="bet-header">
      <span class="match-no">${escapeHtml(label)}</span>
      ${pointPill}
    </div>
    <div class="bet-teams">Apuesta: <strong>${escapeHtml(bet.predictedValue || '–')}</strong></div>
    ${bet.actualValue ? `<div class="bet-actual">Real: <strong>${escapeHtml(bet.actualValue)}</strong></div>` : ''}
  `;
  return card;
}

function renderBets(bets) {
  elements.bets.replaceChildren();
  if (!bets.length) {
    elements.bets.innerHTML = '<p class="subtitle">Sin apuestas para esta fase.</p>';
    return;
  }

  for (const bet of bets) {
    let card;
    if (bet.phase === 'knockout')       card = renderKnockoutBet(bet);
    else if (bet.phase === 'group-position') card = renderGroupPositionBet(bet);
    else if (bet.phase === 'special')    card = renderSpecialBet(bet);
    else                                 card = renderGroupBet(bet);
    elements.bets.appendChild(card);
  }
}

async function loadParticipant() {
  if (!participantKey) {
    setStatus('Missing participant in URL.', 'error');
    return;
  }

  elements.groupLink.href    = `/participant.html?participant=${encodeURIComponent(participantKey)}&phase=group`;
  elements.knockoutLink.href = `/participant.html?participant=${encodeURIComponent(participantKey)}&phase=knockout`;
  elements.groupLink.classList.toggle('active',    phase === 'group');
  elements.knockoutLink.classList.toggle('active', phase === 'knockout');

  try {
    const response = await fetch(
      `/.netlify/functions/participant?participant=${encodeURIComponent(participantKey)}&phase=${phase}`,
      { cache: 'no-store' }
    );
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || 'Could not load participant');

    elements.participantName.textContent    = data.participant.name;
    elements.participantSubtitle.textContent= '';
    elements.betsTitle.textContent          = data.phaseLabel;
    elements.lastUpdated.textContent        = data.lastSync?.finishedAt
      ? `Última sync: ${formatDate(data.lastSync.finishedAt)}`
      : 'Esperando primera sync';
    elements.totalPoints.textContent = data.summary.total;
    elements.playedBets.textContent  = data.summary.played;
    elements.pendingBets.textContent = data.summary.pending;

    setStatus(`${data.phaseLabel} cargado.`, 'ok');
    renderBets(data.bets || []);
  } catch (error) {
    elements.participantName.textContent = 'Participante';
    setStatus(error.message || String(error), 'error');
  }
}

loadParticipant();
