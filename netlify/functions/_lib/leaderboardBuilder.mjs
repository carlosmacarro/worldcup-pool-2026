import { fetchAll } from './db.mjs';
import { scorePrediction, pointType, scoreKnockoutPrediction, scoreGroupPosition, scoreSpecialPrediction, GROUP_POSITION_POINTS, SPECIAL_CATEGORY_POINTS } from './scoring.mjs';
import { normalizePhase, getPhaseLabel, isPhaseMatch, phaseForMatchLike, knockoutRoundForMatchNo } from './phases.mjs';
import { normaliseTeam } from './normalise.mjs';

const LIVE_STATUSES = new Set(['IN_PLAY', 'LIVE', 'PAUSED']);
const FINAL_STATUSES = new Set(['FINISHED', 'AWARDED', 'AFTER_EXTRA_TIME', 'PENALTY_SHOOTOUT']);
const NOT_STARTED_STATUSES = new Set(['SCHEDULED', 'TIMED', 'POSTPONED', 'CANCELLED', 'CANCELED', 'SUSPENDED']);

// Tables for the group-position bonus and tournament-wide special awards are
// optional add-ons (see supabase_schema.sql). If they haven't been created
// yet in Supabase, fail soft so the rest of the leaderboard keeps working.
async function safeFetchAll(table, opts) {
  try {
    return await fetchAll(table, opts);
  } catch (error) {
    console.warn(`Optional table '${table}' not available yet:`, error.message || error);
    return [];
  }
}

function hasNumericScore(match) {
  return Number.isFinite(Number(match?.real_home)) && Number.isFinite(Number(match?.real_away));
}

function effectiveIsScorable(match) {
  if (!match || !hasNumericScore(match)) return false;
  if (match.is_scorable) return true;

  const status = String(match.status || '').toUpperCase();

  // Robust fallback: if the API has already stored a real score for a finished/final-like
  // or live match, score it even if the older sync wrote is_scorable=false.
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
    groupPosition: 0,
    special: 0,
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

// ─── Knockout match lookup by team-pair + round ────────────────────────────
// THE CORE FIX: knockout match_no slots are assigned chronologically by the
// API, but participant Excels may have predictions in different row order.
// Solution: for knockout predictions we look up the real match by (round,
// unordered-team-pair) instead of by match_no. If the pair never played in
// that round → wrong-matchup (0 pts). If they did → score normally.

function unorderedPairKey(t1, t2) {
  if (!t1 || !t2) return null;
  const a = normaliseTeam(t1);
  const b = normaliseTeam(t2);
  if (!a || !b) return null;
  return [a, b].sort().join('__');
}

function buildKnockoutMatchByRoundPair(matches) {
  const map = new Map();
  for (const match of matches) {
    if (!isPhaseMatch(match, 'knockout')) continue;
    const round = knockoutRoundForMatchNo(match.match_no);
    if (!round) continue;
    const pair = unorderedPairKey(match.home_team, match.away_team);
    if (!pair) continue;
    map.set(`${round.key}::${pair}`, match);
  }
  return map;
}

function buildFinishedRounds(matches) {
  const finished = new Set();
  for (const match of matches) {
    if (!isPhaseMatch(match, 'knockout')) continue;
    const round = knockoutRoundForMatchNo(match.match_no);
    if (!round) continue;
    const hasScore = Number.isFinite(Number(match.real_home)) && Number.isFinite(Number(match.real_away));
    const status = String(match.status || '').toUpperCase();
    const isFinished = hasScore && (FINAL_STATUSES.has(status) || status === 'AWARDED');
    if (isFinished) finished.add(round.key);
  }
  return finished;
}

function findKnockoutMatch(prediction, knockoutMatchByRoundPair) {
  const round = knockoutRoundForMatchNo(prediction.match_no);
  if (!round) return null;
  const pair = unorderedPairKey(prediction.home_team, prediction.away_team);
  if (!pair) return null;
  return knockoutMatchByRoundPair.get(`${round.key}::${pair}`) ?? null;
}

function applyGroupPrediction(participant, prediction, match) {
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

  return {
    matchNo: prediction.match_no,
    phase: 'group',
    roundLabel: prediction.round_label || null,
    kickoff: prediction.kickoff || match?.kickoff,
    status: match?.status || 'PENDING',
    homeTeam: prediction.home_team || match?.home_team,
    awayTeam: prediction.away_team || match?.away_team,
    predicted: { home: prediction.pred_home, away: prediction.pred_away },
    actual: {
      home: match?.real_home ?? null,
      away: match?.real_away ?? null,
      source: match?.score_source || null
    },
    points,
    type,
    maxPoints: 3
  };
}

function applyKnockoutPrediction(participant, prediction, match, finishedRounds) {
  // If no real match found, check if round is finished to distinguish pending vs wrong-matchup
  if (!match) {
    const round = knockoutRoundForMatchNo(prediction.match_no);
    const roundKey = round?.key;
    const isWrongMatchup = roundKey ? finishedRounds.has(roundKey) : false;
    const type = isWrongMatchup ? 'wrong-matchup' : 'pending';

    if (isWrongMatchup) {
      participant.played += 1;
      participant.miss += 1;
    } else {
      participant.pending += 1;
    }

    return {
      matchNo: prediction.match_no,
      phase: 'knockout',
      round: round?.key || null,
      roundLabel: round?.label || prediction.round_label || null,
      kickoff: prediction.kickoff || null,
      status: isWrongMatchup ? 'WRONG_MATCHUP' : 'PENDING',
      homeTeam: prediction.home_team,
      awayTeam: prediction.away_team,
      predicted: { home: prediction.pred_home, away: prediction.pred_away },
      actual: { home: null, away: null, source: null },
      points: 0,
      type,
      maxPoints: round?.points?.winner ?? null
    };
  }

  const { points, type, round } = scoreKnockoutPrediction(prediction, match);
  const isScorable = effectiveIsScorable(match);

  if (isScorable) {
    participant.total += points;
    participant.played += 1;
    if (type === 'exact') participant.exact += 1;
    else if (type === 'goal-difference') participant.goalDifference += 1;
    else if (type === 'winner') participant.winner += 1;
    else participant.miss += 1;
  } else {
    participant.pending += 1;
  }

  return {
    matchNo: prediction.match_no,
    phase: 'knockout',
    round: round?.key || null,
    roundLabel: round?.label || prediction.round_label || null,
    kickoff: match.kickoff || prediction.kickoff,
    status: match.status || 'PENDING',
    homeTeam: prediction.home_team,
    awayTeam: prediction.away_team,
    predicted: { home: prediction.pred_home, away: prediction.pred_away },
    actual: {
      home: match.real_home ?? null,
      away: match.real_away ?? null,
      source: match.score_source || null
    },
    points,
    type,
    maxPoints: round?.points?.winner ?? null
  };
}

function applyPredictionToParticipant(participant, prediction, match, finishedRounds) {
  const bet = isPhaseMatch(prediction, 'knockout')
    ? applyKnockoutPrediction(participant, prediction, match, finishedRounds)
    : applyGroupPrediction(participant, prediction, match);
  participant.breakdown.push(bet);
  return bet;
}

function applyGroupPositionBonuses(participant, predictedPositions, actualStandingsByGroup) {
  for (const predicted of predictedPositions) {
    const actualTeam = actualStandingsByGroup.get(`${predicted.group_name}__${predicted.position}`);
    const points = scoreGroupPosition(predicted.team, actualTeam);
    if (points > 0) {
      participant.groupPosition += points;
      participant.total += points;
    }
    participant.breakdown.push({
      phase: 'group-position',
      groupName: predicted.group_name,
      position: predicted.position,
      predictedTeam: predicted.team,
      actualTeam: actualTeam || null,
      points,
      maxPoints: GROUP_POSITION_POINTS,
      type: actualTeam ? (points > 0 ? 'exact' : 'miss') : 'pending'
    });
  }
}

function applySpecialBonuses(participant, predictions, resultsByCategory) {
  for (const prediction of predictions) {
    const actualValue = resultsByCategory.get(prediction.category);
    const points = scoreSpecialPrediction(prediction.category, prediction.predicted_value, actualValue);
    if (points > 0) {
      participant.special += points;
      participant.total += points;
    }
    participant.breakdown.push({
      phase: 'special',
      category: prediction.category,
      predictedValue: prediction.predicted_value,
      actualValue: actualValue || null,
      points,
      maxPoints: SPECIAL_CATEGORY_POINTS[prediction.category] || 0,
      type: actualValue ? (points > 0 ? 'exact' : 'miss') : 'pending'
    });
  }
}

function matchDto(match) {
  return {
    matchNo: match.match_no,
    phase: phaseForMatchLike(match),
    round: knockoutRoundForMatchNo(match.match_no)?.key || null,
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
        groupPosition: summary?.groupPosition ?? 0,
        special: summary?.special ?? 0,
        rank: summary?.rank ?? null
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function loadBonusData() {
  const [groupPositionPredictions, groupStandings, specialPredictions, specialResults] = await Promise.all([
    safeFetchAll('group_position_predictions'),
    safeFetchAll('group_standings'),
    safeFetchAll('special_predictions'),
    safeFetchAll('special_results')
  ]);

  const actualStandingsByGroup = new Map(
    groupStandings.map((row) => [`${row.group_name}__${row.position}`, row.team])
  );
  const resultsByCategory = new Map(specialResults.map((row) => [row.category, row.actual_value]));

  return { groupPositionPredictions, specialPredictions, actualStandingsByGroup, resultsByCategory };
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
  const knockoutByPair = buildKnockoutMatchByRoundPair(matches);
  const finishedRounds = buildFinishedRounds(matches);

  for (const prediction of predictions) {
    if (!isPhaseMatch(prediction, selectedPhase)) continue;

    const participant = participantMap.get(prediction.participant_key);
    if (!participant) continue;

    const isKnockout = isPhaseMatch(prediction, 'knockout');
    const match = isKnockout
      ? findKnockoutMatch(prediction, knockoutByPair)
      : matchMap.get(prediction.match_no);

    applyPredictionToParticipant(participant, prediction, match, finishedRounds);
  }

  // Group-position and special-award bonuses are tournament-wide, so they
  // only apply to the combined "all" view, not the per-phase group/knockout tabs.
  if (selectedPhase === 'all') {
    const { groupPositionPredictions, specialPredictions, actualStandingsByGroup, resultsByCategory } = await loadBonusData();
    const positionsByParticipant = new Map();
    for (const row of groupPositionPredictions) {
      if (!positionsByParticipant.has(row.participant_key)) positionsByParticipant.set(row.participant_key, []);
      positionsByParticipant.get(row.participant_key).push(row);
    }
    const specialsByParticipant = new Map();
    for (const row of specialPredictions) {
      if (!specialsByParticipant.has(row.participant_key)) specialsByParticipant.set(row.participant_key, []);
      specialsByParticipant.get(row.participant_key).push(row);
    }

    for (const participant of participantMap.values()) {
      applyGroupPositionBonuses(participant, positionsByParticipant.get(participant.participantKey) || [], actualStandingsByGroup);
      applySpecialBonuses(participant, specialsByParticipant.get(participant.participantKey) || [], resultsByCategory);
    }
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
      predictions: predictions.filter((p) => isPhaseMatch(p, selectedPhase)).length,
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
    .filter((p) => isPhaseMatch(p, selectedPhase));

  for (const prediction of participantPredictions) {
    applyPredictionToParticipant(summary, prediction, matchMap.get(prediction.match_no));
  }

  if (selectedPhase === 'all') {
    const { groupPositionPredictions, specialPredictions, actualStandingsByGroup, resultsByCategory } = await loadBonusData();
    applyGroupPositionBonuses(summary, groupPositionPredictions.filter((r) => r.participant_key === participantKey), actualStandingsByGroup);
    applySpecialBonuses(summary, specialPredictions.filter((r) => r.participant_key === participantKey), resultsByCategory);
  }

  summary.breakdown.sort((a, b) => (a.matchNo ?? 0) - (b.matchNo ?? 0));

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
      groupPosition: summary.groupPosition,
      special: summary.special,
      bets: summary.breakdown.length
    },
    bets: summary.breakdown
  };
}