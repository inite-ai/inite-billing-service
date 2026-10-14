import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getUserToken, shouldRedirectFromAuth, getUserDestination, checkRouteAccess, CLIENT_AUTH_ROUTES } from './lib/middleware/auth';
import { LOCALE_COOKIE, LOCALE_HEADER, supportedLocale } from './i18n/locales';

function redirect(request: NextRequest, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, request.url));
}

function shouldSkipMiddleware(pathname: string): boolean {
  return (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/images') ||
    pathname.includes('.')
  );
}

/**
 * `?locale=pt` on any page (a store sends its buyer to `/checkout/<id>?locale=pt`):
 * this render uses it — passed to i18n/request.ts as a request header, since a
 * cookie set here is only seen by the next request — and the cookie keeps it.
 */
export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (shouldSkipMiddleware(pathname)) {
    return NextResponse.next();
  }

  const locale = supportedLocale(request.nextUrl.searchParams.get('locale'));
  const response = await route(request, locale);
  if (locale) {
    response.cookies.set(LOCALE_COOKIE, locale, { path: '/', maxAge: 31536000, sameSite: 'lax' });
  }
  return response;
}

async function route(request: NextRequest, locale: string | null): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(LOCALE_HEADER);
  if (locale) requestHeaders.set(LOCALE_HEADER, locale);
  const next = () => NextResponse.next({ request: { headers: requestHeaders } });

  const token = await getUserToken(request);

  // Redirect logged-in users from login page to dashboard (or returnTo)
  if (pathname === '/login' && shouldRedirectFromAuth(token)) {
    const returnTo = request.nextUrl.searchParams.get('returnTo');
    // Only allow same-origin, absolute internal paths. Reject protocol-relative
    // (`//evil.com`) and backslash (`/\evil.com`) forms that resolve off-origin.
    if (
      returnTo &&
      returnTo.startsWith('/') &&
      !returnTo.startsWith('//') &&
      !returnTo.startsWith('/\\')
    ) {
      return redirect(request, returnTo);
    }
    const destination = getUserDestination(token!);
    return redirect(request, destination);
  }

  // Client-auth routes handle auth themselves (auto-trigger OAuth)
  const isClientAuth = CLIENT_AUTH_ROUTES.some(r => pathname.startsWith(r));
  if (isClientAuth) {
    return next();
  }

  // Check route access
  const access = checkRouteAccess(token, pathname);
  if (!access.allowed && access.redirectTo) {
    return redirect(request, access.redirectTo);
  }

  const response = next();

  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'origin-when-cross-origin');
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.headers.set('X-XSS-Protection', '1; mode=block');

  return response;
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|images|favicon).*)',
  ],
};
