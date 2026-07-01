import { getConfig } from './config.mjs';
import { normaliseTeam } from './normalise.mjs';

const DEFAULT_MATCH_DATE_TOLERANCE_HOURS = 48;

function scoreValue(scoreObj, key) {
  if (!scoreObj) return null;
  const value = scoreObj[key] ?? scoreObj[`${key}Team`];
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

export function pickScore(match) {
  //const status = normalizedStatus(match);
  //const homeRT = scoreValue(match?.score?.regularTime, 'home');
  //const awayRT = scoreValue(match?.score?.regularTime, 'away');

  //const homeET = scoreValue(match?.score?.extraTime, 'home');
  //const awayET = scoreValue(match?.score?.extraTime, 'away');

  //const isFinished =
    //status === "FINISHED" ||
    //status === "FT" ||
    //status === "AET"; // some APIs use "after extra time"

  //const isLive =
    //status === "LIVE" ||
    //status === "IN_PLAY" ||
    //status === "PAUSED";

  //if (isLive) {
    // during live match: fullTime is actually the current score
      const candidates = [
      { value: match?.score?.fullTime, source: 'fullTime' },
      { value: match?.score?.regularTime, source: 'regularTime' },
      { value: match?.score?.current, source: 'liveOrPartial' },
      { value: match?.score?.halfTime, source: 'halfTime' }
    ];
    const homeP = scoreValue(match?.score?.penalties, 'home');
    const awayP = scoreValue(match?.score?.penalties, 'away');
    for (const candidate of candidates) {
      const home = scoreValue(candidate.value, 'home');
      const away = scoreValue(candidate.value, 'away');
      if (Number.isFinite(home) && Number.isFinite(away)) {
        if (Number.isFinite(homeP) && Number.isFinite(awayP)) {
          return {
            home: home - homeP,
            away: away - awayP,
            source: candidate.source };
        }
        return { home, away, source: candidate.source };
      }
    }
  //}
  
  //if (isFinished) {
    // final result includes extra time but excludes penalties
    //return {
      //home: homeRT + homeET,
      //away: awayRT + awayET,
      //source: "regular_with_extra_time"
    //};
  //}

  return { home: null, away: null, source: null };
}

const LIVE_STATUSES = new Set(['IN_PLAY', 'LIVE', 'PAUSED']);
const FINISHED_STATUSES = new Set(['FINISHED', 'AWARDED', 'AFTER_EXTRA_TIME', 'PENALTY_SHOOTOUT']);
const NOT_SCORABLE_STATUSES = new Set(['SCHEDULED', 'TIMED', 'POSTPONED', 'CANCELLED', 'CANCELED', 'SUSPENDED']);

export function normalizedStatus(match) {
  return String(match?.status || 'UNKNOWN').toUpperCase();
}

function isLiveStatus(status) {
  return LIVE_STATUSES.has(status);
}

function isFinishedStatus(status) {
  return FINISHED_STATUSES.has(status);
}

function isClearlyNotScorableStatus(status) {
  return NOT_SCORABLE_STATUSES.has(status);
}

function isMatchScorable({ status, scoreSource, hasScore, countLiveMatches }) {
  if (!hasScore) return false;
  if (isFinishedStatus(status)) return true;

  // The pool can show live/provisional points. If the API has a numeric
  // score for a live match, score it immediately.
  if (isLiveStatus(status)) return true;

  // Keep the old environment switch as an extra safety net for providers that
  // use non-standard live statuses but still expose a current score.
  if (countLiveMatches && !isClearlyNotScorableStatus(status)) return true;

  // Some data providers briefly return a final full-time score before the status
  // is normalized to FINISHED. Treat it as final unless the status clearly means
  // the match has not been played or was postponed/cancelled.
  if ((scoreSource === 'fullTime' || scoreSource === 'regularTime') && !isClearlyNotScorableStatus(status)) {
    return true;
  }

  return false;
}

export async function fetchFootballDataMatches() {
  const cfg = getConfig();
  const endpoint = new URL(`https://api.football-data.org/v4/competitions/${cfg.footballCompetitionCode}/matches`);
  endpoint.searchParams.set('season', cfg.footballSeason);

  const response = await fetch(endpoint, {
    headers: { 'X-Auth-Token': cfg.footballDataToken }
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const message = payload?.message || payload?.error || text || `HTTP ${response.status}`;
    throw new Error(`football-data.org request failed: ${message}`);
  }

  // The normal football-data.org shape is { matches: [...] }, but keep this
  // defensive so an unexpected placeholder/error shape cannot crash the importer.
  return Array.isArray(payload?.matches) ? payload.matches.filter(Boolean) : [];
}

function normalizeStandingGroupName(group) {
  const raw = String(group || '').toUpperCase().trim();
  const match = raw.match(/GROUP[_-]?([A-Z0-9]+)/);
  if (match) return match[1];
  return raw.replace(/^GROUP[_-]?/, '') || null;
}

export async function fetchFootballDataStandings() {
  const cfg = getConfig();
  const endpoint = new URL(`https://api.football-data.org/v4/competitions/${cfg.footballCompetitionCode}/standings`);
  endpoint.searchParams.set('season', cfg.footballSeason);

  const response = await fetch(endpoint, {
    headers: { 'X-Auth-Token': cfg.footballDataToken }
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const message = payload?.message || payload?.error || text || `HTTP ${response.status}`;
    throw new Error(`football-data.org standings request failed: ${message}`);
  }

  const rows = [];
  for (const standing of payload?.standings || []) {
    const groupName = normalizeStandingGroupName(standing?.group);
    if (!groupName || !Array.isArray(standing?.table)) continue;

    for (const row of standing.table) {
      const position = Number(row?.position);
      const team = row?.team?.name || row?.team?.shortName || row?.team?.tla || null;
      if (!Number.isInteger(position) || !team) continue;
      rows.push({
        group_name: groupName,
        position,
        team,
        updated_at: new Date().toISOString()
      });
    }
  }

  return rows;
}

function parseOverrides() {
  if (!process.env.MATCH_API_ID_OVERRIDES) return {};
  try {
    return JSON.parse(process.env.MATCH_API_ID_OVERRIDES);
  } catch (error) {
    console.warn('MATCH_API_ID_OVERRIDES is not valid JSON. Ignoring it.', error);
    return {};
  }
}

function matchDateToleranceMs() {
  const hours = Number(process.env.MATCH_DATE_TOLERANCE_HOURS || DEFAULT_MATCH_DATE_TOLERANCE_HOURS);
  const safeHours = Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_MATCH_DATE_TOLERANCE_HOURS;
  return safeHours * 60 * 60 * 1000;
}

export function apiMatchId(match) {
  return match?.id == null ? null : String(match.id);
}

function apiTeamName(team) {
  if (!team) return null;
  if (typeof team === 'string') return team;
  return team.name || team.shortName || team.tla || null;
}

export function apiHomeTeam(match) {
  return apiTeamName(match?.homeTeam);
}

export function apiAwayTeam(match) {
  return apiTeamName(match?.awayTeam);
}

function apiStage(match) {
  return String(match?.stage || '').toUpperCase();
}

export function apiUtcTime(match) {
  const t = new Date(match?.utcDate || '').getTime();
  return Number.isFinite(t) ? t : null;
}

export function fixtureUtcTime(fixture) {
  const t = new Date(fixture?.kickoff || '').getTime();
  return Number.isFinite(t) ? t : null;
}

export function dateDiffMs(match, fixture) {
  const apiTime = apiUtcTime(match);
  const fixtureTime = fixtureUtcTime(fixture);
  if (apiTime == null || fixtureTime == null) return null;
  return Math.abs(apiTime - fixtureTime);
}

function datesAreCompatible(match, fixture) {
  const diff = dateDiffMs(match, fixture);
  if (diff == null) return true;
  return diff <= matchDateToleranceMs();
}

function stageIsCompatible(match, fixture) {
  const fixtureStage = String(fixture?.stage || '').toUpperCase();
  const stage = apiStage(match);

  // If football-data.org says this is not a group-stage match, never attach it
  // to an Excel group-stage row. This prevents future knockout rows/results
  // from contaminating group fixtures.
  if (fixtureStage.includes('GROUP') && stage && !stage.includes('GROUP')) return false;

  return true;
}

export function pairKey(homeTeam, awayTeam) {
  const home = normaliseTeam(homeTeam);
  const away = normaliseTeam(awayTeam);
  if (!home || !away) return null;
  return `${home}__${away}`;
}

export function unorderedPairKey(homeTeam, awayTeam) {
  const teams = [normaliseTeam(homeTeam), normaliseTeam(awayTeam)].filter(Boolean).sort();
  if (teams.length !== 2) return null;
  return teams.join('__');
}

function fixtureLabel(fixture) {
  return `#${fixture?.match_no ?? '?'} ${fixture?.home_team || '?'} vs ${fixture?.away_team || '?'}`;
}

function apiMatchLabel(match) {
  const status = normalizedStatus(match);
  const score = pickScore(match);
  const scoreText = Number.isFinite(score.home) && Number.isFinite(score.away) ? ` ${score.home}-${score.away}` : '';
  return `${apiHomeTeam(match) || '?'} vs ${apiAwayTeam(match) || '?'}${scoreText} (${status}, ${match?.utcDate || 'no date'}, api_id=${apiMatchId(match) || 'none'})`;
}

function inferFlip(match, fixture) {
  if (!fixture) return false;
  const apiKey = pairKey(apiHomeTeam(match), apiAwayTeam(match));
  const fixtureKey = pairKey(fixture.home_team, fixture.away_team);
  const reversedFixtureKey = pairKey(fixture.away_team, fixture.home_team);

  if (apiKey && reversedFixtureKey && apiKey === reversedFixtureKey) return true;
  if (apiKey && fixtureKey && apiKey === fixtureKey) return false;

  return false;
}

function convertMatch(match, matchNo, countLiveMatches, { fixture = null, flip = false } = {}) {
  const score = pickScore(match);
  const status = normalizedStatus(match);
  const hasScore = Number.isFinite(score.home) && Number.isFinite(score.away);
  const shouldFlip = flip || inferFlip(match, fixture);

  return {
    match_no: matchNo,
    api_id: apiMatchId(match),
    kickoff: match?.utcDate || fixture?.kickoff || null,
    status,
    stage: match?.stage || fixture?.stage || null,
    group_name: match?.group || fixture?.group_name || null,

    // Store teams in the same home/away orientation as the Excel template.
    // This is important because predictions are also stored in Excel orientation.
    home_team: fixture?.home_team || (shouldFlip ? apiAwayTeam(match) : apiHomeTeam(match)),
    away_team: fixture?.away_team || (shouldFlip ? apiHomeTeam(match) : apiAwayTeam(match)),
    real_home: hasScore ? (shouldFlip ? score.away : score.home) : null,
    real_away: hasScore ? (shouldFlip ? score.home : score.away) : null,
    score_source: score.source,
    is_scorable: isMatchScorable({ status, scoreSource: score.source, hasScore, countLiveMatches }),
    updated_at: new Date().toISOString()
  };
}

function convertFixtureOnly(fixture) {
  return {
    match_no: fixture.match_no,
    api_id: null,
    kickoff: fixture.kickoff || null,
    status: 'SCHEDULED',
    stage: fixture.stage || 'GROUP_STAGE',
    group_name: fixture.group_name || null,
    home_team: fixture.home_team,
    away_team: fixture.away_team,
    real_home: null,
    real_away: null,
    score_source: null,
    is_scorable: false,
    updated_at: new Date().toISOString()
  };
}

function buildApiIndexes(apiMatches) {
  const byOrderedPair = new Map();
  const byUnorderedPair = new Map();

  for (const match of apiMatches) {
    const ordered = pairKey(apiHomeTeam(match), apiAwayTeam(match));
    const unordered = unorderedPairKey(apiHomeTeam(match), apiAwayTeam(match));

    if (ordered) {
      if (!byOrderedPair.has(ordered)) byOrderedPair.set(ordered, []);
      byOrderedPair.get(ordered).push(match);
    }

    if (unordered) {
      if (!byUnorderedPair.has(unordered)) byUnorderedPair.set(unordered, []);
      byUnorderedPair.get(unordered).push(match);
    }
  }

  return { byOrderedPair, byUnorderedPair };
}

function candidatesForFixture(candidates = [], fixture, usedApiIds) {
  return (candidates || [])
    .filter((match) => {
      const id = apiMatchId(match);
      if (!id || usedApiIds.has(id)) return false;
      if (!stageIsCompatible(match, fixture)) return false;
      if (!datesAreCompatible(match, fixture)) return false;
      return true;
    })
    .sort((a, b) => {
      const da = dateDiffMs(a, fixture) ?? Number.MAX_SAFE_INTEGER;
      const db = dateDiffMs(b, fixture) ?? Number.MAX_SAFE_INTEGER;
      if (da !== db) return da - db;
      return Number(apiMatchId(a) || 0) - Number(apiMatchId(b) || 0);
    });
}

function findBestCandidate(candidates = [], fixture, usedApiIds) {
  const compatible = candidatesForFixture(candidates, fixture, usedApiIds);
  if (!compatible.length) return null;

  // If the fixture has no date and the same pair appears more than once in the API,
  // do not guess. A wrong guess is worse than leaving the row pending and showing a warning.
  if (fixtureUtcTime(fixture) == null && compatible.length > 1) return null;

  return compatible[0];
}

function sortMatchesChronologically(apiMatches) {
  return [...(Array.isArray(apiMatches) ? apiMatches : [])]
    .filter(Boolean)
    .sort((a, b) => {
      const da = new Date(a?.utcDate || 0).getTime();
      const db = new Date(b?.utcDate || 0).getTime();
      if (da !== db) return da - db;
      return Number(apiMatchId(a) || 0) - Number(apiMatchId(b) || 0);
    });
}

function isGroupApiMatch(match) {
  const stage = apiStage(match);
  return !stage || stage.includes('GROUP');
}

function isImportantUnmatchedApiMatch(match) {
  const status = normalizedStatus(match);
  const score = pickScore(match);
  const hasScore = Number.isFinite(score.home) && Number.isFinite(score.away);
  return isGroupApiMatch(match) && (isFinishedStatus(status) || isLiveStatus(status) || hasScore);
}

function addUnmatchedDiagnostics({ warnings, fixtures, sorted, usedApiIds }) {
  if (!Array.isArray(warnings)) return;

  const unmatchedScoredApiMatches = sorted
    .filter((match) => {
      const id = apiMatchId(match);
      return id && !usedApiIds.has(id) && isImportantUnmatchedApiMatch(match);
    })
    .slice(0, 12);

  for (const match of unmatchedScoredApiMatches) {
    warnings.push({
      message: `API match not matched to any Excel group fixture: ${apiMatchLabel(match)}. Check team aliases/date or add MATCH_API_ID_OVERRIDES.`
    });
  }

  const now = Date.now();
  const possiblyMissedExcelFixtures = fixtures
    .filter((fixture) => {
      const kickoff = fixtureUtcTime(fixture);
      if (kickoff == null) return false;
      // If the Excel fixture started more than 3 hours ago and it still has no API ID,
      // surface it as a warning. This helps catch team-name alias issues quickly.
      return kickoff < now - 3 * 60 * 60 * 1000;
    })
    .slice(0, 12);

  for (const fixture of possiblyMissedExcelFixtures) {
    warnings.push({
      matchNo: fixture.match_no,
      message: `Excel fixture is past kickoff but has no matched API result yet: ${fixtureLabel(fixture)} (${fixture.kickoff || 'no date'}).`
    });
  }
}


export function summarizeApiMatch(match) {
  const score = pickScore(match);
  return {
    apiId: apiMatchId(match),
    utcDate: match?.utcDate || null,
    status: normalizedStatus(match),
    stage: match?.stage || null,
    group: match?.group || null,
    homeTeam: apiHomeTeam(match),
    awayTeam: apiAwayTeam(match),
    normalizedHomeTeam: normaliseTeam(apiHomeTeam(match)),
    normalizedAwayTeam: normaliseTeam(apiAwayTeam(match)),
    score: {
      home: Number.isFinite(score.home) ? score.home : null,
      away: Number.isFinite(score.away) ? score.away : null,
      source: score.source
    }
  };
}

export function mapFootballDataMatches(apiMatches, { countLiveMatches = false, excelFixtures = [], warnings = [] } = {}) {
  const sorted = sortMatchesChronologically(apiMatches);
  const fixtures = [...excelFixtures]
    .filter((fixture) => Number.isInteger(Number(fixture.match_no)) && fixture.home_team && fixture.away_team)
    .map((fixture) => ({ ...fixture, match_no: Number(fixture.match_no) }))
    .sort((a, b) => a.match_no - b.match_no);

  const rowsByMatchNo = new Map();
  const usedApiIds = new Set();
  const apiIndexes = buildApiIndexes(sorted);

  // Reserve Excel group-stage fixtures before doing any fallback mapping.
  // If an API match cannot be matched safely, the row remains pending instead
  // of receiving another match's score.
  for (const fixture of fixtures) {
    rowsByMatchNo.set(fixture.match_no, convertFixtureOnly(fixture));
  }

  // Optional exact overrides still win. Use this for any stubborn API/Excel fixture
  // mismatch. Example Netlify env var:
  // MATCH_API_ID_OVERRIDES={"1":"123456","2":"123457"}
  const overrides = parseOverrides();
  for (const [matchNoRaw, apiIdRaw] of Object.entries(overrides)) {
    const matchNo = Number(matchNoRaw);
    const apiId = String(apiIdRaw);
    const match = sorted.find((m) => apiMatchId(m) === apiId);
    if (!Number.isInteger(matchNo) || !match) continue;

    const fixture = fixtures.find((item) => item.match_no === matchNo) || null;
    rowsByMatchNo.set(matchNo, convertMatch(match, matchNo, countLiveMatches, { fixture }));
    usedApiIds.add(apiId);
  }

  // Map group-stage API results by team names AND fixture date.
  // The date guard prevents a finished result from being attached to a future
  // Excel row that happens to involve the same/ambiguous teams.
  for (const fixture of fixtures) {
    if (rowsByMatchNo.get(fixture.match_no)?.api_id) continue;

    const ordered = pairKey(fixture.home_team, fixture.away_team);
    const reversed = pairKey(fixture.away_team, fixture.home_team);
    const unordered = unorderedPairKey(fixture.home_team, fixture.away_team);

    let match = findBestCandidate(apiIndexes.byOrderedPair.get(ordered), fixture, usedApiIds);
    let flip = false;

    if (!match) {
      match = findBestCandidate(apiIndexes.byOrderedPair.get(reversed), fixture, usedApiIds);
      flip = Boolean(match);
    }

    if (!match) {
      match = findBestCandidate(apiIndexes.byUnorderedPair.get(unordered), fixture, usedApiIds);
      flip = match ? inferFlip(match, fixture) : false;
    }

    if (!match) continue;

    rowsByMatchNo.set(fixture.match_no, convertMatch(match, fixture.match_no, countLiveMatches, { fixture, flip }));
    const matchedId = apiMatchId(match);
    if (matchedId) usedApiIds.add(matchedId);
  }

  addUnmatchedDiagnostics({ warnings, fixtures: [...rowsByMatchNo.values()].filter((r) => !r.api_id), sorted, usedApiIds });

  // IMPORTANT: do not append unmatched API matches to invented Excel match numbers.
  // The workbook already has its own knockout rows (73+), but those rows contain
  // users' future knockout predictions/placeholders, not reliable fixture IDs.
  // If we put an unmatched group/API result into match_no 73+, the participant
  // knockout pages and sometimes the leaderboard can show a real result beside
  // the wrong bet. Unmatched API rows are reported in warnings instead and the
  // matching can be fixed with aliases or MATCH_API_ID_OVERRIDES.

  return [...rowsByMatchNo.values()].sort((a, b) => a.match_no - b.match_no);
}
