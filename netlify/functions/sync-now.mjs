import { jsonResponse, getRequestUrl, isOptions } from './_lib/http.mjs';
import { getConfig } from './_lib/config.mjs';
import { runSync } from './_lib/syncCore.mjs';

function providedSecret(req) {
  const url = getRequestUrl(req);
  return req.headers.get('x-admin-secret') || url.searchParams.get('secret') || '';
}

export default async function handler(req) {
  if (isOptions(req)) return jsonResponse({ ok: true });

  try {
    const cfg = getConfig();
    if (cfg.adminSecret && providedSecret(req) !== cfg.adminSecret) {
      return jsonResponse({ ok: false, error: 'Unauthorized. Check ADMIN_SECRET.' }, { status: 401 });
    }

    const result = await runSync({ source: 'manual' });
    return jsonResponse(result);
  } catch (error) {
    console.error(error);
    return jsonResponse({ ok: false, error: error.message || String(error) }, { status: 500 });
  }
}
