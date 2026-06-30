import { KNOCKOUT_ROUNDS } from './phases.mjs';
import {
  apiMatchId,
  apiHomeTeam,
  apiAwayTeam,
  normalizedStatus,
  pickScore
} from './footballData.mjs';

// football-data.org's World Cup competition exposes knockout matches with a
// `stage` field. These are the stage strings we've seen used across their
// cup competitions; we match generously (includes/startsWith) so small naming
// differences don't break the mapping.
const STAGE_MATCHERS = {
  RO32: (s) => s.includes('LAST_32') || s.includes('ROUND_OF_32') || s.includes('1/16') || s.includes('SIXTEENTH'),
  RO16: (s) => s.includes('LAST_16') || s.includes('ROUND_OF_16') || s.includes('1/8') || s.includes('EIGHTH'),
  QF: (s) => s.includes('QUARTER'),
  SF: (s) => s.includes('SEMI'),
  THIRD_PLACE: (s) => s.includes('THIRD') || s.includes('3RD'),
  FINAL: (s) => s === 'FINAL' || (s.includes('FINAL') && !s.includes('SEMI') && !s.includes('QUARTER'))
};

function stageKeyForApiMatch(match) {
  const stage = String(match?.stage || '').toUpperCase();
  if (!stage) return null;
  for (const round of KNOCKOUT_ROUNDS) {
    const matcher = STAGE_MATCHERS[round.key];
    if (matcher && matcher(stage)) return round.key;
  }
  return null;
}

function sortByDate(matches) {
  return [...matches].sort((a, b) => {
    const da = new Date(a?.utcDate || 0).getTime();
    const db = new Date(b?.utcDate || 0).getTime();
    if (da !== db) return da - db;
    return Number(apiMatchId(a) || 0) - Number(apiMatchId(b) || 0);
  });
}

/**
 * Maps football-data.org knockout matches onto our fixed match_no slots
 * (73-104) purely from the real fixture list - never from any participant's
 * Excel guess of who would advance. Within each round, matches are assigned
 * match numbers in chronological (kickoff) order, which is how the official
 * fixture numbering is laid out.
 */
export function mapKnockoutMatches(apiMatches, { countLiveMatches = false, warnings = [] } = {}) {
  const byRound = new Map(KNOCKOUT_ROUNDS.map((r) => [r.key, []]));

  for (const match of apiMatches || []) {
    const roundKey = stageKeyForApiMatch(match);
    if (!roundKey) continue;
    byRound.get(roundKey).push(match);
  }

  const rows = [];

  for (const round of KNOCKOUT_ROUNDS) {
    const slots = round.to - round.from + 1;
    const matches = sortByDate(byRound.get(round.key) || []);

    if (matches.length && matches.length !== slots) {
      warnings.push({
        message: `Expected ${slots} match(es) in ${round.label} (${round.key}) but the API returned ${matches.length}. Match numbers ${round.from}-${round.to} may be misaligned until this resolves.`
      });
    }

    matches.slice(0, slots).forEach((match, index) => {
      const matchNo = round.from + index;
      const score = pickScore(match);
      const status = normalizedStatus(match);
      const hasScore = Number.isFinite(score.home) && Number.isFinite(score.away);

      const FINAL_STATUSES = new Set(['FINISHED', 'AWARDED', 'AFTER_EXTRA_TIME', 'PENALTY_SHOOTOUT']);
      const LIVE_STATUSES = new Set(['IN_PLAY', 'LIVE', 'PAUSED']);
      const isScorable = hasScore && (FINAL_STATUSES.has(status) || LIVE_STATUSES.has(status) || countLiveMatches);

      rows.push({
        match_no: matchNo,
        api_id: apiMatchId(match),
        kickoff: match?.utcDate || null,
        status,
        stage: round.key,
        group_name: null,
        home_team: apiHomeTeam(match),
        away_team: apiAwayTeam(match),
        real_home: hasScore ? score.home : null,
        real_away: hasScore ? score.away : null,
        score_source: score.source,
        is_scorable: isScorable,
        updated_at: new Date().toISOString()
      });
    });
  }

  return rows;
}