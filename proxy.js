import { NextResponse } from 'next/server';

// One shared password for the whole team. Not per-user accounts, but enough
// that a stranger who finds the URL cannot start runs that publish to live
// sites and spend API credit.
export default function proxy(request) {
  const { pathname } = request.nextUrl;
  const open = pathname.startsWith('/login') || pathname.startsWith('/api/login') || pathname.startsWith('/_next');
  if (open) return NextResponse.next();

  const password = process.env.CONSOLE_PASSWORD;
  if (!password) return NextResponse.next(); // unset: local development

  const cookie = request.cookies.get('console')?.value;
  if (cookie === password) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  return NextResponse.redirect(url);
}

export const config = { matcher: ['/((?!favicon.ico).*)'] };
