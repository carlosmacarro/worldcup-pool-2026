import { getConfig } from './config.mjs';

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

  return payload.matches || [];
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

function convertMatch(match, matchNo, countLiveMatches) {
  const score = pickScore(match);
  const status = match.status || 'UNKNOWN';
  const isFinished = status === 'FINISHED';
  const isLive = ['IN_PLAY', 'LIVE', 'PAUSED'].includes(status);
  const hasScore = Number.isFinite(score.home) && Number.isFinite(score.away);

  return {
    match_no: matchNo,
    api_id: match.id ? String(match.id) : null,
    kickoff: match.utcDate || null,
    status,
    stage: match.stage || null,
    group_name: match.group || null,
    home_team: match.homeTeam?.name || match.homeTeam?.shortName || null,
    away_team: match.awayTeam?.name || match.awayTeam?.shortName || null,
    real_home: hasScore ? score.home : null,
    real_away: hasScore ? score.away : null,
    score_source: score.source,
    is_scorable: hasScore && (isFinished || (countLiveMatches && isLive)),
    updated_at: new Date().toISOString()
  };
}

export function mapFootballDataMatches(apiMatches, { countLiveMatches = false } = {}) {
  const sorted = [...apiMatches].sort((a, b) => {
    const da = new Date(a.utcDate || 0).getTime();
    const db = new Date(b.utcDate || 0).getTime();
    if (da !== db) return da - db;
    return Number(a.id || 0) - Number(b.id || 0);
  });

  // football-data.org does not expose FIFA match numbers directly.
  // By default this maps match #1..#104 by chronological order.
  // If needed, set MATCH_API_ID_OVERRIDES='{"1":"123456"}' in Netlify env vars.
  const overrides = parseOverrides();
  const rowsByMatchNo = new Map();
  const usedApiIds = new Set();

  for (const [matchNoRaw, apiIdRaw] of Object.entries(overrides)) {
    const matchNo = Number(matchNoRaw);
    const apiId = String(apiIdRaw);
    const match = sorted.find((m) => String(m.id) === apiId);
    if (Number.isInteger(matchNo) && match) {
      rowsByMatchNo.set(matchNo, convertMatch(match, matchNo, countLiveMatches));
      usedApiIds.add(apiId);
    }
  }

  let nextMatchNo = 1;
  for (const match of sorted) {
    if (usedApiIds.has(String(match.id))) continue;
    while (rowsByMatchNo.has(nextMatchNo)) nextMatchNo += 1;
    rowsByMatchNo.set(nextMatchNo, convertMatch(match, nextMatchNo, countLiveMatches));
    nextMatchNo += 1;
  }

  return [...rowsByMatchNo.values()].sort((a, b) => a.match_no - b.match_no);
}
