import XLSX from 'xlsx';
import { getConfig } from './config.mjs';
import { slugifyParticipantName } from './normalise.mjs';
import { GROUP_STAGE_MAX_MATCH_NO } from './phases.mjs';

const SHEET_NAME = 'WORLDCUP';

// Fixed columns found in your uploaded workbook's WORLDCUP tab.
// A=0, B=1, ..., X=23, AA=26, AC=28, AD=29, AF=31, AH=33.
const COLS = {
  kickoff: 23,
  roundLabel: 25,
  homeTeam: 26,
  predHome: 28,
  predAway: 29,
  awayTeam: 31,
  matchNo: 33
};

const GROUP_NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
const GROUP_BLOCK_START_ROW = 6;
const GROUP_BLOCK_STRIDE = 8;
const GROUP_POSITION_COL = 'AJ';
const GROUP_TEAM_COL = 'AL';

const SPECIAL_CELLS = {
  winner: 'AA150',
  second: 'AA151',
  third: 'AA152',
  bota_de_oro: 'AA154',
  balon_de_oro: 'AA158'
};

function getSheetCaseInsensitive(workbook, targetName) {
  const name = workbook.SheetNames.find((s) => s.toLowerCase() === targetName.toLowerCase());
  if (!name) return null;
  return workbook.Sheets[name];
}

function readCell(sheet, address) {
  return sheet?.[address]?.v ?? null;
}

function cellToNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isValidTimeZone(timeZone) {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function extractTimeZoneFromHomeSheet(workbook) {
  const home = getSheetCaseInsensitive(workbook, 'Home');
  if (!home) return null;
  const ref = home['!ref'];
  if (!ref) return null;

  const rows = XLSX.utils.sheet_to_json(home, { header: 1, raw: false, defval: '' });
  const candidates = [];

  for (const row of rows) {
    for (const cell of row) {
      const value = String(cell || '').trim();
      if (!value) continue;

      // Accept a direct IANA timezone if the workbook contains one, e.g. Europe/Madrid.
      const direct = value.match(/[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?/);
      if (direct) candidates.push(direct[0]);

      // Common Spanish descriptions. Keep this intentionally conservative.
      const normalized = value.toLowerCase();
      if (normalized.includes('madrid') || normalized.includes('españa') || normalized.includes('spain')) {
        candidates.push('Europe/Madrid');
      }
      if (normalized.includes('mexico city') || normalized.includes('ciudad de méxico') || normalized.includes('ciudad de mexico')) {
        candidates.push('America/Mexico_City');
      }
      if (normalized.includes('new york') || normalized.includes('nueva york')) candidates.push('America/New_York');
      if (normalized.includes('los angeles')) candidates.push('America/Los_Angeles');
    }
  }

  return candidates.find(isValidTimeZone) || null;
}

function zonedPartsToUtcIso(parts, timeZone) {
  const utcGuess = Date.UTC(parts.y, parts.m - 1, parts.d, parts.H || 0, parts.M || 0, Math.floor(parts.S || 0));

  if (!isValidTimeZone(timeZone)) return new Date(utcGuess).toISOString();

  // Convert “these wall-clock parts in timeZone” to the corresponding UTC instant.
  // This avoids treating Excel's local fixture times as already-UTC.
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });

  const formattedParts = Object.fromEntries(
    formatter.formatToParts(new Date(utcGuess))
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, Number(p.value)])
  );

  const asIfUtc = Date.UTC(
    formattedParts.year,
    formattedParts.month - 1,
    formattedParts.day,
    formattedParts.hour,
    formattedParts.minute,
    formattedParts.second
  );

  const offsetMs = asIfUtc - utcGuess;
  return new Date(utcGuess - offsetMs).toISOString();
}

function excelDateToIso(value, timeZone) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return zonedPartsToUtcIso(
      {
        y: value.getUTCFullYear(),
        m: value.getUTCMonth() + 1,
        d: value.getUTCDate(),
        H: value.getUTCHours(),
        M: value.getUTCMinutes(),
        S: value.getUTCSeconds()
      },
      timeZone
    );
  }

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return zonedPartsToUtcIso(parsed, timeZone);
  }

  if (typeof value === 'string' && value.trim()) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
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

function parseGroupPositionPredictions(sheet) {
  const rows = [];

  GROUP_NAMES.forEach((groupName, groupIndex) => {
    const startRow = GROUP_BLOCK_START_ROW + groupIndex * GROUP_BLOCK_STRIDE;

    for (let offset = 0; offset < 4; offset += 1) {
      const row = startRow + offset;
      const team = String(readCell(sheet, `${GROUP_TEAM_COL}${row}`) || '').trim();
      if (!team) continue;

      const cellPos = cellToNumber(readCell(sheet, `${GROUP_POSITION_COL}${row}`));
      const position = Number.isInteger(cellPos) && cellPos >= 1 && cellPos <= 4 ? cellPos : offset + 1;

      rows.push({ group_name: groupName, position, team });
    }
  });

  return rows;
}

function parseSpecialPredictions(sheet) {
  const rows = [];

  for (const [category, address] of Object.entries(SPECIAL_CELLS)) {
    const value = String(readCell(sheet, address) || '').trim();
    if (!value) continue;
    rows.push({ category, predicted_value: value });
  }

  return rows;
}

/**
 * @param {Buffer} buffer
 * @param {object} fileMeta
 * @param {object} options
 * @param {'group'|'knockout'|'all'} [options.phaseFilter] - When 'group', only
 *   rows with match_no <= GROUP_STAGE_MAX_MATCH_NO are returned. When
 *   'knockout', only rows with match_no > GROUP_STAGE_MAX_MATCH_NO are
 *   returned. This lets the same WORLDCUP sheet layout be reused for both the
 *   root-folder (group) Excels and the Eliminatoria-folder (knockout) Excels,
 *   ignoring whichever rows don't belong to that file's phase.
 */
export function parsePredictionsFromExcelBuffer(buffer, fileMeta = {}, options = {}) {
  const phaseFilter = options.phaseFilter || 'all';
  const cfg = getConfig();
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    // Keep dates as Excel serial numbers where possible so we can interpret the
    // template times in the intended local timezone rather than as UTC.
    cellDates: false,
    cellFormula: false,
    cellNF: false,
    cellStyles: false
  });

  const sheet = getSheetCaseInsensitive(workbook, SHEET_NAME);
  if (!sheet) throw new Error(`Sheet '${SHEET_NAME}' not found`);

  const timeZone = extractTimeZoneFromHomeSheet(workbook) || cfg.excelTimeZone || 'Europe/Madrid';
  const participantName = getParticipantName(workbook, fileMeta.name || 'participant.xlsx');
  const participantKeyBase = slugifyParticipantName(participantName);
  const participantKey = participantKeyBase || slugifyParticipantName(fileMeta.id || fileMeta.name);

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  const predictions = [];
  const warnings = [];

  for (const row of rows) {
    const matchNo = cellToNumber(row[COLS.matchNo]);
    const homeTeam = String(row[COLS.homeTeam] || '').trim();
    const awayTeam = String(row[COLS.awayTeam] || '').trim();
    const predHome = cellToNumber(row[COLS.predHome]);
    const predAway = cellToNumber(row[COLS.predAway]);

    if (!Number.isInteger(matchNo) || !homeTeam || !awayTeam) continue;

    const isGroupRow = matchNo <= GROUP_STAGE_MAX_MATCH_NO;
    if (phaseFilter === 'group' && !isGroupRow) continue;
    if (phaseFilter === 'knockout' && isGroupRow) continue;

    if (!Number.isInteger(predHome) || !Number.isInteger(predAway)) {
      warnings.push({ file: fileMeta.name, matchNo, message: 'Missing or non-numeric prediction' });
      continue;
    }

    predictions.push({
      participant_key: participantKey,
      match_no: matchNo,
      kickoff: excelDateToIso(row[COLS.kickoff], timeZone),
      round_label: String(row[COLS.roundLabel] || '').trim() || null,
      home_team: homeTeam,
      away_team: awayTeam,
      pred_home: predHome,
      pred_away: predAway,
      updated_at: new Date().toISOString()
    });
  }

  if (predictions.length === 0) {
    throw new Error(`No predictions found in ${fileMeta.name || 'Excel file'}. Check the WORLDCUP sheet and columns X:AH.`);
  }

  const groupPositions = parseGroupPositionPredictions(sheet).map((row) => ({
    ...row,
    participant_key: participantKey
  }));

  const specialPredictions = parseSpecialPredictions(sheet).map((row) => ({
    ...row,
    participant_key: participantKey
  }));

  return {
    participant: {
      participant_key: participantKey,
      name: participantName,
      file_id: fileMeta.id || null,
      file_name: fileMeta.name || null,
      updated_at: new Date().toISOString()
    },
    predictions: predictions.sort((a, b) => a.match_no - b.match_no),
    groupPositions,
    specialPredictions,
    warnings
  };
}