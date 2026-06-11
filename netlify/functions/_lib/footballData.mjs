import { getConfig } from './config.mjs';
import { normaliseTeam } from './normalise.mjs';

function scoreValue(scoreObj, key) {
  if (!scoreObj) return null;
  const value = scoreObj[key] ?? scoreObj[`${key}Team`];
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function pickScore(match) {
  const candidates = [
    match?.score?.fullTime,
    match?.score?.regularTime,
    match?.score?.current,
    match?.score?.halfTime
  ];

  for (const candidate of candidates) {
    const home = scoreValue(candidate, 'home');
    const away = scoreValue(candidate, 'away');
    if (Number.isFinite(home) && Number.isFinite(away)) {
      return { home, away, source: candidate === match?.score?.fullTime ? 'fullTime' : 'liveOrPartial' };
    }
  }

  return { home: null, away: null, source: null };
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

  // The normal football-data.org shape is { matches: [...] }, but keep this defensive so
  // an unexpected placeholder/error shape cannot crash the importer later.
  return Array.isArray(payload?.matches) ? payload.matches.filter(Boolean) : [];
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

function apiMatchId(match) {
  return match?.id == null ? null : String(match.id);
}

function apiTeamName(team) {
  if (!team) return null;
  if (typeof team === 'string') return team;
  return team.name || team.shortName || team.tla || null;
}

function apiHomeTeam(match) {
  // football-data.org can return placeholder rows or unexpected objects while fixtures are still being finalized.
  // Keep the sync running if a row is missing homeTeam.
  return apiTeamName(match?.homeTeam);
}

function apiAwayTeam(match) {
  // football-data.org can return placeholder rows or unexpected objects while fixtures are still being finalized.
  // Keep the sync running if a row is missing awayTeam.
  return apiTeamName(match?.awayTeam);
}

function pairKey(homeTeam, awayTeam) {
  const home = normaliseTeam(homeTeam);
  const away = normaliseTeam(awayTeam);
  if (!home || !away) return null;
  return `${home}__${away}`;
}

function unorderedPairKey(homeTeam, awayTeam) {
  const teams = [normaliseTeam(homeTeam), normaliseTeam(awayTeam)].filter(Boolean).sort();
  if (teams.length !== 2) return null;
  return teams.join('__');
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
  const status = match.status || 'UNKNOWN';
  const isFinished = status === 'FINISHED';
  const isLive = ['IN_PLAY', 'LIVE', 'PAUSED'].includes(status);
  const hasScore = Number.isFinite(score.home) && Number.isFinite(score.away);
  const shouldFlip = flip || inferFlip(match, fixture);

  return {
    match_no: matchNo,
    api_id: apiMatchId(match),
    kickoff: match.utcDate || fixture?.kickoff || null,
    status,
    stage: match.stage || fixture?.stage || null,
    group_name: match.group || fixture?.group_name || null,
    // Store teams in the same home/away orientation as the Excel template.
    // This is important because predictions are also stored in Excel orientation.
    home_team: fixture?.home_team || (shouldFlip ? apiAwayTeam(match) : apiHomeTeam(match)),
    away_team: fixture?.away_team || (shouldFlip ? apiHomeTeam(match) : apiAwayTeam(match)),
    real_home: hasScore ? (shouldFlip ? score.away : score.home) : null,
    real_away: hasScore ? (shouldFlip ? score.home : score.away) : null,
    score_source: score.source,
    is_scorable: hasScore && (isFinished || (countLiveMatches && isLive)),
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

function findUnusedCandidate(candidates = [], usedApiIds) {
  return (candidates || []).find((match) => {
    const id = apiMatchId(match);
    return id && !usedApiIds.has(id);
  });
}

function sortMatchesChronologically(apiMatches) {
  return [...(Array.isArray(apiMatches) ? apiMatches : [])].filter(Boolean).sort((a, b) => {
    const da = new Date(a?.utcDate || 0).getTime();
    const db = new Date(b?.utcDate || 0).getTime();
    if (da !== db) return da - db;
    return Number(apiMatchId(a) || 0) - Number(apiMatchId(b) || 0);
  });
}

export function mapFootballDataMatches(apiMatches, { countLiveMatches = false, excelFixtures = [] } = {}) {
  const sorted = sortMatchesChronologically(apiMatches);
  const fixtures = [...excelFixtures]
    .filter((fixture) => Number.isInteger(Number(fixture.match_no)) && fixture.home_team && fixture.away_team)
    .map((fixture) => ({ ...fixture, match_no: Number(fixture.match_no) }))
    .sort((a, b) => a.match_no - b.match_no);

  const rowsByMatchNo = new Map();
  const usedApiIds = new Set();
  const apiIndexes = buildApiIndexes(sorted);

  // Reserve Excel group-stage fixtures before doing any fallback chronological mapping.
  // If an API match cannot be matched, the row remains pending instead of being incorrectly scored.
  for (const fixture of fixtures) {
    rowsByMatchNo.set(fixture.match_no, convertFixtureOnly(fixture));
  }

  // Optional exact overrides still win, but the resulting row is aligned to Excel teams.
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

  // Map group-stage API results by home/away team names, not by row/date order.
  // The Excel template match numbers are not strictly chronological, so chronological mapping can shift results.
  for (const fixture of fixtures) {
    if (rowsByMatchNo.get(fixture.match_no)?.api_id) continue;

    const ordered = pairKey(fixture.home_team, fixture.away_team);
    const reversed = pairKey(fixture.away_team, fixture.home_team);
    const unordered = unorderedPairKey(fixture.home_team, fixture.away_team);

    let match = findUnusedCandidate(apiIndexes.byOrderedPair.get(ordered), usedApiIds);
    let flip = false;

    if (!match) {
      match = findUnusedCandidate(apiIndexes.byOrderedPair.get(reversed), usedApiIds);
      flip = Boolean(match);
    }

    if (!match) {
      match = findUnusedCandidate(apiIndexes.byUnorderedPair.get(unordered), usedApiIds);
      flip = match ? inferFlip(match, fixture) : false;
    }

    if (!match) continue;
    rowsByMatchNo.set(fixture.match_no, convertMatch(match, fixture.match_no, countLiveMatches, { fixture, flip }));
    {
      const matchedId = apiMatchId(match);
      if (matchedId) usedApiIds.add(matchedId);
    }
  }

  // Keep the remaining API matches, mostly knockout matches. Start after the reserved Excel fixtures.
  // This avoids dropping a leftover API row into a group-stage match number and corrupting group scoring.
  let nextMatchNo = Math.max(0, ...fixtures.map((fixture) => fixture.match_no)) + 1;
  for (const match of sorted) {
    const matchId = apiMatchId(match);
    if (!matchId || usedApiIds.has(matchId)) continue;
    while (rowsByMatchNo.has(nextMatchNo)) nextMatchNo += 1;
    rowsByMatchNo.set(nextMatchNo, convertMatch(match, nextMatchNo, countLiveMatches));
    nextMatchNo += 1;
  }

  return [...rowsByMatchNo.values()].sort((a, b) => a.match_no - b.match_no);
}
