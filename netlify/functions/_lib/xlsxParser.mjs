import XLSX from 'xlsx';
import { slugifyParticipantName } from './normalise.mjs';

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

function excelDateToIso(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    const date = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H || 0, parsed.M || 0, Math.floor(parsed.S || 0)));
    return date.toISOString();
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

export function parsePredictionsFromExcelBuffer(buffer, fileMeta = {}) {
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: true,
    cellFormula: false,
    cellNF: false,
    cellStyles: false
  });

  const sheet = getSheetCaseInsensitive(workbook, SHEET_NAME);
  if (!sheet) throw new Error(`Sheet '${SHEET_NAME}' not found`);

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

    if (!Number.isInteger(predHome) || !Number.isInteger(predAway)) {
      warnings.push({ file: fileMeta.name, matchNo, message: 'Missing or non-numeric prediction' });
      continue;
    }

    predictions.push({
      participant_key: participantKey,
      match_no: matchNo,
      kickoff: excelDateToIso(row[COLS.kickoff]),
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

  return {
    participant: {
      participant_key: participantKey,
      name: participantName,
      file_id: fileMeta.id || null,
      file_name: fileMeta.name || null,
      updated_at: new Date().toISOString()
    },
    predictions: predictions.sort((a, b) => a.match_no - b.match_no),
    warnings
  };
}
