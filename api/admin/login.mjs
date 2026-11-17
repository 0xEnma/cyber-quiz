import { errorResponse, methodNotAllowed } from '../_lib/http.mjs';
import { signIn } from '../_lib/auth.mjs';

export async function POST(request) {
  try { return await signIn(request); }
  catch (error) { return errorResponse(error); }
}

export function GET() { return methodNotAllowed('POST'); }
