import { jsonResponse, getRequestUrl, isOptions } from './_lib/http.mjs';
import { getConfig } from './_lib/config.mjs';

function providedSecret(req) {
  const url = getRequestUrl(req);
  return req.headers.get('x-admin-secret') || url.searchParams.get('secret') || '';
}

export default async function handler(req) {
  if (isOptions(req)) return jsonResponse({ ok: true });

  try {
    const cfg = getConfig();
    const secret = providedSecret(req);

    if (cfg.adminSecret && secret !== cfg.adminSecret) {
      return jsonResponse({ ok: false, error: 'Unauthorized. Check ADMIN_SECRET.' }, { status: 401 });
    }

    const startedAt = new Date().toISOString();
    const endpoint = new URL('/.netlify/functions/sync-background', getRequestUrl(req));
    const queued = await fetch(endpoint, {
      method: 'POST',
      headers: { 'x-admin-secret': secret }
    });

    if (!queued.ok && queued.status !== 202) {
      const text = await queued.text().catch(() => '');
      return jsonResponse(
        {
          ok: false,
          error: `Could not queue background sync. HTTP ${queued.status}`,
          details: text.slice(0, 1000)
        },
        { status: 500 }
      );
    }

    return jsonResponse({
      ok: true,
      queued: true,
      status: queued.status,
      startedAt,
      message: 'Sync started in the background. This can take a little while if there are many Excel files.'
    });
  } catch (error) {
    console.error(error);
    return jsonResponse({ ok: false, error: error.message || String(error) }, { status: 500 });
  }
}
