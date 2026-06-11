import { google } from 'googleapis';
import { getConfig } from './config.mjs';

function createDriveClient() {
  const cfg = getConfig();
  const auth = new google.auth.JWT({
    email: cfg.googleServiceAccountEmail,
    key: cfg.googlePrivateKey,
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  });

  return google.drive({ version: 'v3', auth });
}

export async function listExcelFilesInDriveFolder() {
  const cfg = getConfig();
  const drive = createDriveClient();
  const q = [
    `'${cfg.googleDriveFolderId}' in parents`,
    'trashed = false',
    "(mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' or mimeType = 'application/vnd.ms-excel')"
  ].join(' and ');

  const files = [];
  let pageToken;

  do {
    const response = await drive.files.list({
      q,
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size)',
      pageSize: 100,
      pageToken,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true
    });

    files.push(...(response.data.files || []));
    pageToken = response.data.nextPageToken;
  } while (pageToken);

  return files.sort((a, b) => a.name.localeCompare(b.name));
}

export async function downloadDriveFileBuffer(fileId) {
  const drive = createDriveClient();
  const response = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' }
  );
  return Buffer.from(response.data);
}
