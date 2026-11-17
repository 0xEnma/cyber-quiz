export function json(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
  });
}

export async function readJson(request, maxBytes = 1_000_000) {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) throw Object.assign(new Error('Request too large.'), { status: 413 });
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) throw Object.assign(new Error('Request too large.'), { status: 413 });
  try { return JSON.parse(raw); }
  catch { throw Object.assign(new Error('Invalid JSON.'), { status: 400 }); }
}

export function errorResponse(error) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  if (status >= 500) console.error(error);
  return json({ error: status >= 500 ? 'Server error.' : error.message }, status);
}

export function methodNotAllowed(allow) {
  return json({ error: 'Method not allowed.' }, 405, { Allow: allow });
}
