import { runSync } from './_lib/syncCore.mjs';

export default async function handler() {
  try {
    const result = await runSync({ source: 'scheduled' });
    console.log('Scheduled sync complete', result);
  } catch (error) {
    console.error('Scheduled sync failed', error);
  }
}

export const config = {
  schedule: '*/5 * * * *'
};
