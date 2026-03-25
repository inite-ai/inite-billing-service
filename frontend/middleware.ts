import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getUserToken, shouldRedirectFromAuth, getUserDestination, checkRouteAccess, CLIENT_AUTH_ROUTES } from './lib/middleware/auth';

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

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (shouldSkipMiddleware(pathname)) {
    return NextResponse.next();
  }

  const token = await getUserToken(request);

  // Redirect logged-in users from login page to dashboard (or returnTo)
  if (pathname === '/login' && shouldRedirectFromAuth(token)) {
    const returnTo = request.nextUrl.searchParams.get('returnTo');
    if (returnTo && returnTo.startsWith('/')) {
      return redirect(request, returnTo);
    }
    const destination = getUserDestination(token!);
    return redirect(request, destination);
  }

  // Client-auth routes handle auth themselves (auto-trigger OAuth)
  const isClientAuth = CLIENT_AUTH_ROUTES.some(r => pathname.startsWith(r));
  if (isClientAuth) {
    return NextResponse.next();
  }

  // Check route access
  const access = checkRouteAccess(token, pathname);
  if (!access.allowed && access.redirectTo) {
    return redirect(request, access.redirectTo);
  }

  const response = NextResponse.next();

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
