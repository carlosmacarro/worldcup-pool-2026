export const GROUP_STAGE_MAX_MATCH_NO = 72;

// Fixed bracket slots for the 2026 World Cup (104 matches total: 72 group + 32 knockout).
// Match numbers follow the official FIFA fixture numbering:
//   1-72    Group stage
//   73-88   Round of 32  ("1/16", dieciseisavos)   16 matches
//   89-96   Round of 16  ("1/8", octavos)            8 matches
//   97-100  Quarter-finals ("1/4", cuartos)           4 matches
//   101-102 Semi-finals                                2 matches
//   103     Third-place match
//   104     Final
// If your Excel template numbers knockout matches differently, adjust the
// ranges below (and KNOCKOUT_API_ROUND_ORDER in knockoutMatches.mjs) to match.
export const KNOCKOUT_ROUNDS = [
  { key: 'RO32', label: 'Dieciseisavos de final', from: 73, to: 88, points: { exact: 2, goalDifference: 3, winner: 4 } },
  { key: 'RO16', label: 'Octavos de final', from: 89, to: 96, points: { exact: 3, goalDifference: 4, winner: 5 } },
  { key: 'QF', label: 'Cuartos de final', from: 97, to: 100, points: { exact: 4, goalDifference: 5, winner: 6 } },
  { key: 'SF', label: 'Semifinales', from: 101, to: 102, points: { exact: 5, goalDifference: 6, winner: 7 } },
  // Third-place match was not specified by name in the points scale you gave us.
  // Defaulting it to the same scale as the semi-finals since it is contested by
  // two semi-final losers. Change this if you'd rather it score like the final
  // or like its own tier.
  { key: 'THIRD_PLACE', label: 'Tercer y cuarto puesto', from: 103, to: 103, points: { exact: 5, goalDifference: 6, winner: 7 } },
  { key: 'FINAL', label: 'Final', from: 104, to: 104, points: { exact: 6, goalDifference: 7, winner: 8 } }
];

export function knockoutRoundForMatchNo(matchNo) {
  const n = Number(matchNo);
  if (!Number.isInteger(n)) return null;
  return KNOCKOUT_ROUNDS.find((round) => n >= round.from && n <= round.to) || null;
}

export function isKnockoutMatchNo(matchNo) {
  const n = Number(matchNo);
  return Number.isInteger(n) && n > GROUP_STAGE_MAX_MATCH_NO;
}

export function normalizePhase(value = 'group') {
  const phase = String(value || 'group').toLowerCase().trim();
  if (['group', 'groups', 'group-stage', 'group_stage', 'fase-grupos', 'fase_de_grupos'].includes(phase)) return 'group';
  if (['knockout', 'knockouts', 'finals', 'eliminatoria', 'eliminatorias', 'after-group', 'after_group'].includes(phase)) return 'knockout';
  if (['all', 'todos', 'general'].includes(phase)) return 'all';
  return 'group';
}

export function getPhaseLabel(phase) {
  const normalized = normalizePhase(phase);
  if (normalized === 'knockout') return 'Knockout phase';
  if (normalized === 'all') return 'All matches';
  return 'Group stage';
}

export function phaseForMatchLike(row = {}) {
  const matchNo = Number(row.match_no ?? row.matchNo);
  const roundLabel = String(row.round_label ?? row.roundLabel ?? '').trim().toUpperCase();
  const stage = String(row.stage ?? '').trim().toUpperCase();

  // The Excel template's match number is the most trustworthy phase marker.
  // Rows 1-72 are group stage; rows 73+ are knockout.
  // This must win over API stage text so a wrongly mapped GROUP_STAGE result
  // cannot make a knockout bet appear as a group-stage bet.
  if (Number.isInteger(matchNo)) {
    if (matchNo >= 1 && matchNo <= GROUP_STAGE_MAX_MATCH_NO) return 'group';
    if (matchNo > GROUP_STAGE_MAX_MATCH_NO) return 'knockout';
  }

  if (/^J[123]$/.test(roundLabel)) return 'group';
  if (stage.includes('GROUP')) return 'group';

  return 'knockout';
}

export function isPhaseMatch(row, phase = 'group') {
  const normalized = normalizePhase(phase);
  if (normalized === 'all') return true;
  return phaseForMatchLike(row) === normalized;
}