import { changePin } from '../_lib/auth.mjs';
import { methodNotAllowed } from '../_lib/http.mjs';

export async function POST(request) { return changePin(request); }
export function GET() { return methodNotAllowed('POST'); }
export function PUT() { return methodNotAllowed('POST'); }
export function DELETE() { return methodNotAllowed('POST'); }
