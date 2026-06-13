import { jsonResponse, getRequestUrl, isOptions } from './_lib/http.mjs';
import { getConfig } from './_lib/config.mjs';
import { fetchAll } from './_lib/db.mjs';
import { isPhaseMatch } from './_lib/phases.mjs';
import {
  fetchFootballDataMatches,
  mapFootballDataMatches,
  summarizeApiMatch,
  apiMatchId,
  dateDiffMs,
  pairKey,
  unorderedPairKey
} from './_lib/footballData.mjs';

function providedSecret(req) {
  const url = getRequestUrl(req);
  return req.headers.get('x-admin-secret') || url.searchParams.get('secret') || '';
}

function buildExcelFixturesFromPredictions(predictions) {
  const fixturesByMatchNo = new Map();

  for (const prediction of predictions || []) {
    if (!isPhaseMatch(prediction, 'group')) continue;
    if (fixturesByMatchNo.has(prediction.match_no)) continue;
    fixturesByMatchNo.set(prediction.match_no, {
      match_no: prediction.match_no,
      kickoff: prediction.kickoff,
      round_label: prediction.round_label,
      stage: 'GROUP_STAGE',
      group_name: null,
      home_team: prediction.home_team,
      away_team: prediction.away_team
    });
  }

  return [...fixturesByMatchNo.values()].sort((a, b) => a.match_no - b.match_no);
}

function scoreText(summary) {
  if (!summary?.score) return null;
  if (summary.score.home == null || summary.score.away == null) return null;
  return `${summary.score.home}-${summary.score.away}`;
}

function hoursBetween(match, fixture) {
  const diff = dateDiffMs(match, fixture);
  return diff == null ? null : Math.round((diff / 36_000) / 100) / 100;
}

function relatedApiCandidates(apiMatches, fixture, limit = 5) {
  const ordered = pairKey(fixture.home_team, fixture.away_team);
  const reversed = pairKey(fixture.away_team, fixture.home_team);
  const unordered = unorderedPairKey(fixture.home_team, fixture.away_team);

  return apiMatches
    .map((match) => {
      const s = summarizeApiMatch(match);
      const matchOrdered = pairKey(s.homeTeam, s.awayTeam);
      const matchUnordered = unorderedPairKey(s.homeTeam, s.awayTeam);
      let relation = null;
      if (matchOrdered && ordered && matchOrdered === ordered) relation = 'ordered-team-match';
      else if (matchOrdered && reversed && matchOrdered === reversed) relation = 'reversed-team-match';
      else if (matchUnordered && unordered && matchUnordered === unordered) relation = 'same-two-teams';
      if (!relation) return null;
      return {
        relation,
        dateDiffHours: hoursBetween(match, fixture),
        api: s,
        scoreText: scoreText(s)
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.dateDiffHours ?? Number.MAX_SAFE_INTEGER) - (b.dateDiffHours ?? Number.MAX_SAFE_INTEGER))
    .slice(0, limit);
}

function matchProblems({ fixture, row, apiSummary, apiRaw }) {
  const problems = [];
  const now = Date.now();
  const kickoffMs = new Date(fixture.kickoff || row?.kickoff || '').getTime();
  const kickoffKnown = Number.isFinite(kickoffMs);

  if (kickoffKnown && kickoffMs < now - 3 * 60 * 60 * 1000 && !row?.api_id) {
    problems.push('Excel fixture is past kickoff but has no matched API row, so it will remain pending.');
  }

  if (kickoffKnown && kickoffMs > now + 24 * 60 * 60 * 1000 && row?.api_id && row?.status === 'FINISHED') {
    problems.push('Future Excel fixture is mapped to a FINISHED API row. That is almost certainly a bad mapping.');
  }

  if (row?.api_id && apiRaw && hoursBetween(apiRaw, fixture) != null && hoursBetween(apiRaw, fixture) > Number(process.env.MATCH_DATE_TOLERANCE_HOURS || 48)) {
    problems.push('Matched API row is outside MATCH_DATE_TOLERANCE_HOURS.');
  }

  if (row?.api_id && !apiSummary) {
    problems.push('Match table has an api_id that was not present in the current football-data.org response.');
  }

  if (apiSummary?.status === 'FINISHED' && row?.real_home == null) {
    problems.push('API row is FINISHED but no numeric score was stored. This points to score parsing/API shape.');
  }

  return problems;
}

export default async function handler(req) {
  if (isOptions(req)) return jsonResponse({ ok: true });

  try {
    const cfg = getConfig();
    if (cfg.adminSecret && providedSecret(req) !== cfg.adminSecret) {
      return jsonResponse({ ok: false, error: 'Unauthorized. Check ADMIN_SECRET.' }, { status: 401 });
    }

    const [predictions, storedMatches] = await Promise.all([
      fetchAll('predictions', { orderBy: 'match_no' }),
      fetchAll('matches', { orderBy: 'match_no' })
    ]);

    const fixtures = buildExcelFixturesFromPredictions(predictions);
    const apiMatches = await fetchFootballDataMatches();
    const warnings = [];
    const mappedMatches = mapFootballDataMatches(apiMatches, {
      countLiveMatches: cfg.countLiveMatches,
      excelFixtures: fixtures,
      warnings
    });

    const apiById = new Map(apiMatches.map((match) => [apiMatchId(match), match]).filter(([id]) => id));
    const storedByMatchNo = new Map(storedMatches.map((match) => [Number(match.match_no), match]));
    const mappedByMatchNo = new Map(mappedMatches.map((match) => [Number(match.match_no), match]));

    const rows = fixtures.map((fixture) => {
      const stored = storedByMatchNo.get(Number(fixture.match_no)) || null;
      const mapped = mappedByMatchNo.get(Number(fixture.match_no)) || null;
      const mappedApiRaw = mapped?.api_id ? apiById.get(String(mapped.api_id)) : null;
      const mappedApiSummary = mappedApiRaw ? summarizeApiMatch(mappedApiRaw) : null;
      const storedApiRaw = stored?.api_id ? apiById.get(String(stored.api_id)) : null;
      const storedApiSummary = storedApiRaw ? summarizeApiMatch(storedApiRaw) : null;

      return {
        matchNo: fixture.match_no,
        excel: {
          kickoff: fixture.kickoff,
          roundLabel: fixture.round_label,
          homeTeam: fixture.home_team,
          awayTeam: fixture.away_team
        },
        currentStoredInSupabase: stored ? {
          apiId: stored.api_id,
          kickoff: stored.kickoff,
          status: stored.status,
          homeTeam: stored.home_team,
          awayTeam: stored.away_team,
          score: { home: stored.real_home, away: stored.real_away, source: stored.score_source },
          isScorable: stored.is_scorable,
          api: storedApiSummary,
          dateDiffHours: storedApiRaw ? hoursBetween(storedApiRaw, fixture) : null
        } : null,
        wouldMapNow: mapped ? {
          apiId: mapped.api_id,
          kickoff: mapped.kickoff,
          status: mapped.status,
          homeTeam: mapped.home_team,
          awayTeam: mapped.away_team,
          score: { home: mapped.real_home, away: mapped.real_away, source: mapped.score_source },
          isScorable: mapped.is_scorable,
          api: mappedApiSummary,
          dateDiffHours: mappedApiRaw ? hoursBetween(mappedApiRaw, fixture) : null
        } : null,
        relatedApiCandidates: relatedApiCandidates(apiMatches, fixture),
        problems: matchProblems({ fixture, row: mapped, apiSummary: mappedApiSummary, apiRaw: mappedApiRaw })
      };
    });

    const staleKnockoutMatchRows = storedMatches
      .filter((match) => Number(match.match_no) > 72 && match.api_id)
      .map((match) => ({
        matchNo: match.match_no,
        apiId: match.api_id,
        status: match.status,
        homeTeam: match.home_team,
        awayTeam: match.away_team,
        score: { home: match.real_home, away: match.real_away },
        stage: match.stage
      }));

    return jsonResponse({
      ok: true,
      generatedAt: new Date().toISOString(),
      config: {
        footballCompetitionCode: cfg.footballCompetitionCode,
        footballSeason: cfg.footballSeason,
        excelTimeZone: cfg.excelTimeZone,
        matchDateToleranceHours: cfg.matchDateToleranceHours || Number(process.env.MATCH_DATE_TOLERANCE_HOURS || 48),
        countLiveMatches: cfg.countLiveMatches
      },
      counts: {
        predictions: predictions.length,
        excelGroupFixtures: fixtures.length,
        apiMatches: apiMatches.length,
        storedMatches: storedMatches.length,
        mappedMatches: mappedMatches.length,
        staleKnockoutMatchRows: staleKnockoutMatchRows.length
      },
      warnings,
      staleKnockoutMatchRows,
      problemRows: rows.filter((row) => row.problems.length),
      rows
    });
  } catch (error) {
    console.error(error);
    return jsonResponse({ ok: false, error: error.stack || error.message || String(error) }, { status: 500 });
  }
}
