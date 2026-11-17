import { errorResponse, json, methodNotAllowed, readJson } from './_lib/http.mjs';
import { saveSubmission, validSubmission } from './_lib/submissions.mjs';

export async function POST(request) {
  try {
    const record = await readJson(request);
    if (!validSubmission(record)) return json({ error: 'Submission is incomplete or invalid.' }, 400);
    await saveSubmission(record);
    return json({ ok: true }, 201);
  } catch (error) {
    if (error?.status) return errorResponse(error);
    if (error?.statusCode === 409 || error?.code === 'BLOB_ALREADY_EXISTS') return json({ error: 'This submission was already recorded.' }, 409);
    return errorResponse(error);
  }
}

export function GET() { return methodNotAllowed('POST'); }
export function PUT() { return methodNotAllowed('POST'); }
export function DELETE() { return methodNotAllowed('POST'); }
