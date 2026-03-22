import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getUserToken, shouldRedirectFromAuth, getUserDestination, checkRouteAccess } from './lib/middleware/auth';

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

  // Check route access
  const access = checkRouteAccess(token, pathname);
  if (!access.allowed && access.redirectTo) {
    return redirect(request, access.redirectTo);
  }

  const response = NextResponse.next();

  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'origin-when-cross-origin');
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');

  return response;
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|images|favicon).*)',
  ],
};
