import { createClient } from '@supabase/supabase-js';
import { getConfig } from './config.mjs';

let cachedClient;

export function getSupabase() {
  if (!cachedClient) {
    const cfg = getConfig();
    cachedClient = createClient(cfg.supabaseUrl, cfg.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return cachedClient;
}

export async function fetchAll(table, { orderBy, ascending = true } = {}) {
  const supabase = getSupabase();
  const pageSize = 1000;
  let from = 0;
  const rows = [];

  while (true) {
    let query = supabase.from(table).select('*').range(from, from + pageSize - 1);
    if (orderBy) query = query.order(orderBy, { ascending });
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}
