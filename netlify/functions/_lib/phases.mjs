export const GROUP_STAGE_MAX_MATCH_NO = 72;

export function normalizePhase(value = 'group') {
  const phase = String(value || 'group').toLowerCase().trim();
  if (['group', 'groups', 'group-stage', 'group_stage', 'fase-grupos', 'fase_de_grupos'].includes(phase)) return 'group';
  if (['knockout', 'knockouts', 'finals', 'eliminatorias', 'after-group', 'after_group'].includes(phase)) return 'knockout';
  if (['all', 'todos'].includes(phase)) return 'all';
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
  // Rows 1-72 are group stage; rows 73+ are knockout/future-stage bets.
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
