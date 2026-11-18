import { errorResponse, json, methodNotAllowed, readJson } from './_lib/http.mjs';
import { isAdmin, unauthorized } from './_lib/auth.mjs';
import { createTest, deleteTest, listTests } from './_lib/tests.mjs';

export async function GET(request) {
  try { if (!(await isAdmin(request))) return unauthorized(); return json(await listTests()); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request) {
  try { if (!(await isAdmin(request))) return unauthorized(); return json(await createTest(await readJson(request)), 201); }
  catch (error) { return errorResponse(error); }
}
export async function DELETE(request) {
  try {
    if (!(await isAdmin(request))) return unauthorized();
    const id = new URL(request.url).searchParams.get('id');
    return await deleteTest(id) ? json({ ok: true }) : json({ error: 'Test not found.' }, 404);
  } catch (error) { return errorResponse(error); }
}
export function PUT() { return methodNotAllowed('GET, POST, DELETE'); }
