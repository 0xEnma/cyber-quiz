import QRCode from 'qrcode';
import { isAdmin, unauthorized } from '../_lib/auth.mjs';
import { errorResponse, methodNotAllowed } from '../_lib/http.mjs';

export async function POST(request) {
  try {
    if (!(await isAdmin(request))) return unauthorized();
    let body;
    try { body = await request.json(); }
    catch { return Response.json({ error: 'Invalid request.' }, { status: 400 }); }
    if (typeof body?.ticket !== 'string' || !/^[A-Za-z0-9_.-]{40,300}$/.test(body.ticket)) {
      return Response.json({ error: 'A valid test link is required.' }, { status: 400 });
    }
    const link = new URL('/', request.url);
    link.searchParams.set('ticket', body.ticket);
    const png = await QRCode.toBuffer(link.href, { type: 'png', width: 512, margin: 2, errorCorrectionLevel: 'M' });
    return new Response(png, {
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': 'attachment; filename="bankshield-test-qr.png"',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) { return errorResponse(error); }
}

export function GET() { return methodNotAllowed('POST'); }
export function PUT() { return methodNotAllowed('POST'); }
export function DELETE() { return methodNotAllowed('POST'); }
