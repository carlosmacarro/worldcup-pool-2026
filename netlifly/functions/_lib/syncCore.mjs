import { getSupabase } from './db.mjs';
import { listExcelFilesByPhase, downloadDriveFileBuffer } from './googleDrive.mjs';
import { parsePredictionsFromExcelBuffer } from './xlsxParser.mjs';
import { fetchFootballDataMatches, mapFootballDataMatches } from './footballData.mjs';
import { mapKnockoutMatches } from './knockoutMatches.mjs';
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
    .select('id').single();
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
      .replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toLowerCase();
    const uniqueKey = `${originalKey}-${suffix}`;
    item.participant.participant_key = uniqueKey;
    item.predictions       = (item.predictions       || []).map(r => ({ ...r, participant_key: uniqueKey }));
    item.groupPositions    = (item.groupPositions    || []).map(r => ({ ...r, participant_key: uniqueKey }));
    item.specialPredictions= (item.specialPredictions|| []).map(r => ({ ...r, participant_key: uniqueKey }));
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
        match_no:    prediction.match_no,
        kickoff:     prediction.kickoff,
        round_label: prediction.round_label,
        stage:       'GROUP_STAGE',
        group_name:  null,
        home_team:   prediction.home_team,
        away_team:   prediction.away_team
      });
    }
  }
  return [...fixturesByMatchNo.values()].sort((a, b) => a.match_no - b.match_no);
}

async function parseFilesForPhase(files, phaseFilter, warnings) {
  const parsedFiles = [];
  for (const file of files) {
    try {
      const buffer = await downloadDriveFileBuffer(file.id);
      const parsed = parsePredictionsFromExcelBuffer(buffer, file, { phaseFilter });
      warnings.push(...parsed.warnings);
      parsedFiles.push(parsed);
    } catch (error) {
      warnings.push({ file: file.name, message: error.message || String(error) });
    }
  }
  disambiguateParticipantKeys(parsedFiles, warnings);
  return parsedFiles;
}

/**
 * Replaces predictions in [matchNoFrom, matchNoTo] for one participant,
 * leaving other phases untouched.
 */
async function replacePredictionsInRange(supabase, participantKey, matchNoFrom, matchNoTo, predictions) {
  let q = supabase.from('predictions').delete().eq('participant_key', participantKey);
  if (matchNoFrom != null) q = q.gte('match_no', matchNoFrom);
  if (matchNoTo   != null) q = q.lte('match_no', matchNoTo);
  const { error } = await q;
  if (error) throw error;
  await upsertChunked(supabase, 'predictions', predictions, 'participant_key,match_no');
}

/**
 * Replaces all rows in an optional bonus table for one participant.
 * Fails softly (warning) if the table doesn't exist yet in Supabase so that
 * older installs that haven't run the latest supabase_schema.sql don't break.
 */
async function replaceBonusRows(supabase, table, conflictColumns, participantKey, rows, warnings) {
  if (!rows.length) return;
  try {
    const { error: delErr } = await supabase.from(table).delete().eq('participant_key', participantKey);
    if (delErr) throw delErr;
    await upsertChunked(supabase, table, rows, conflictColumns);
  } catch (error) {
    warnings.push({
      message: `Could not save '${table}' rows for ${participantKey}: ${error.message || error}. ` +
               `Run the latest supabase_schema.sql additions.`
    });
  }
}

async function syncPredictionsFromDrive(supabase, warnings) {
  const { groupFiles, knockoutFiles, eliminatoriaFolderId } = await listExcelFilesByPhase();

  if (!groupFiles.length)     warnings.push({ message: 'No Excel files found in the root Google Drive folder (group-stage bets).' });
  if (!eliminatoriaFolderId)  warnings.push({ message: "No 'Eliminatoria' subfolder found yet. Create it in Drive and upload knockout-phase Excels there when ready." });
  else if (!knockoutFiles.length) warnings.push({ message: "'Eliminatoria' folder exists but has no Excel files yet." });

  const groupParsed   = await parseFilesForPhase(groupFiles,   'group',   warnings);
  const knockoutParsed= await parseFilesForPhase(knockoutFiles, 'knockout', warnings);

  const participants = groupParsed.map(p => p.participant);
  const currentKeys  = new Set(participants.map(p => p.participant_key));

  if (participants.length) {
    await upsertChunked(supabase, 'participants', participants, 'participant_key');

    // Remove stale participants (deleted from root Drive folder).
    const { data: existing, error } = await supabase.from('participants').select('participant_key');
    if (error) throw error;
    const staleKeys = (existing || []).map(p => p.participant_key).filter(k => !currentKeys.has(k));
    if (staleKeys.length) {
      const { error: delErr } = await supabase.from('participants').delete().in('participant_key', staleKeys);
      if (delErr) throw delErr;
    }

    // Replace group-stage predictions (match_no 1–72) and bonus data.
    for (const parsed of groupParsed) {
      const key = parsed.participant.participant_key;
      await replacePredictionsInRange(supabase, key, 1, GROUP_STAGE_MAX_MATCH_NO, parsed.predictions);

      // Group order and special picks are only parsed from root-folder files.
      await replaceBonusRows(supabase, 'group_position_predictions', 'participant_key,group_name,position',
        key, parsed.groupPositions    || [], warnings);
      await replaceBonusRows(supabase, 'special_predictions',        'participant_key,category',
        key, parsed.specialPredictions|| [], warnings);
    }
  }

  // Replace knockout predictions (match_no 73+), matched to the same participant key.
  for (const parsed of knockoutParsed) {
    const knockoutKey = parsed.participant.participant_key;
    const matchedParticipant = participants.find(p => p.participant_key === knockoutKey);
    if (!matchedParticipant) {
      warnings.push({
        file: parsed.participant.file_name,
        message: `Eliminatoria file participant name didn't match anyone in the root folder ` +
                 `(key '${knockoutKey}'). Knockout bets not saved — make sure the name in ` +
                 `the Home sheet matches the original Excel exactly.`
      });
      continue;
    }
    const predictions = parsed.predictions.map(p => ({ ...p, participant_key: knockoutKey }));
    await replacePredictionsInRange(supabase, knockoutKey, GROUP_STAGE_MAX_MATCH_NO + 1, null, predictions);
  }

  return {
    participantsCount: participants.length,
    predictionsCount:
      groupParsed.reduce((s, p) => s + p.predictions.length, 0) +
      knockoutParsed.reduce((s, p) => s + p.predictions.length, 0),
    excelFixtures: buildExcelFixturesFromParsedFiles(groupParsed)
  };
}

async function syncMatchesFromFootballData(supabase, excelFixtures = [], warnings = []) {
  const cfg        = getConfig();
  const apiMatches = await fetchFootballDataMatches();

  const groupMatches   = mapFootballDataMatches(apiMatches, { countLiveMatches: cfg.countLiveMatches, excelFixtures, warnings });
  const knockoutMatches= mapKnockoutMatches(apiMatches,    { countLiveMatches: cfg.countLiveMatches, warnings });

  await upsertChunked(supabase, 'matches', groupMatches,   'match_no');
  await upsertChunked(supabase, 'matches', knockoutMatches, 'match_no');

  return { matchesCount: groupMatches.length + knockoutMatches.length };
}

export async function runSync({ source = 'manual' } = {}) {
  const supabase = getSupabase();
  const warnings = [];
  let logId;
  try {
    logId = await insertLog(supabase, source);
    const predictionStats = await syncPredictionsFromDrive(supabase, warnings);
    const matchStats      = await syncMatchesFromFootballData(supabase, predictionStats.excelFixtures || [], warnings);
    const { excelFixtures, ...publicPredictionStats } = predictionStats;

    const result = { ok: true, source, ...publicPredictionStats, ...matchStats, warnings, finishedAt: new Date().toISOString() };
    await updateLog(supabase, logId, {
      ok: true,
      participants_count: result.participantsCount,
      predictions_count:  result.predictionsCount,
      matches_count:      result.matchesCount,
      warnings
    });
    return result;
  } catch (error) {
    await updateLog(supabase, logId, { ok: false, warnings, error: error.stack || error.message || String(error) });
    throw error;
  }
}
