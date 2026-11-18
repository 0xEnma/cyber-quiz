import { errorResponse, json, methodNotAllowed, readJson } from './_lib/http.mjs';
import { resolveTicket } from './_lib/tests.mjs';

export async function POST(request) {
  try {
    const body = await readJson(request, 1000);
    const result = await resolveTicket(body?.ticket);
    return result ? json(result) : json({ error: 'That test access code is invalid or inactive.' }, 404);
  } catch (error) { return errorResponse(error); }
}
export function GET() { return methodNotAllowed('POST'); }
export function PUT() { return methodNotAllowed('POST'); }
export function DELETE() { return methodNotAllowed('POST'); }
