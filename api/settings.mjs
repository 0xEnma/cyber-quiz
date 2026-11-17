import { errorResponse, json, methodNotAllowed } from './_lib/http.mjs';
import { MAX_QUESTIONS, readQuizSettings } from './_lib/quiz-settings.mjs';

export async function GET() {
  try { return json({ ...await readQuizSettings(), maxQuestions: MAX_QUESTIONS }); }
  catch (error) { return errorResponse(error); }
}

export function POST() { return methodNotAllowed('GET'); }
export function PUT() { return methodNotAllowed('GET'); }
export function DELETE() { return methodNotAllowed('GET'); }

