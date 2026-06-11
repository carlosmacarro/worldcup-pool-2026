import { jsonResponse, isOptions } from './_lib/http.mjs';
import { buildLeaderboard } from './_lib/leaderboardBuilder.mjs';

export default async function handler(req) {
  if (isOptions(req)) return jsonResponse({ ok: true });

  try {
    const data = await buildLeaderboard();
    return jsonResponse(data);
  } catch (error) {
    console.error(error);
    return jsonResponse({ ok: false, error: error.message || String(error) }, { status: 500 });
  }
}
