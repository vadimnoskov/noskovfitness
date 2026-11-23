import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE, tokenFor } from './lib/auth';

export async function proxy(req: NextRequest) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) {
    // Local development may run without a password; a production server never does.
    if (process.env.NODE_ENV === 'production') return new NextResponse('APP_PASSWORD is not set. Add it as a secret, then restart.', { status: 503 });
    return NextResponse.next();
  }
  if (req.nextUrl.pathname === '/login') return NextResponse.next();
  if (req.cookies.get(COOKIE)?.value === (await tokenFor(pw))) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
