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
    const { snapshotTestsForPool } = await import('./_lib/tests.mjs');
    await snapshotTestsForPool(id);
    return await deletePool(id) ? json({ ok: true }) : json({ error: 'Question pool not found.' }, 404);
  } catch (error) {
    console.error('[api/pools DELETE] Pool removal failed.', error);
    return errorResponse(error);
  }
}

export async function PUT(request) {
  try {
    if (!(await isAdmin(request))) return unauthorized();
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return json({ error: 'Question pool ID is required.' }, 400);
    const input = await readJson(request, 4_000_000);
    const { testsForPool } = await import('./_lib/tests.mjs');
    const tests = await testsForPool(id);
    if (Array.isArray(input.questions) && tests.some(test => test.questionCount > input.questions.length)) {
      return json({ error: 'This change would leave too few questions for an existing test link. Revoke that link first or keep enough questions in the pool.' }, 409);
    }
    return json(await updatePool(id, input));
  } catch (error) {
    if (error?.details) return json({ error: error.message, details: error.details }, 400);
    return errorResponse(error);
  }
}
