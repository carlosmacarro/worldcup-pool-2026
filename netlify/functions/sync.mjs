import { runResultsOnlySync } from './_lib/resultsOnlySyncCore.mjs';

export default async function handler() {
  try {
    const result = await runResultsOnlySync({ source: 'scheduled-results-only' });
    console.log('Scheduled results-only sync complete', result);
  } catch (error) {
    console.error('Scheduled results-only sync failed', error);
  }
}

export const config = {
  schedule: '*/5 * * * *'
};
