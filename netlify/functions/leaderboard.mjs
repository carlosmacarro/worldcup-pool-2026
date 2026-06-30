import { jsonResponse, getRequestUrl, isOptions } from './_lib/http.mjs';
import { buildLeaderboard } from './_lib/leaderboardBuilder.mjs';

export default async function handler(req) {
  if (isOptions(req)) return jsonResponse({ ok: true });

  try {
    const url = getRequestUrl(req);
    const phase = url.searchParams.get('phase') || 'all';
    const data = await buildLeaderboard({ phase });
    return jsonResponse(data);
  } catch (error) {
    console.error(error);
    return jsonResponse({ ok: false, error: error.message || String(error) }, { status: 500 });
  }
}