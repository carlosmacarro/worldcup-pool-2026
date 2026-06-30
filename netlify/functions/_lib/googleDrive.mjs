import { google } from 'googleapis';
import { getConfig } from './config.mjs';

const EXCEL_MIME_QUERY = "(mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' or mimeType = 'application/vnd.ms-excel')";
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const ELIMINATORIA_FOLDER_NAME = 'Eliminatoria';

function createDriveClient() {
  const cfg = getConfig();
  const auth = new google.auth.JWT({
    email: cfg.googleServiceAccountEmail,
    key: cfg.googlePrivateKey,
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  });

  return google.drive({ version: 'v3', auth });
}

async function listFilesInFolder(drive, folderId) {
  const q = [`'${folderId}' in parents`, 'trashed = false', EXCEL_MIME_QUERY].join(' and ');
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

/**
 * Finds the "Eliminatoria" subfolder inside the root Drive folder, if it
 * exists yet. Returns null (not an error) when it hasn't been created, so
 * syncs keep working before you add knockout-phase Excels.
 */
export async function findEliminatoriaFolderId(drive, rootFolderId) {
  const q = [
    `'${rootFolderId}' in parents`,
    'trashed = false',
    `mimeType = '${FOLDER_MIME}'`,
    `name = '${ELIMINATORIA_FOLDER_NAME}'`
  ].join(' and ');

  const response = await drive.files.list({
    q,
    fields: 'files(id, name)',
    pageSize: 5,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true
  });

  const folder = (response.data.files || [])[0];
  return folder ? folder.id : null;
}

/**
 * Lists the Excel files for both phases.
 *   - groupFiles: Excel files directly inside the root Drive folder (NOT inside Eliminatoria)
 *   - knockoutFiles: Excel files inside the root folder's "Eliminatoria" subfolder
 */
export async function listExcelFilesByPhase() {
  const cfg = getConfig();
  const drive = createDriveClient();

  const eliminatoriaFolderId = await findEliminatoriaFolderId(drive, cfg.googleDriveFolderId);

  const [groupFiles, knockoutFiles] = await Promise.all([
    listFilesInFolder(drive, cfg.googleDriveFolderId),
    eliminatoriaFolderId ? listFilesInFolder(drive, eliminatoriaFolderId) : Promise.resolve([])
  ]);

  return { groupFiles, knockoutFiles, eliminatoriaFolderId };
}

export async function downloadDriveFileBuffer(fileId) {
  const drive = createDriveClient();
  const response = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' }
  );
  return Buffer.from(response.data);
}