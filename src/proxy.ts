import { NextResponse, type NextRequest } from 'next/server';

/**
 * Runs before every page request:
 *  1. Generates a per-request nonce and a strict Content-Security-Policy, so
 *     only scripts issued by this server can execute (XSS mitigation).
 *  2. Tags the request with an ID that is carried into audit records.
 *  3. Optimistically redirects visitors without a session cookie to /login.
 *     This is a convenience only: the real session check happens in the data
 *     access layer (src/server/auth/dal.ts) for every page, action and API route.
 */
const PUBLIC_PATHS = ['/login', '/register', '/api/health', '/api/cron'];
const SESSION_COOKIE = 'cirp_session';

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';
  // HTTPS deployments upgrade any stray http:// sub-resource. Disabled when
  // SECURE_COOKIES=false (plain-HTTP demos on a LAN).
  const httpsOnly = !isDev && process.env.SECURE_COOKIES !== 'false';

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-inline'" : ''}`,
    // Inline style *attributes* (chart geometry, progress bars) cannot run code.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(httpsOnly ? ['upgrade-insecure-requests'] : []),
  ].join('; ');

  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!isPublic && !request.cookies.has(SESSION_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  requestHeaders.set('x-request-id', crypto.randomUUID());

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico|webp)$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
