import XLSX from 'xlsx';
import { getConfig } from './config.mjs';
import { slugifyParticipantName } from './normalise.mjs';
import { GROUP_STAGE_MAX_MATCH_NO } from './phases.mjs';

const SHEET_NAME = 'WORLDCUP';

// Fixed columns in the WORLDCUP tab (0-indexed).
// A=0, B=1, …, X=23, AA=26, AC=28, AD=29, AF=31, AH=33.
const COLS = {
  kickoff:    23,   // X
  roundLabel: 25,   // Z
  homeTeam:   26,   // AA
  predHome:   28,   // AC
  predAway:   29,   // AD
  awayTeam:   31,   // AF
  matchNo:    33    // AH
};

// ─── Group position predictions ──────────────────────────────────────────────
// 12 groups (A–L), 4 rows each.  Group A → AJ6:AJ9 (position) + AL6:AL9 (team).
// Group B → AJ14:AJ17 + AL14:AL17, etc.  Stride of 8 rows between groups.
const GROUP_NAMES          = ['A','B','C','D','E','F','G','H','I','J','K','L'];
const GROUP_BLOCK_START_ROW = 6;
const GROUP_BLOCK_STRIDE    = 8;
const GROUP_POSITION_COL    = 'AJ';
const GROUP_TEAM_COL        = 'AL';

// ─── Special tournament picks ────────────────────────────────────────────────
// All in column AA. Confirmed order from spreadsheet:
//   AA150 = winner, AA151 = runner-up, AA152 = third,
//   AA154 = bota_de_oro, AA158 = balon_de_oro
const SPECIAL_CELLS = {
  winner:      'AA150',
  second:      'AA151',
  third:       'AA152',
  bota_de_oro: 'AA154',
  balon_de_oro:'AA158'
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getSheetCaseInsensitive(workbook, targetName) {
  const name = workbook.SheetNames.find(s => s.toLowerCase() === targetName.toLowerCase());
  return name ? workbook.Sheets[name] : null;
}

function readCell(sheet, address) {
  return sheet?.[address]?.v ?? null;
}

function cellToNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isValidTimeZone(tz) {
  if (!tz) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date()); return true; }
  catch { return false; }
}

function extractTimeZoneFromHomeSheet(workbook) {
  const home = getSheetCaseInsensitive(workbook, 'Home');
  if (!home) return null;
  const rows = XLSX.utils.sheet_to_json(home, { header: 1, raw: false, defval: '' });
  const candidates = [];
  for (const row of rows) {
    for (const cell of row) {
      const value = String(cell || '').trim();
      if (!value) continue;
      const direct = value.match(/[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?/);
      if (direct) candidates.push(direct[0]);
      const n = value.toLowerCase();
      if (n.includes('madrid') || n.includes('españa') || n.includes('spain')) candidates.push('Europe/Madrid');
      if (n.includes('mexico city') || n.includes('ciudad de méx')) candidates.push('America/Mexico_City');
      if (n.includes('new york') || n.includes('nueva york')) candidates.push('America/New_York');
      if (n.includes('los angeles')) candidates.push('America/Los_Angeles');
    }
  }
  return candidates.find(isValidTimeZone) || null;
}

function zonedPartsToUtcIso(parts, timeZone) {
  const utcGuess = Date.UTC(parts.y, parts.m - 1, parts.d, parts.H || 0, parts.M || 0, Math.floor(parts.S || 0));
  if (!isValidTimeZone(timeZone)) return new Date(utcGuess).toISOString();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone, year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'
  });
  const fp = Object.fromEntries(
    formatter.formatToParts(new Date(utcGuess))
      .filter(p => p.type !== 'literal')
      .map(p => [p.type, Number(p.value)])
  );
  const asIfUtc = Date.UTC(fp.year, fp.month - 1, fp.day, fp.hour, fp.minute, fp.second);
  return new Date(utcGuess - (asIfUtc - utcGuess)).toISOString();
}

function excelDateToIso(value, timeZone) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return zonedPartsToUtcIso({ y:value.getUTCFullYear(), m:value.getUTCMonth()+1, d:value.getUTCDate(),
      H:value.getUTCHours(), M:value.getUTCMinutes(), S:value.getUTCSeconds() }, timeZone);
  }
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    return parsed ? zonedPartsToUtcIso(parsed, timeZone) : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

function getParticipantName(workbook, fallbackFileName) {
  const home = getSheetCaseInsensitive(workbook, 'Home');
  const nameFromHome = String(readCell(home, 'C10') || '').trim();
  if (nameFromHome && !/^#/.test(nameFromHome)) return nameFromHome;
  return fallbackFileName
    .replace(/\.(xlsx|xlsm|xls)$/i, '')
    .replace(/^Excel[-_ ]Mundial[-_ ]2026[-_ ]?/i, '')
    .replace(/[_-]+/g, ' ')
    .trim() || fallbackFileName;
}

/**
 * Predicted final group standings from fixed cells (AJ/AL columns).
 * Returns rows shaped for group_position_predictions table.
 * Participant key is added by the caller.
 */
function parseGroupPositionPredictions(sheet) {
  const rows = [];
  GROUP_NAMES.forEach((groupName, groupIndex) => {
    const startRow = GROUP_BLOCK_START_ROW + groupIndex * GROUP_BLOCK_STRIDE;
    for (let i = 0; i < 4; i++) {
      const row  = startRow + i;
      const team = String(readCell(sheet, `${GROUP_TEAM_COL}${row}`) || '').trim();
      if (!team) continue;
      const cellPos  = cellToNumber(readCell(sheet, `${GROUP_POSITION_COL}${row}`));
      const position = (Number.isInteger(cellPos) && cellPos >= 1 && cellPos <= 4) ? cellPos : i + 1;
      rows.push({ group_name: groupName, position, team });
    }
  });
  return rows;
}

/**
 * Tournament-wide special picks from fixed cells (AA column).
 * Returns rows shaped for special_predictions table.
 * Participant key is added by the caller.
 */
function parseSpecialPredictions(sheet) {
  const rows = [];
  for (const [category, address] of Object.entries(SPECIAL_CELLS)) {
    const value = String(readCell(sheet, address) || '').trim();
    if (!value) continue;
    rows.push({ category, predicted_value: value });
  }
  return rows;
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * @param {Buffer} buffer
 * @param {object} fileMeta  – { id, name, … } from Google Drive listing
 * @param {object} options
 * @param {'group'|'knockout'|'all'} [options.phaseFilter]
 *   'group'    → only match_no 1–72
 *   'knockout' → only match_no 73+
 *   'all'      → everything (default)
 */
export function parsePredictionsFromExcelBuffer(buffer, fileMeta = {}, options = {}) {
  const phaseFilter = options.phaseFilter || 'all';
  const cfg         = getConfig();

  const workbook = XLSX.read(buffer, {
    type: 'buffer', cellDates: false, cellFormula: false, cellNF: false, cellStyles: false
  });

  const sheet = getSheetCaseInsensitive(workbook, SHEET_NAME);
  if (!sheet) throw new Error(`Sheet '${SHEET_NAME}' not found`);

  const timeZone       = extractTimeZoneFromHomeSheet(workbook) || cfg.excelTimeZone || 'Europe/Madrid';
  const participantName = getParticipantName(workbook, fileMeta.name || 'participant.xlsx');
  const participantKey  = slugifyParticipantName(participantName)
                        || slugifyParticipantName(fileMeta.id || fileMeta.name);

  const rows        = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  const predictions = [];
  const warnings    = [];

  for (const row of rows) {
    const matchNo  = cellToNumber(row[COLS.matchNo]);
    const homeTeam = String(row[COLS.homeTeam] || '').trim();
    const awayTeam = String(row[COLS.awayTeam] || '').trim();
    const predHome = cellToNumber(row[COLS.predHome]);
    const predAway = cellToNumber(row[COLS.predAway]);

    if (!Number.isInteger(matchNo) || !homeTeam || !awayTeam) continue;

    const isGroupRow = matchNo <= GROUP_STAGE_MAX_MATCH_NO;
    if (phaseFilter === 'group'    && !isGroupRow) continue;
    if (phaseFilter === 'knockout' &&  isGroupRow) continue;

    if (!Number.isInteger(predHome) || !Number.isInteger(predAway)) {
      warnings.push({ file: fileMeta.name, matchNo, message: 'Missing or non-numeric prediction' });
      continue;
    }

    predictions.push({
      participant_key: participantKey,
      match_no:    matchNo,
      kickoff:     excelDateToIso(row[COLS.kickoff], timeZone),
      round_label: String(row[COLS.roundLabel] || '').trim() || null,
      home_team:   homeTeam,
      away_team:   awayTeam,
      pred_home:   predHome,
      pred_away:   predAway,
      updated_at:  new Date().toISOString()
    });
  }

  if (predictions.length === 0) {
    throw new Error(
      `No ${phaseFilter === 'all' ? '' : phaseFilter + '-phase '}predictions found in ` +
      `${fileMeta.name || 'Excel file'}. Check the WORLDCUP sheet and columns X:AH.`
    );
  }

  // Group-order and special picks are parsed from every file but are only
  // persisted by syncCore when processing root-folder (group-phase) files.
  const groupPositions    = parseGroupPositionPredictions(sheet)
    .map(r => ({ ...r, participant_key: participantKey }));
  const specialPredictions = parseSpecialPredictions(sheet)
    .map(r => ({ ...r, participant_key: participantKey }));

  return {
    participant: {
      participant_key: participantKey,
      name:       participantName,
      file_id:    fileMeta.id   || null,
      file_name:  fileMeta.name || null,
      updated_at: new Date().toISOString()
    },
    predictions: predictions.sort((a, b) => a.match_no - b.match_no),
    groupPositions,
    specialPredictions,
    warnings
  };
}
