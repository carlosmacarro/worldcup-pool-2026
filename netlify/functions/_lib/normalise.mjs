const TEAM_ALIASES = new Map(Object.entries({
  'MEXICO': 'MEXICO',
  'MÉXICO': 'MEXICO',
  'ESTADOS UNIDOS': 'UNITED STATES',
  'USA': 'UNITED STATES',
  'UNITED STATES OF AMERICA': 'UNITED STATES',
  'COREA DEL SUR': 'SOUTH KOREA',
  'REPUBLICA DE COREA': 'SOUTH KOREA',
  'REPÚBLICA DE COREA': 'SOUTH KOREA',
  'PAISES BAJOS': 'NETHERLANDS',
  'PAÍSES BAJOS': 'NETHERLANDS',
  'HOLANDA': 'NETHERLANDS',
  'ALEMANIA': 'GERMANY',
  'SUIZA': 'SWITZERLAND',
  'SUECIA': 'SWEDEN',
  'MARRUECOS': 'MOROCCO',
  'TUNEZ': 'TUNISIA',
  'TÚNEZ': 'TUNISIA',
  'CATAR': 'QATAR',
  'COSTA DE MARFIL': 'IVORY COAST',
  "COTE D'IVOIRE": 'IVORY COAST',
  'CÔTE D’IVOIRE': 'IVORY COAST',
  'REPUBLICA CHECA': 'CZECHIA',
  'REPÚBLICA CHECA': 'CZECHIA',
  'CHEQUIA': 'CZECHIA',
  'BOSNIA Y HERZEGOVINA': 'BOSNIA AND HERZEGOVINA',
  'SUDAFRICA': 'SOUTH AFRICA',
  'SUDÁFRICA': 'SOUTH AFRICA',
  'TURQUIA': 'TURKEY',
  'TURQUÍA': 'TURKEY',
  'ESCOCIA': 'SCOTLAND',
  'JAPON': 'JAPAN',
  'JAPÓN': 'JAPAN'
}));

export function normaliseText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

export function normaliseTeam(value) {
  const raw = String(value || '').trim();
  const simple = normaliseText(raw);
  return TEAM_ALIASES.get(raw.toUpperCase()) || TEAM_ALIASES.get(simple) || simple;
}

export function slugifyParticipantName(name) {
  return normaliseText(name || 'participant').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'participant';
}
