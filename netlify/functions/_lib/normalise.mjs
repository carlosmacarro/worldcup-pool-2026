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
  'COTE D IVOIRE': 'IVORY COAST',
  'REPUBLICA CHECA': 'CZECHIA',
  'REPÚBLICA CHECA': 'CZECHIA',
  'CHEQUIA': 'CZECHIA',
  'CZECH REPUBLIC': 'CZECHIA',
  'BOSNIA Y HERZEGOVINA': 'BOSNIA AND HERZEGOVINA',
  'SUDAFRICA': 'SOUTH AFRICA',
  'SUDÁFRICA': 'SOUTH AFRICA',
  'TURQUIA': 'TURKEY',
  'TURQUÍA': 'TURKEY',
  'ESCOCIA': 'SCOTLAND',
  'JAPON': 'JAPAN',
  'JAPÓN': 'JAPAN',
  'BRASIL': 'BRAZIL',
  'CURAÇAO': 'CURACAO',
  'CURAZAO': 'CURACAO',
  'CAPE VERDE': 'CAPE VERDE',
  'CABO VERDE': 'CAPE VERDE',
  'ARABIA SAUDITA': 'SAUDI ARABIA',
  'SAUDI ARABIA': 'SAUDI ARABIA',
  'FRANCIA': 'FRANCE',
  'INGLATERRA': 'ENGLAND',
  'ESPAÑA': 'SPAIN',
  'ESPANA': 'SPAIN',
  'BÉLGICA': 'BELGIUM',
  'BELGICA': 'BELGIUM',
  'EGIPTO': 'EGYPT',
  'IRAN': 'IRAN',
  'IRÁN': 'IRAN',
  'IRAK': 'IRAQ',
  'NUEVA ZELANDA': 'NEW ZEALAND',
  'URUGUAY': 'URUGUAY',
  'ARGENTINA': 'ARGENTINA',
  'ARGELIA': 'ALGERIA',
  'AUSTRIA': 'AUSTRIA',
  'JORDANIA': 'JORDAN',
  'PORTUGAL': 'PORTUGAL',
  'RD CONGO': 'DR CONGO',
  'DR CONGO': 'DR CONGO',
  'CONGO DR': 'DR CONGO',
  'CONGO, DR': 'DR CONGO',
  'UZBEKISTAN': 'UZBEKISTAN',
  'UZBEKISTÁN': 'UZBEKISTAN',
  'COLOMBIA': 'COLOMBIA',
  'CROACIA': 'CROATIA',
  'GHANA': 'GHANA',
  'PANAMA': 'PANAMA',
  'PANAMÁ': 'PANAMA',
  'PARAGUAY': 'PARAGUAY',
  'ECUADOR': 'ECUADOR',
  'SENEGAL': 'SENEGAL',
  'NORUEGA': 'NORWAY',
  'AUSTRALIA': 'AUSTRALIA',
  'HAITI': 'HAITI',
  'HAITÍ': 'HAITI',
  'CANADA': 'CANADA',
  'CANADÁ': 'CANADA'
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
