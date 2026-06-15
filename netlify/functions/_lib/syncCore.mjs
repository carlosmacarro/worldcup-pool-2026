import { getSupabase } from './db.mjs';
import { listExcelFilesInDriveFolder, downloadDriveFileBuffer } from './googleDrive.mjs';
import { parsePredictionsFromExcelBuffer } from './xlsxParser.mjs';
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

function disambiguateParticipantKeys(parsedFiles, warnings) {
  const counts = new Map();
  for (const item of parsedFiles) {
    const key = item.participant.participant_key;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  for (const item of parsedFiles) {
    const originalKey = item.participant.participant_key;
    if ((counts.get(originalKey) || 0) <= 1) continue;

    const suffix = String(item.participant.file_id || item.participant.file_name || Math.random().toString(36).slice(2))
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 8)
      .toLowerCase();
    const uniqueKey = `${originalKey}-${suffix}`;
    item.participant.participant_key = uniqueKey;
    item.predictions = item.predictions.map((prediction) => ({ ...prediction, participant_key: uniqueKey }));
    warnings.push({ file: item.participant.file_name, message: `Duplicate participant name. Key changed from '${originalKey}' to '${uniqueKey}'.` });
  }
}


function buildExcelFixturesFromParsedFiles(parsedFiles) {
  const fixturesByMatchNo = new Map();

  for (const parsed of parsedFiles) {
    for (const prediction of parsed.predictions || []) {
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
  }

  return [...fixturesByMatchNo.values()].sort((a, b) => a.match_no - b.match_no);
}

async function syncPredictionsFromDrive(supabase, warnings) {
  const files = await listExcelFilesInDriveFolder();
  if (!files.length) warnings.push({ message: 'No Excel files found in Google Drive folder.' });

  const parsedFiles = [];

  for (const file of files) {
    try {
      const buffer = await downloadDriveFileBuffer(file.id);
      const parsed = parsePredictionsFromExcelBuffer(buffer, file);
      warnings.push(...parsed.warnings);
      parsedFiles.push(parsed);
    } catch (error) {
      warnings.push({ file: file.name, message: error.message || String(error) });
    }
  }

  disambiguateParticipantKeys(parsedFiles, warnings);

  const participants = parsedFiles.map((p) => p.participant);
  const currentKeys = new Set(participants.map((p) => p.participant_key));

  if (participants.length) {
    await upsertChunked(supabase, 'participants', participants, 'participant_key');

    // Remove people who were deleted from the Drive folder.
    const { data: existing, error } = await supabase.from('participants').select('participant_key');
    if (error) throw error;
    const staleKeys = (existing || []).map((p) => p.participant_key).filter((key) => !currentKeys.has(key));
    if (staleKeys.length) {
      const { error: deleteError } = await supabase.from('participants').delete().in('participant_key', staleKeys);
      if (deleteError) throw deleteError;
    }

    // Replace predictions per participant so removed/blanked predictions do not remain in the database.
    for (const parsed of parsedFiles) {
      const { error: deleteError } = await supabase
        .from('predictions')
        .delete()
        .eq('participant_key', parsed.participant.participant_key);
      if (deleteError) throw deleteError;
      await upsertChunked(supabase, 'predictions', parsed.predictions, 'participant_key,match_no');
    }
  }

  return {
    participantsCount: participants.length,
    predictionsCount: parsedFiles.reduce((sum, p) => sum + p.predictions.length, 0),
    excelFixtures: buildExcelFixturesFromParsedFiles(parsedFiles)
  };
}

async function syncMatchesFromFootballData(supabase, excelFixtures = [], warnings = []) {
  const cfg = getConfig();
  const apiMatches = await fetchFootballDataMatches();
  const mappedMatches = mapFootballDataMatches(apiMatches, {
    countLiveMatches: cfg.countLiveMatches,
    excelFixtures,
    warnings
  });
  await upsertChunked(supabase, 'matches', mappedMatches, 'match_no');

  // The public leaderboard is currently group-stage only. Older versions could
  // create rows 73+ by appending unmatched API matches, which made real results
  // appear beside knockout bets. Remove those stale rows on every sync.
  const { error: cleanupError } = await supabase
    .from('matches')
    .delete()
    .gt('match_no', GROUP_STAGE_MAX_MATCH_NO);
  if (cleanupError) throw cleanupError;

  return { matchesCount: mappedMatches.length };
}

export async function runSync({ source = 'manual' } = {}) {
  const supabase = getSupabase();
  const warnings = [];
  let logId;

  try {
    logId = await insertLog(supabase, source);
    const predictionStats = await syncPredictionsFromDrive(supabase, warnings);
    const matchStats = await syncMatchesFromFootballData(supabase, predictionStats.excelFixtures || [], warnings);
    const { excelFixtures, ...publicPredictionStats } = predictionStats;

    const result = {
      ok: true,
      source,
      ...publicPredictionStats,
      ...matchStats,
      warnings,
      finishedAt: new Date().toISOString()
    };

    await updateLog(supabase, logId, {
      ok: true,
      participants_count: result.participantsCount,
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
