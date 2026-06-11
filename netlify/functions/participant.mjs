import { jsonResponse, getRequestUrl, isOptions } from './_lib/http.mjs';
import { buildParticipantBets } from './_lib/leaderboardBuilder.mjs';

export default async function handler(req) {
  if (isOptions(req)) return jsonResponse({ ok: true });

  try {
    const url = getRequestUrl(req);
    const participantKey = url.searchParams.get('participant') || url.searchParams.get('participantKey') || '';
    const phase = url.searchParams.get('phase') || 'group';

    if (!participantKey) {
      return jsonResponse({ ok: false, error: 'Missing participant query parameter.' }, { status: 400 });
    }

    const data = await buildParticipantBets(participantKey, { phase });
    return jsonResponse(data, { status: data.ok === false ? 404 : 200 });
  } catch (error) {
    console.error(error);
    return jsonResponse({ ok: false, error: error.message || String(error) }, { status: 500 });
  }
}
