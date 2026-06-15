import { getSupabase, fetchAll } from './db.mjs';
import { fetchFootballDataMatches, mapFootballDataMatches } from './footballData.mjs';
import { getConfig } from './config.mjs';
import { GROUP_STAGE_MAX_MATCH_NO, isPhaseMatch } from './phases.mjs';

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
  const mappedMatches = mapFootballDataMatches(apiMatches, {
    countLiveMatches: cfg.countLiveMatches,
    excelFixtures,
    warnings
  });

  await upsertChunked(supabase, 'matches', mappedMatches, 'match_no');

  // Keep automatic sync group-stage only. Never allow API rows to populate
  // knockout placeholders/bets from the Excel template.
  const { error: cleanupError } = await supabase
    .from('matches')
    .delete()
    .gt('match_no', GROUP_STAGE_MAX_MATCH_NO);
  if (cleanupError) throw cleanupError;

  return { matchesCount: mappedMatches.length, apiMatchesCount: apiMatches.length };
}

export async function runResultsOnlySync({ source = 'scheduled-results-only' } = {}) {
  const supabase = getSupabase();
  const warnings = [];
  let logId;

  try {
    logId = await insertLog(supabase, source);

    // Lightweight automatic path: no Google Drive listing, no Excel downloads,
    // no workbook parsing. The existing predictions in Supabase define the
    // fixture rows, and this job only refreshes API results/scores.
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
