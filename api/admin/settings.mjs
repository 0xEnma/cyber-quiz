import { errorResponse, json, methodNotAllowed, readJson } from '../_lib/http.mjs';
import { isAdmin, unauthorized } from '../_lib/auth.mjs';
import { MAX_QUESTIONS, readQuizSettings, writeQuizSettings } from '../_lib/quiz-settings.mjs';

export async function GET(request) {
  try {
    if (!(await isAdmin(request))) return unauthorized();
    return json({ ...await readQuizSettings(), maxQuestions: MAX_QUESTIONS });
  } catch (error) { return errorResponse(error); }
}

export async function PUT(request) {
  try {
    if (!(await isAdmin(request))) return unauthorized();
    const body = await readJson(request);
    return json(await writeQuizSettings({
      questionCount: Number(body?.questionCount),
      timeLimitMinutes: Number(body?.timeLimitMinutes),
    }));
  } catch (error) { return errorResponse(error); }
}

export function POST() { return methodNotAllowed('GET, PUT'); }
export function DELETE() { return methodNotAllowed('GET, PUT'); }

