import { fetchAll } from './db.mjs';
import { scorePrediction, pointType } from './scoring.mjs';
import { normalizePhase, getPhaseLabel, isPhaseMatch, phaseForMatchLike } from './phases.mjs';

const LIVE_STATUSES = new Set(['IN_PLAY', 'LIVE', 'PAUSED']);
const FINAL_STATUSES = new Set(['FINISHED', 'AWARDED', 'AFTER_EXTRA_TIME', 'PENALTY_SHOOTOUT']);
const NOT_STARTED_STATUSES = new Set(['SCHEDULED', 'TIMED', 'POSTPONED', 'CANCELLED', 'CANCELED', 'SUSPENDED']);

function hasNumericScore(match) {
  return Number.isFinite(Number(match?.real_home)) && Number.isFinite(Number(match?.real_away));
}

function effectiveIsScorable(match) {
  if (!match || !hasNumericScore(match)) return false;
  if (match.is_scorable) return true;

  const status = String(match.status || '').toUpperCase();

  // Robust fallback: if the API has already stored a real score for a finished/final-like
  // or live match, score it even if the older sync wrote is_scorable=false.
  // This fixes cases where match cards show live/recent scores but the leaderboard remains pending.
  if (FINAL_STATUSES.has(status) || LIVE_STATUSES.has(status)) return true;

  // Some APIs briefly return a score with a generic/unknown status after kickoff.
  // Count it unless the status clearly means the match has not started or was cancelled/postponed.
  if (!NOT_STARTED_STATUSES.has(status)) return true;

  return false;
}

function createParticipantSummary(participant, phase = 'group') {
  return {
    participantKey: participant.participant_key,
    name: participant.name,
    fileName: participant.file_name,
    phase,
    total: 0,
    exact: 0,
    goalDifference: 0,
    winner: 0,
    miss: 0,
    played: 0,
    pending: 0,
    breakdown: []
  };
}

function compareLeaders(a, b) {
  return (
    b.total - a.total ||
    b.exact - a.exact ||
    b.goalDifference - a.goalDifference ||
    b.winner - a.winner ||
    a.name.localeCompare(b.name)
  );
}

function latestSyncSummary(logs) {
  const latestLog = logs[0] || null;
  return latestLog
    ? {
        startedAt: latestLog.started_at,
        finishedAt: latestLog.finished_at,
        ok: latestLog.ok,
        source: latestLog.source,
        participantsCount: latestLog.participants_count,
        predictionsCount: latestLog.predictions_count,
        matchesCount: latestLog.matches_count,
        warnings: latestLog.warnings || [],
        error: latestLog.error
      }
    : null;
}

function applyPredictionToParticipant(participant, prediction, match) {
  const isScorable = effectiveIsScorable(match);
  let points = 0;
  let type = 'pending';

  if (isScorable) {
    points = scorePrediction(prediction.pred_home, prediction.pred_away, match.real_home, match.real_away);
    type = pointType(points);
    participant.total += points;
    participant.played += 1;
    if (points === 3) participant.exact += 1;
    else if (points === 2) participant.goalDifference += 1;
    else if (points === 1) participant.winner += 1;
    else participant.miss += 1;
  } else {
    participant.pending += 1;
  }

  const bet = {
    matchNo: prediction.match_no,
    phase: phaseForMatchLike({ ...prediction, stage: match?.stage }),
    roundLabel: prediction.round_label || null,
    kickoff: prediction.kickoff || match?.kickoff,
    status: match?.status || 'PENDING',
    // Participant detail pages should always show the teams as they appear in the user's Excel bet.
    // Match rows are still used for actual scores and points.
    homeTeam: prediction.home_team || match?.home_team,
    awayTeam: prediction.away_team || match?.away_team,
    predicted: { home: prediction.pred_home, away: prediction.pred_away },
    actual: {
      home: match?.real_home ?? null,
      away: match?.real_away ?? null,
      source: match?.score_source || null
    },
    points,
    type
  };

  participant.breakdown.push(bet);
  return bet;
}

function matchDto(match) {
  return {
    matchNo: match.match_no,
    phase: phaseForMatchLike(match),
    kickoff: match.kickoff,
    status: match.status,
    stage: match.stage,
    groupName: match.group_name,
    homeTeam: match.home_team,
    awayTeam: match.away_team,
    realHome: match.real_home,
    realAway: match.real_away,
    isScorable: effectiveIsScorable(match)
  };
}

function buildParticipantsList(participants, leaderboardByKey) {
  return participants
    .map((participant) => {
      const summary = leaderboardByKey.get(participant.participant_key);
      return {
        participantKey: participant.participant_key,
        name: participant.name,
        fileName: participant.file_name,
        total: summary?.total ?? 0,
        exact: summary?.exact ?? 0,
        goalDifference: summary?.goalDifference ?? 0,
        winner: summary?.winner ?? 0,
        miss: summary?.miss ?? 0,
        played: summary?.played ?? 0,
        pending: summary?.pending ?? 0,
        rank: summary?.rank ?? null
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function buildLeaderboard({ phase = 'group' } = {}) {
  const selectedPhase = normalizePhase(phase);
  const [participants, predictions, matches, logs] = await Promise.all([
    fetchAll('participants', { orderBy: 'name' }),
    fetchAll('predictions', { orderBy: 'match_no' }),
    fetchAll('matches', { orderBy: 'match_no' }),
    fetchAll('sync_logs', { orderBy: 'started_at', ascending: false })
  ]);

  const filteredMatches = matches.filter((m) => isPhaseMatch(m, selectedPhase));
  const participantMap = new Map(participants.map((p) => [p.participant_key, createParticipantSummary(p, selectedPhase)]));
  const matchMap = new Map(matches.map((m) => [m.match_no, m]));

  for (const prediction of predictions) {
    const match = matchMap.get(prediction.match_no);
    if (!isPhaseMatch({ ...prediction, stage: match?.stage }, selectedPhase)) continue;

    const participant = participantMap.get(prediction.participant_key);
    if (!participant) continue;
    applyPredictionToParticipant(participant, prediction, match);
  }

  const sorted = [...participantMap.values()].sort(compareLeaders);
  let currentRank = 0;
  const leaderboard = sorted.map((entry, index) => {
    const previous = sorted[index - 1];
    const tied = previous && compareLeaders({ ...previous, name: entry.name }, { ...entry, name: previous.name }) === 0;
    if (!tied) currentRank = index + 1;
    return { ...entry, rank: currentRank };
  });

  const leaderboardByKey = new Map(leaderboard.map((entry) => [entry.participantKey, entry]));

  return {
    generatedAt: new Date().toISOString(),
    phase: selectedPhase,
    phaseLabel: getPhaseLabel(selectedPhase),
    lastSync: latestSyncSummary(logs),
    summary: {
      participants: participants.length,
      predictions: predictions.filter((p) => isPhaseMatch({ ...p, stage: matchMap.get(p.match_no)?.stage }, selectedPhase)).length,
      matches: filteredMatches.length,
      scorableMatches: filteredMatches.filter(effectiveIsScorable).length,
      finishedMatches: filteredMatches.filter((m) => String(m.status || '').toUpperCase() === 'FINISHED').length
    },
    participants: buildParticipantsList(participants, leaderboardByKey),
    matches: filteredMatches.map(matchDto),
    leaderboard
  };
}

export async function buildParticipantBets(participantKey, { phase = 'group' } = {}) {
  const selectedPhase = normalizePhase(phase);
  const [participants, predictions, matches, logs] = await Promise.all([
    fetchAll('participants', { orderBy: 'name' }),
    fetchAll('predictions', { orderBy: 'match_no' }),
    fetchAll('matches', { orderBy: 'match_no' }),
    fetchAll('sync_logs', { orderBy: 'started_at', ascending: false })
  ]);

  const participant = participants.find((p) => p.participant_key === participantKey);
  if (!participant) {
    return {
      ok: false,
      error: 'Participant not found',
      participants: participants.map((p) => ({ participantKey: p.participant_key, name: p.name })).sort((a, b) => a.name.localeCompare(b.name))
    };
  }

  const summary = createParticipantSummary(participant, selectedPhase);
  const matchMap = new Map(matches.map((m) => [m.match_no, m]));
  const participantPredictions = predictions
    .filter((p) => p.participant_key === participantKey)
    .filter((p) => isPhaseMatch({ ...p, stage: matchMap.get(p.match_no)?.stage }, selectedPhase));

  for (const prediction of participantPredictions) {
    applyPredictionToParticipant(summary, prediction, matchMap.get(prediction.match_no));
  }

  summary.breakdown.sort((a, b) => a.matchNo - b.matchNo);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    phase: selectedPhase,
    phaseLabel: getPhaseLabel(selectedPhase),
    lastSync: latestSyncSummary(logs),
    participant: {
      participantKey: participant.participant_key,
      name: participant.name,
      fileName: participant.file_name
    },
    participants: participants.map((p) => ({ participantKey: p.participant_key, name: p.name })).sort((a, b) => a.name.localeCompare(b.name)),
    summary: {
      total: summary.total,
      exact: summary.exact,
      goalDifference: summary.goalDifference,
      winner: summary.winner,
      miss: summary.miss,
      played: summary.played,
      pending: summary.pending,
      bets: summary.breakdown.length
    },
    bets: summary.breakdown
  };
}
