import { fetchAll } from './db.mjs';
import {
  scorePrediction, pointType, scoreKnockoutPrediction,
  scoreGroupPosition, scoreSpecialPrediction,
  GROUP_POSITION_POINTS, SPECIAL_CATEGORY_POINTS
} from './scoring.mjs';
import {
  normalizePhase, getPhaseLabel, isPhaseMatch,
  phaseForMatchLike, knockoutRoundForMatchNo
} from './phases.mjs';
import { normaliseTeam } from './normalise.mjs';

const LIVE_STATUSES    = new Set(['IN_PLAY', 'LIVE', 'PAUSED']);
const FINAL_STATUSES   = new Set(['FINISHED', 'AWARDED', 'AFTER_EXTRA_TIME', 'PENALTY_SHOOTOUT']);
const NOT_STARTED_STATUSES = new Set(['SCHEDULED', 'TIMED', 'POSTPONED', 'CANCELLED', 'CANCELED', 'SUSPENDED']);

async function safeFetchAll(table, opts) {
  try { return await fetchAll(table, opts); }
  catch (e) { console.warn(`Optional table '${table}' not available:`, e.message || e); return []; }
}

function hasNumericScore(match) {
  return Number.isFinite(Number(match?.real_home)) && Number.isFinite(Number(match?.real_away));
}

function effectiveIsScorable(match) {
  if (!match || !hasNumericScore(match)) return false;
  if (match.is_scorable) return true;
  const status = String(match.status || '').toUpperCase();
  if (FINAL_STATUSES.has(status) || LIVE_STATUSES.has(status)) return true;
  if (!NOT_STARTED_STATUSES.has(status)) return true;
  return false;
}

function createParticipantSummary(participant, phase = 'group') {
  return {
    participantKey: participant.participant_key,
    name: participant.name,
    fileName: participant.file_name,
    phase,
    total: 0, exact: 0, goalDifference: 0, winner: 0, miss: 0,
    played: 0, pending: 0, groupPosition: 0, special: 0,
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
  const log = logs[0] || null;
  if (!log) return null;
  return {
    startedAt: log.started_at, finishedAt: log.finished_at,
    ok: log.ok, source: log.source,
    participantsCount: log.participants_count,
    predictionsCount: log.predictions_count,
    matchesCount: log.matches_count,
    warnings: log.warnings || [], error: log.error
  };
}

// ─── knockout match lookup by team-pair + round ────────────────────────────
//
// THE CORE FIX: knockout match_no slots are assigned chronologically by the
// API, but participant Excels use those same numbers as bracket-position IDs
// ("slot 73 = 1st Group A vs 2nd Group B"). Two different participants will
// have different team names in slot 73 depending on their bracket predictions.
//
// Solution: for knockout predictions we NEVER look up the real match by
// match_no. Instead we look up by (round, unordered-team-pair). If the pair
// never played in that round → wrong-matchup (0 pts). If they did → score.

function unorderedPairKey(t1, t2) {
  const a = normaliseTeam(t1);
  const b = normaliseTeam(t2);
  if (!a || !b) return null;
  return [a, b].sort().join('__');
}

/**
 * Build a map of  "ROUND_KEY::team1__team2"  →  match row
 * from all knockout matches stored in Supabase.
 */
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

/**
 * Find the real match for a knockout prediction using round + team pair.
 * Returns null when the predicted matchup hasn't happened yet (pending)
 * or simply doesn't exist in the bracket (wrong-matchup after the round ends).
 */
function findKnockoutMatch(prediction, knockoutMatchByRoundPair) {
  const round = knockoutRoundForMatchNo(prediction.match_no);
  if (!round) return null;
  const pair = unorderedPairKey(prediction.home_team, prediction.away_team);
  if (!pair) return null;
  return knockoutMatchByRoundPair.get(`${round.key}::${pair}`) ?? null;
}

/**
 * Check whether all matches in a given round have a final score, which tells
 * us the round is complete and any still-unmatched prediction is a
 * wrong-matchup (not just pending).
 */
function buildFinishedRounds(matches) {
  // group matches by round key
  const byRound = new Map();
  for (const match of matches) {
    if (!isPhaseMatch(match, 'knockout')) continue;
    const round = knockoutRoundForMatchNo(match.match_no);
    if (!round) continue;
    if (!byRound.has(round.key)) byRound.set(round.key, []);
    byRound.get(round.key).push(match);
  }
  // a round is finished when every match in it has a final status
  const finished = new Set();
  for (const [key, roundMatches] of byRound) {
    if (roundMatches.length && roundMatches.every(m => FINAL_STATUSES.has(String(m.status || '').toUpperCase()))) {
      finished.add(key);
    }
  }
  return finished;
}

// ─── per-prediction scoring ────────────────────────────────────────────────

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
    actual: { home: match?.real_home ?? null, away: match?.real_away ?? null, source: match?.score_source || null },
    points, type, maxPoints: 3
  };
}

function applyKnockoutPrediction(participant, prediction, realMatch, finishedRounds) {
  // realMatch has been looked up by (round + team pair) not by match_no,
  // so if it's non-null the teams definitely match.

  const round = knockoutRoundForMatchNo(prediction.match_no);

  // No real match for this team pair in this round yet.
  // Distinguish: still-unplayed (pending) vs round is over (wrong-matchup).
  if (!realMatch) {
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
      // Show what the participant predicted
      homeTeam: prediction.home_team,
      awayTeam: prediction.away_team,
      predicted: { home: prediction.pred_home, away: prediction.pred_away },
      // No real match found
      actual: { home: null, away: null, source: null },
      actualHomeTeam: null, actualAwayTeam: null, actualMatchNo: null,
      points: 0, type, maxPoints: round?.points?.winner ?? null
    };
  }

  const { points, type } = scoreKnockoutPrediction(prediction, realMatch);
  const isScorable = effectiveIsScorable(realMatch);

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
    kickoff: realMatch.kickoff || prediction.kickoff,
    status: realMatch.status || 'PENDING',
    // What the participant predicted
    homeTeam: prediction.home_team,
    awayTeam: prediction.away_team,
    predicted: { home: prediction.pred_home, away: prediction.pred_away },
    // Real result (teams may be same or flipped vs prediction)
    actual: { home: realMatch.real_home ?? null, away: realMatch.real_away ?? null, source: realMatch.score_source || null },
    actualHomeTeam: realMatch.home_team,
    actualAwayTeam: realMatch.away_team,
    actualMatchNo: realMatch.match_no,
    points, type, maxPoints: round?.points?.winner ?? null
  };
}

function applyPredictionToParticipant(participant, prediction, realMatch, finishedRounds) {
  const bet = isPhaseMatch(prediction, 'knockout')
    ? applyKnockoutPrediction(participant, prediction, realMatch, finishedRounds)
    : applyGroupPrediction(participant, prediction, realMatch);   // for group, realMatch IS the matchMap entry
  participant.breakdown.push(bet);
  return bet;
}

// ─── bonus points ──────────────────────────────────────────────────────────

function applyGroupPositionBonuses(participant, predictedPositions, actualStandingsByGroup) {
  for (const predicted of predictedPositions) {
    const actualTeam = actualStandingsByGroup.get(`${predicted.group_name}__${predicted.position}`);
    const points = scoreGroupPosition(predicted.team, actualTeam);
    if (points > 0) { participant.groupPosition += points; participant.total += points; }
    participant.breakdown.push({
      phase: 'group-position',
      groupName: predicted.group_name,
      position: predicted.position,
      predictedTeam: predicted.team,
      actualTeam: actualTeam || null,
      points, maxPoints: GROUP_POSITION_POINTS,
      type: actualTeam ? (points > 0 ? 'exact' : 'miss') : 'pending'
    });
  }
}

function applySpecialBonuses(participant, predictions, resultsByCategory) {
  for (const prediction of predictions) {
    const actualValue = resultsByCategory.get(prediction.category);
    const points = scoreSpecialPrediction(prediction.category, prediction.predicted_value, actualValue);
    if (points > 0) { participant.special += points; participant.total += points; }
    participant.breakdown.push({
      phase: 'special',
      category: prediction.category,
      predictedValue: prediction.predicted_value,
      actualValue: actualValue || null,
      points, maxPoints: SPECIAL_CATEGORY_POINTS[prediction.category] || 0,
      type: actualValue ? (points > 0 ? 'exact' : 'miss') : 'pending'
    });
  }
}

// ─── shared data helpers ───────────────────────────────────────────────────

async function loadBonusData() {
  const [groupPositionPredictions, groupStandings, specialPredictions, specialResults] = await Promise.all([
    safeFetchAll('group_position_predictions'),
    safeFetchAll('group_standings'),
    safeFetchAll('special_predictions'),
    safeFetchAll('special_results')
  ]);
  const actualStandingsByGroup = new Map(groupStandings.map(r => [`${r.group_name}__${r.position}`, r.team]));
  const resultsByCategory      = new Map(specialResults.map(r => [r.category, r.actual_value]));
  return { groupPositionPredictions, specialPredictions, actualStandingsByGroup, resultsByCategory };
}

function matchDto(match) {
  return {
    matchNo: match.match_no,
    phase: phaseForMatchLike(match),
    round: knockoutRoundForMatchNo(match.match_no)?.key || null,
    kickoff: match.kickoff, status: match.status,
    stage: match.stage, groupName: match.group_name,
    homeTeam: match.home_team, awayTeam: match.away_team,
    realHome: match.real_home, realAway: match.real_away,
    isScorable: effectiveIsScorable(match)
  };
}

function buildParticipantsList(participants, leaderboardByKey) {
  return participants
    .map(p => {
      const s = leaderboardByKey.get(p.participant_key);
      return {
        participantKey: p.participant_key, name: p.name, fileName: p.file_name,
        total: s?.total ?? 0, exact: s?.exact ?? 0, goalDifference: s?.goalDifference ?? 0,
        winner: s?.winner ?? 0, miss: s?.miss ?? 0, played: s?.played ?? 0,
        pending: s?.pending ?? 0, groupPosition: s?.groupPosition ?? 0,
        special: s?.special ?? 0, rank: s?.rank ?? null
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ─── public API ───────────────────────────────────────────────────────────

export async function buildLeaderboard({ phase = 'all' } = {}) {
  const selectedPhase = normalizePhase(phase);
  const [participants, predictions, matches, logs] = await Promise.all([
    fetchAll('participants',  { orderBy: 'name' }),
    fetchAll('predictions',   { orderBy: 'match_no' }),
    fetchAll('matches',       { orderBy: 'match_no' }),
    fetchAll('sync_logs',     { orderBy: 'started_at', ascending: false })
  ]);

  const filteredMatches = matches.filter(m => isPhaseMatch(m, selectedPhase));
  const participantMap  = new Map(participants.map(p => [p.participant_key, createParticipantSummary(p, selectedPhase)]));
  const matchMap        = new Map(matches.map(m => [m.match_no, m]));               // group stage only
  const knockoutByPair  = buildKnockoutMatchByRoundPair(matches);
  const finishedRounds  = buildFinishedRounds(matches);

  for (const prediction of predictions) {
    if (!isPhaseMatch(prediction, selectedPhase)) continue;
    const participant = participantMap.get(prediction.participant_key);
    if (!participant) continue;

    const isKnockout = isPhaseMatch(prediction, 'knockout');
    const realMatch  = isKnockout
      ? findKnockoutMatch(prediction, knockoutByPair)
      : matchMap.get(prediction.match_no);

    applyPredictionToParticipant(participant, prediction, realMatch, finishedRounds);
  }

  if (selectedPhase === 'all') {
    const { groupPositionPredictions, specialPredictions, actualStandingsByGroup, resultsByCategory } = await loadBonusData();
    const positionsByParticipant = new Map();
    for (const r of groupPositionPredictions) {
      if (!positionsByParticipant.has(r.participant_key)) positionsByParticipant.set(r.participant_key, []);
      positionsByParticipant.get(r.participant_key).push(r);
    }
    const specialsByParticipant = new Map();
    for (const r of specialPredictions) {
      if (!specialsByParticipant.has(r.participant_key)) specialsByParticipant.set(r.participant_key, []);
      specialsByParticipant.get(r.participant_key).push(r);
    }
    for (const participant of participantMap.values()) {
      applyGroupPositionBonuses(participant, positionsByParticipant.get(participant.participantKey) || [], actualStandingsByGroup);
      applySpecialBonuses(participant, specialsByParticipant.get(participant.participantKey) || [], resultsByCategory);
    }
  }

  const sorted = [...participantMap.values()].sort(compareLeaders);
  let currentRank = 0;
  const leaderboard = sorted.map((entry, index) => {
    const prev = sorted[index - 1];
    const tied = prev && compareLeaders({ ...prev, name: entry.name }, { ...entry, name: prev.name }) === 0;
    if (!tied) currentRank = index + 1;
    return { ...entry, rank: currentRank };
  });

  const leaderboardByKey = new Map(leaderboard.map(e => [e.participantKey, e]));

  return {
    generatedAt: new Date().toISOString(),
    phase: selectedPhase, phaseLabel: getPhaseLabel(selectedPhase),
    lastSync: latestSyncSummary(logs),
    summary: {
      participants: participants.length,
      predictions: predictions.filter(p => isPhaseMatch(p, selectedPhase)).length,
      matches: filteredMatches.length,
      scorableMatches: filteredMatches.filter(effectiveIsScorable).length,
      finishedMatches: filteredMatches.filter(m => FINAL_STATUSES.has(String(m.status || '').toUpperCase())).length
    },
    participants: buildParticipantsList(participants, leaderboardByKey),
    matches: filteredMatches.map(matchDto),
    leaderboard
  };
}

export async function buildParticipantBets(participantKey, { phase = 'all' } = {}) {
  const selectedPhase = normalizePhase(phase);
  const [participants, predictions, matches, logs] = await Promise.all([
    fetchAll('participants',  { orderBy: 'name' }),
    fetchAll('predictions',   { orderBy: 'match_no' }),
    fetchAll('matches',       { orderBy: 'match_no' }),
    fetchAll('sync_logs',     { orderBy: 'started_at', ascending: false })
  ]);

  const participant = participants.find(p => p.participant_key === participantKey);
  if (!participant) {
    return {
      ok: false, error: 'Participant not found',
      participants: participants.map(p => ({ participantKey: p.participant_key, name: p.name })).sort((a, b) => a.name.localeCompare(b.name))
    };
  }

  const summary        = createParticipantSummary(participant, selectedPhase);
  const matchMap       = new Map(matches.map(m => [m.match_no, m]));
  const knockoutByPair = buildKnockoutMatchByRoundPair(matches);
  const finishedRounds = buildFinishedRounds(matches);

  const participantPredictions = predictions
    .filter(p => p.participant_key === participantKey)
    .filter(p => isPhaseMatch(p, selectedPhase));

  for (const prediction of participantPredictions) {
    const isKnockout = isPhaseMatch(prediction, 'knockout');
    const realMatch  = isKnockout
      ? findKnockoutMatch(prediction, knockoutByPair)
      : matchMap.get(prediction.match_no);
    applyPredictionToParticipant(summary, prediction, realMatch, finishedRounds);
  }

  if (selectedPhase === 'all') {
    const { groupPositionPredictions, specialPredictions, actualStandingsByGroup, resultsByCategory } = await loadBonusData();
    applyGroupPositionBonuses(summary, groupPositionPredictions.filter(r => r.participant_key === participantKey), actualStandingsByGroup);
    applySpecialBonuses(summary, specialPredictions.filter(r => r.participant_key === participantKey), resultsByCategory);
  }

  summary.breakdown.sort((a, b) => (a.matchNo ?? 9999) - (b.matchNo ?? 9999));

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    phase: selectedPhase, phaseLabel: getPhaseLabel(selectedPhase),
    lastSync: latestSyncSummary(logs),
    participant: { participantKey: participant.participant_key, name: participant.name, fileName: participant.file_name },
    participants: participants.map(p => ({ participantKey: p.participant_key, name: p.name })).sort((a, b) => a.name.localeCompare(b.name)),
    summary: {
      total: summary.total, exact: summary.exact, goalDifference: summary.goalDifference,
      winner: summary.winner, miss: summary.miss, played: summary.played,
      pending: summary.pending, groupPosition: summary.groupPosition,
      special: summary.special, bets: summary.breakdown.length
    },
    bets: summary.breakdown
  };
}
