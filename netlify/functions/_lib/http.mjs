export function jsonResponse(data, init = {}) {
  const status = init.status || 200;
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-admin-secret',
    ...(init.headers || {})
  };
  return new Response(JSON.stringify(data, null, 2), { status, headers });
}

export function getRequestUrl(req) {
  try {
    return new URL(req.url);
  } catch {
    return new URL(req.url, 'https://local.test');
  }
}

export function isOptions(req) {
  return req.method?.toUpperCase() === 'OPTIONS';
}
