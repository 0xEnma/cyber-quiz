import { errorResponse, json, methodNotAllowed } from '../_lib/http.mjs';
import { isAdmin, unauthorized } from '../_lib/auth.mjs';
import { clearSubmissions, getSubmissions } from '../_lib/submissions.mjs';

export async function GET(request) {
  try {
    if (!isAdmin(request)) return unauthorized();
    return json(await getSubmissions());
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request) {
  try {
    if (!isAdmin(request)) return unauthorized();
    await clearSubmissions();
    return json({ ok: true });
  } catch (error) { return errorResponse(error); }
}

export function POST() { return methodNotAllowed('GET, DELETE'); }
export function PUT() { return methodNotAllowed('GET, DELETE'); }
