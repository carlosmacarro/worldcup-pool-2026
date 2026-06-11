const CANONICAL_TEAM_ALIASES = {
  'MEXICO': ['MEXICO', 'MÉXICO'],
  'UNITED STATES': ['UNITED STATES', 'UNITED STATES OF AMERICA', 'USA', 'ESTADOS UNIDOS'],
  'SOUTH KOREA': [
    'SOUTH KOREA',
    'KOREA REPUBLIC',
    'REPUBLIC OF KOREA',
    'KOREA REP.',
    'KOREA REP',
    'KOREA SOUTH',
    'COREA DEL SUR',
    'REPUBLICA DE COREA',
    'REPÚBLICA DE COREA'
  ],
  'CZECHIA': ['CZECHIA', 'CZECH REPUBLIC', 'REPUBLICA CHECA', 'REPÚBLICA CHECA', 'CHEQUIA'],
  'SOUTH AFRICA': ['SOUTH AFRICA', 'SUDAFRICA', 'SUDÁFRICA'],
  'NETHERLANDS': ['NETHERLANDS', 'THE NETHERLANDS', 'HOLLAND', 'HOLANDA', 'PAISES BAJOS', 'PAÍSES BAJOS'],
  'GERMANY': ['GERMANY', 'ALEMANIA'],
  'CURACAO': ['CURACAO', 'CURAÇAO', 'CURAZAO'],
  'JAPAN': ['JAPAN', 'JAPON', 'JAPÓN'],
  'SWITZERLAND': ['SWITZERLAND', 'SUIZA'],
  'QATAR': ['QATAR', 'CATAR'],
  'IVORY COAST': [
    'IVORY COAST',
    "COTE D'IVOIRE",
    'CÔTE D’IVOIRE',
    'CÔTE D\'IVOIRE',
    'COTE D IVOIRE',
    'COTE DIVOIRE',
    'COSTA DE MARFIL'
  ],
  'MOROCCO': ['MOROCCO', 'MARRUECOS'],
  'BRAZIL': ['BRAZIL', 'BRASIL'],
  'SCOTLAND': ['SCOTLAND', 'ESCOCIA'],
  'HAITI': ['HAITI', 'HAITÍ'],
  'SWEDEN': ['SWEDEN', 'SUECIA'],
  'CAPE VERDE': ['CAPE VERDE', 'CABO VERDE'],
  'CANADA': ['CANADA', 'CANADÁ'],
  'SAUDI ARABIA': ['SAUDI ARABIA', 'ARABIA SAUDITA'],
  'TURKEY': ['TURKEY', 'TURKIYE', 'TÜRKIYE', 'TURQUIA', 'TURQUÍA'],
  'FRANCE': ['FRANCE', 'FRANCIA'],
  'ENGLAND': ['ENGLAND', 'INGLATERRA'],
  'SPAIN': ['SPAIN', 'ESPAÑA', 'ESPANA'],
  'BELGIUM': ['BELGIUM', 'BELGIQUE', 'BÉLGICA', 'BELGICA'],
  'EGYPT': ['EGYPT', 'EGIPTO'],
  'IRAN': ['IRAN', 'IR IRAN', 'I.R. IRAN', 'ISLAMIC REPUBLIC OF IRAN', 'IRÁN'],
  'IRAQ': ['IRAQ', 'IRAK'],
  'NEW ZEALAND': ['NEW ZEALAND', 'NUEVA ZELANDA'],
  'URUGUAY': ['URUGUAY'],
  'ARGENTINA': ['ARGENTINA'],
  'ALGERIA': ['ALGERIA', 'ARGELIA'],
  'AUSTRIA': ['AUSTRIA'],
  'JORDAN': ['JORDAN', 'JORDANIA'],
  'PORTUGAL': ['PORTUGAL'],
  'DR CONGO': [
    'DR CONGO',
    'RD CONGO',
    'CONGO DR',
    'CONGO, DR',
    'CONGO DEMOCRATIC REPUBLIC',
    'DEMOCRATIC REPUBLIC OF CONGO',
    'CONGO-KINSHASA'
  ],
  'UZBEKISTAN': ['UZBEKISTAN', 'UZBEKISTÁN'],
  'COLOMBIA': ['COLOMBIA'],
  'CROATIA': ['CROATIA', 'CROACIA'],
  'GHANA': ['GHANA'],
  'PANAMA': ['PANAMA', 'PANAMÁ'],
  'PARAGUAY': ['PARAGUAY'],
  'ECUADOR': ['ECUADOR'],
  'SENEGAL': ['SENEGAL'],
  'NORWAY': ['NORWAY', 'NORUEGA'],
  'AUSTRALIA': ['AUSTRALIA'],
  'TUNISIA': ['TUNISIA', 'TUNEZ', 'TÚNEZ']
};

const TEAM_ALIASES = new Map();

function addAlias(alias, canonical) {
  if (!alias) return;
  TEAM_ALIASES.set(String(alias).toUpperCase(), canonical);
  TEAM_ALIASES.set(normaliseText(alias), canonical);
}

for (const [canonical, aliases] of Object.entries(CANONICAL_TEAM_ALIASES)) {
  addAlias(canonical, canonical);
  for (const alias of aliases) addAlias(alias, canonical);
}

export function normaliseText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' AND ')
    .replace(/['’]/g, '')
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
