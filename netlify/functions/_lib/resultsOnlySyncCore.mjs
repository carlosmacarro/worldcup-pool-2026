import { getSupabase, fetchAll } from './db.mjs';
import { fetchFootballDataMatches, mapFootballDataMatches } from './footballData.mjs';
import { mapKnockoutMatches } from './knockoutMatches.mjs';
import { getConfig } from './config.mjs';
import { isPhaseMatch } from './phases.mjs';

const CHUNK_SIZE = 500;

function chunkArray(items, size = CHUNK_SIZE) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function upsertChunked(supabase, table, rows, conflictColumns) {
  if (!rows.length) return;
  for (const chunk of chunkArray(rows)) {
    const { error } = await supabase.from(table).upsert(chunk, { onConflict: conflictColumns });
    if (error) throw error;
  }
}

async function insertLog(supabase, source) {
  const { data, error } = await supabase
    .from('sync_logs')
    .insert({ source, ok: false, started_at: new Date().toISOString() })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function updateLog(supabase, id, patch) {
  if (!id) return;
  const { error } = await supabase
    .from('sync_logs')
    .update({ ...patch, finished_at: new Date().toISOString() })
    .eq('id', id);
  if (error) console.error('Failed to update sync log', error);
}

function buildExcelFixturesFromStoredPredictions(predictions) {
  const fixturesByMatchNo = new Map();

  for (const prediction of predictions || []) {
    if (!isPhaseMatch(prediction, 'group')) continue;

    const matchNo = Number(prediction.match_no);
    if (!Number.isInteger(matchNo)) continue;
    if (fixturesByMatchNo.has(matchNo)) continue;

    fixturesByMatchNo.set(matchNo, {
      match_no: matchNo,
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

async function syncMatchesFromFootballData(supabase, excelFixtures, warnings) {
  const cfg = getConfig();
  const apiMatches = await fetchFootballDataMatches();

  const mappedGroupMatches = mapFootballDataMatches(apiMatches, {
    countLiveMatches: cfg.countLiveMatches,
    excelFixtures,
    warnings
  });
  const mappedKnockoutMatches = mapKnockoutMatches(apiMatches, {
    countLiveMatches: cfg.countLiveMatches,
    warnings
  });

  await upsertChunked(supabase, 'matches', mappedGroupMatches, 'match_no');
  await upsertChunked(supabase, 'matches', mappedKnockoutMatches, 'match_no');

  return {
    matchesCount: mappedGroupMatches.length + mappedKnockoutMatches.length,
    apiMatchesCount: apiMatches.length
  };
}

export async function runResultsOnlySync({ source = 'scheduled-results-only' } = {}) {
  const supabase = getSupabase();
  const warnings = [];
  let logId;

  try {
    logId = await insertLog(supabase, source);

    // Lightweight automatic path: no Google Drive listing, no Excel downloads,
    // no workbook parsing. The existing predictions in Supabase define the
    // group-stage fixture rows; knockout fixture rows come straight from the
    // API via mapKnockoutMatches (independent of any Excel guess). This job
    // only refreshes scores/status for both phases.
    const predictions = await fetchAll('predictions', { orderBy: 'match_no' });
    const excelFixtures = buildExcelFixturesFromStoredPredictions(predictions);

    if (!excelFixtures.length) {
      warnings.push({
        message: 'No stored group-stage predictions found. Run a manual full sync from /admin.html after uploading Excels.'
      });
    }

    const matchStats = await syncMatchesFromFootballData(supabase, excelFixtures, warnings);

    const result = {
      ok: true,
      source,
      mode: 'results-only',
      participantsCount: null,
      predictionsCount: predictions.length,
      excelFixturesCount: excelFixtures.length,
      ...matchStats,
      warnings,
      finishedAt: new Date().toISOString()
    };

    await updateLog(supabase, logId, {
      ok: true,
      participants_count: null,
      predictions_count: result.predictionsCount,
      matches_count: result.matchesCount,
      warnings
    });

    return result;
  } catch (error) {
    await updateLog(supabase, logId, {
      ok: false,
      warnings,
      error: error.stack || error.message || String(error)
    });
    throw error;
  }
}