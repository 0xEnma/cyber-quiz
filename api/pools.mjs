import { errorResponse, json, readJson } from './_lib/http.mjs';
import { isAdmin, unauthorized } from './_lib/auth.mjs';
import { deletePool, listPools, readPool, savePool, updatePool } from './_lib/pools.mjs';

export async function GET(request) {
  try {
    if (!(await isAdmin(request))) return unauthorized();
    const id = new URL(request.url).searchParams.get('id');
    if (id) {
      const pool = await readPool(id);
      return pool ? json(pool) : json({ error: 'Question pool not found.' }, 404);
    }
    return json(await listPools());
  } catch (error) { return errorResponse(error); }
}

export async function POST(request) {
  try {
    if (!(await isAdmin(request))) return unauthorized();
    const input = await readJson(request, 4_000_000);
    return json(await savePool(input), 201);
  } catch (error) {
    if (error?.details) return json({ error: error.message, details: error.details }, 400);
    return errorResponse(error);
  }
}

export async function DELETE(request) {
  try {
    if (!(await isAdmin(request))) return unauthorized();
    const id = new URL(request.url).searchParams.get('id');
    const { testsForPool } = await import('./_lib/tests.mjs');
    if ((await testsForPool(id)).length) return json({ error: 'Revoke the test codes for this pool before removing it.' }, 409);
    return await deletePool(id) ? json({ ok: true }) : json({ error: 'Question pool not found.' }, 404);
  } catch (error) { return errorResponse(error); }
}

export async function PUT(request) {
  try {
    if (!(await isAdmin(request))) return unauthorized();
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return json({ error: 'Question pool ID is required.' }, 400);
    return json(await updatePool(id, await readJson(request, 4_000_000)));
  } catch (error) {
    if (error?.details) return json({ error: error.message, details: error.details }, 400);
    return errorResponse(error);
  }
}
