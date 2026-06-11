import { jsonResponse, getRequestUrl, isOptions } from './_lib/http.mjs';
import { getConfig } from './_lib/config.mjs';
import { getSupabase } from './_lib/db.mjs';

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

    const url = getRequestUrl(req);
    const since = url.searchParams.get('since');
    const supabase = getSupabase();

    let query = supabase
      .from('sync_logs')
      .select('id, started_at, finished_at, ok, source, participants_count, predictions_count, matches_count, warnings, error')
      .order('started_at', { ascending: false })
      .limit(5);

    if (since) query = query.gte('started_at', since);

    const { data, error } = await query;
    if (error) throw error;

    const logs = data || [];
    return jsonResponse({
      ok: true,
      running: logs.some((log) => !log.finished_at),
      latest: logs[0] || null,
      logs
    });
  } catch (error) {
    console.error(error);
    return jsonResponse({ ok: false, error: error.message || String(error) }, { status: 500 });
  }
}
