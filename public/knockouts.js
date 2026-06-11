const elements = {
  status: document.querySelector('#status'),
  participants: document.querySelector('#participants')
};

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
      <a class="participant-main" href="/participant.html?participant=${encodeURIComponent(row.participantKey)}&phase=knockout">
        <strong>${escapeHtml(row.name)}</strong>
        <span>Open knockout-phase bets</span>
      </a>
      <a class="small-link" href="/participant.html?participant=${encodeURIComponent(row.participantKey)}&phase=group">Group bets</a>
    `;
    elements.participants.appendChild(item);
  }
}

async function loadParticipants() {
  try {
    const response = await fetch('/.netlify/functions/leaderboard?phase=group', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || 'Could not load participants');
    setStatus('Participants loaded.', 'ok');
    renderParticipants(data.participants || []);
  } catch (error) {
    setStatus(error.message || String(error), 'error');
  }
}

loadParticipants();
