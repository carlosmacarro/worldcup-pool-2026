export function resultSign(home, away) {
  const diff = Number(home) - Number(away);
  if (diff > 0) return 1;
  if (diff < 0) return -1;
  return 0;
}

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
