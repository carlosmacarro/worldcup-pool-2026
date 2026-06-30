import { normaliseTeam } from './normalise.mjs';
import { knockoutRoundForMatchNo } from './phases.mjs';

export function resultSign(home, away) {
  const diff = Number(home) - Number(away);
  if (diff > 0) return 1;
  if (diff < 0) return -1;
  return 0;
}

// ---- Group-stage scoreline scoring (unchanged: 3 / 2 / 1) ----

export function scorePrediction(predHome, predAway, realHome, realAway) {
  if (![predHome, predAway, realHome, realAway].every((v) => Number.isFinite(Number(v)))) return 0;

  predHome = Number(predHome);
  predAway = Number(predAway);
  realHome = Number(realHome);
  realAway = Number(realAway);

  if (predHome === realHome && predAway === realAway) return 3;

  const predDiff = predHome - predAway;
  const realDiff = realHome - realAway;
  const predWinner = resultSign(predHome, predAway);
  const realWinner = resultSign(realHome, realAway);

  if (predWinner === realWinner && predDiff === realDiff) return 2;
  if (predWinner === realWinner) return 1;
  return 0;
}

export function pointType(points) {
  if (points === 3) return 'exact';
  if (points === 2) return 'goal-difference';
  if (points === 1) return 'winner';
  return 'miss';
}

// ---- Group position bonus (+2 for correctly predicted final standing) ----

export const GROUP_POSITION_POINTS = 2;

export function scoreGroupPosition(predictedTeam, actualTeam) {
  if (!predictedTeam || !actualTeam) return 0;
  return normaliseTeam(predictedTeam) === normaliseTeam(actualTeam) ? GROUP_POSITION_POINTS : 0;
}

// ---- Special tournament-wide predictions ----

export const SPECIAL_CATEGORY_POINTS = {
  winner: 8,
  second: 5,
  third: 3,
  balon_de_oro: 5,
  bota_de_oro: 5
};

export function scoreSpecialPrediction(category, predictedValue, actualValue) {
  const points = SPECIAL_CATEGORY_POINTS[category] || 0;
  if (!predictedValue || !actualValue) return 0;
  // Player names (Balón/Bota de Oro) and team names both compare safely
  // through the same normaliser; team aliases simply won't match player names.
  const a = normaliseTeam(predictedValue);
  const b = normaliseTeam(actualValue);
  return a && b && a === b ? points : 0;
}

// ---- Knockout-phase scoring ----
//
// Knockout bets predict which two teams will meet in a given bracket slot AND
// the scoreline between them. Because the bracket isn't known in advance, a
// participant's predicted matchup can turn out to involve teams that never
// actually played each other in that slot (e.g. they predicted the wrong team
// advanced from an earlier round). Those bets must score 0 without throwing -
// we detect this by comparing the predicted team pair against the real team
// pair stored on the match row (order-insensitive), rather than trying to
// trace bracket logic.

//function teamsMatchUnordered(predHome, predAway, realHome, realAway) {
  //if (!predHome || !predAway || !realHome || !realAway) return false;
  //const a = [normaliseTeam(predHome), normaliseTeam(predAway)].sort();
  //const b = [normaliseTeam(realHome), normaliseTeam(realAway)].sort();
  //return a[0] === b[0] && a[1] === b[1];
//}
function teamMatchLoose(a, b) {
  if (!a || !b) return false;

  const na = normaliseTeam(a);
  const nb = normaliseTeam(b);

  if (!na || !nb) return false;

  // exact match
  if (na === nb) return true;

  // 🔥 NEW: loose match (handles Cabo Verde / Cape Verde etc.)
  return na.includes(nb) || nb.includes(na);
}

function teamsMatchUnordered(predHome, predAway, realHome, realAway) {
  if (!predHome || !predAway || !realHome || !realAway) return false;

  const match1 =
    teamMatchLoose(predHome, realHome) &&
    teamMatchLoose(predAway, realAway);

  const match2 =
    teamMatchLoose(predHome, realAway) &&
    teamMatchLoose(predAway, realHome);

  return match1 || match2;
}

/**
 * @param {object} prediction - { match_no, home_team, away_team, pred_home, pred_away }
 * @param {object} match - matches table row { match_no, home_team, away_team, real_home, real_away }
 * @returns {{ points: number, type: string, round: object|null }}
 */
export function scoreKnockoutPrediction(prediction, match) {
  const round = knockoutRoundForMatchNo(prediction?.match_no);
  if (!round) return { points: 0, type: 'miss', round: null };

  if (!match) return { points: 0, type: 'pending', round };

  const hasRealScore = Number.isFinite(Number(match.real_home)) && Number.isFinite(Number(match.real_away));
  if (!hasRealScore) return { points: 0, type: 'pending', round };

  // The matchup the participant bet on never actually happened: their earlier
  // round picks were wrong, so this slot was contested by different teams.
  // Score 0 silently instead of erroring.
  if (!teamsMatchUnordered(prediction.home_team, prediction.away_team, match.home_team, match.away_team)) {
    return { points: 0, type: 'wrong-matchup', round };
  }

  const predHome = Number(prediction.pred_home);
  const predAway = Number(prediction.pred_away);
  const realHome = Number(match.real_home);
  const realAway = Number(match.real_away);
  if (![predHome, predAway, realHome, realAway].every(Number.isFinite)) {
    return { points: 0, type: 'pending', round };
  }

  // Flip prediction if the team order is reversed vs. the stored match row,
  // so the goal comparison still lines up with the right side.
  const sameOrder = normaliseTeam(prediction.home_team) === normaliseTeam(match.home_team);
  const ph = sameOrder ? predHome : predAway;
  const pa = sameOrder ? predAway : predHome;

  if (ph === realHome && pa === realAway) {
    return { points: round.points.exact, type: 'exact', round };
  }

  const predDiff = ph - pa;
  const realDiff = realHome - realAway;
  const predWinner = resultSign(ph, pa);
  const realWinner = resultSign(realHome, realAway);

  if (predWinner === realWinner && predDiff === realDiff) {
    return { points: round.points.goalDifference, type: 'goal-difference', round };
  }
  if (predWinner === realWinner) {
    return { points: round.points.winner, type: 'winner', round };
  }
  return { points: 0, type: 'miss', round };
}
