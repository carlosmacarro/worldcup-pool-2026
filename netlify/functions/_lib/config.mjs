function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function getConfig() {
  return {
    supabaseUrl: required('SUPABASE_URL'),
    supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    googleServiceAccountEmail: required('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
    googlePrivateKey: required('GOOGLE_PRIVATE_KEY').replace(/\\n/g, '\n'),
    googleDriveFolderId: required('GOOGLE_DRIVE_FOLDER_ID'),
    footballDataToken: required('FOOTBALL_DATA_TOKEN'),
    footballCompetitionCode: process.env.FOOTBALL_COMPETITION_CODE || 'WC',
    footballSeason: process.env.FOOTBALL_SEASON || '2026',
    adminSecret: process.env.ADMIN_SECRET || '',
    countLiveMatches: String(process.env.COUNT_LIVE_MATCHES || 'false').toLowerCase() === 'true'
  };
}

export function getOptionalConfigStatus() {
  const names = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_PRIVATE_KEY',
    'GOOGLE_DRIVE_FOLDER_ID',
    'FOOTBALL_DATA_TOKEN',
    'ADMIN_SECRET'
  ];
  return Object.fromEntries(names.map((name) => [name, Boolean(process.env[name])]));
}
