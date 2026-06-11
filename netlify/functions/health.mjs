import { jsonResponse } from './_lib/http.mjs';
import { getOptionalConfigStatus } from './_lib/config.mjs';

export default async function handler() {
  return jsonResponse({ ok: true, env: getOptionalConfigStatus(), time: new Date().toISOString() });
}
