import { errorResponse, methodNotAllowed } from '../_lib/http.mjs';
import { signOut } from '../_lib/auth.mjs';

export function POST() {
  try { return signOut(); }
  catch (error) { return errorResponse(error); }
}

export function GET() { return methodNotAllowed('POST'); }
