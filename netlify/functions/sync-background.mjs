import { getRequestUrl, isOptions } from './_lib/http.mjs';
import { getConfig } from './_lib/config.mjs';
import { runSync } from './_lib/syncCore.mjs';

export const config = {
  background: true
};

function providedSecret(req) {
  const url = getRequestUrl(req);
  return req.headers.get('x-admin-secret') || url.searchParams.get('secret') || '';
}

export default async function handler(req) {
  if (isOptions(req)) return;

  const cfg = getConfig();
  if (cfg.adminSecret && providedSecret(req) !== cfg.adminSecret) {
    console.error('Unauthorized background sync attempt.');
    return;
  }

  await runSync({ source: 'manual-background' });
}
