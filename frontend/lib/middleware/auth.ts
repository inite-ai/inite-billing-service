/**
 * Authentication middleware helpers
 *
 * NOTE: The JWT decode here is used for routing/UX decisions only (e.g.,
 * redirecting unauthenticated users to login, or showing admin routes).
 * It does NOT constitute server-side auth validation. All actual
 * authorization is enforced by the backend, which properly validates
 * JWT signatures. This client-side decode is acceptable for middleware
 * routing because the worst case is a UX mismatch, not a security bypass.
 */

import { decodeJWT, isJWTExpired } from '../pkce';

export interface UserToken {
  id: string;
  email: string;
  name: string;
  role: 'USER' | 'ADMIN';
}

function parseCookies(cookieHeader: string): Record<string, string> {
  return Object.fromEntries(
    cookieHeader.split(';').map(c => {
      const [key, ...rest] = c.trim().split('=');
      return [key, rest.join('=')];
    })
  );
}

function isAdminFromToken(decoded: Record<string, unknown>): boolean {
  const roles = decoded.roles as string[] | undefined;
  const metadata = decoded.metadata as { isAdmin?: boolean } | undefined;
  return roles?.includes('admin') || metadata?.isAdmin === true;
}

export async function getUserToken(request: Request): Promise<UserToken | null> {
  const cookieHeader = request.headers.get('cookie');
  let accessTokenFromCookie = null;

  if (cookieHeader) {
    const cookies = parseCookies(cookieHeader);
    accessTokenFromCookie = cookies['access_token'] || null;
  }

  const authHeader = request.headers.get('authorization');
  const accessTokenFromHeader = authHeader?.startsWith('Bearer ')
    ? authHeader.substring(7)
    : null;

  const accessToken = accessTokenFromCookie || accessTokenFromHeader;

  if (!accessToken) {
    return null;
  }

  if (isJWTExpired(accessToken)) {
    return null;
  }

  const decoded = decodeJWT(accessToken);
  if (!decoded) {
    return null;
  }

  const isAdmin = isAdminFromToken(decoded);

  return {
    id: decoded.sub,
    email: decoded.email,
    name: decoded.name,
    role: isAdmin ? 'ADMIN' : 'USER',
  };
}

export function shouldRedirectFromAuth(token: UserToken | null): boolean {
  return token !== null;
}

export function getUserDestination(token: UserToken): string {
  if (token.role === 'ADMIN') {
    return '/admin';
  }
  return '/dashboard';
}

const PROTECTED_ROUTES: Record<string, Array<'USER' | 'ADMIN'>> = {
  '/dashboard': ['USER', 'ADMIN'],
  '/catalog': ['USER', 'ADMIN'],
  '/orders': ['USER', 'ADMIN'],
  '/subscriptions': ['USER', 'ADMIN'],
  '/referrals': ['USER', 'ADMIN'],
  '/admin': ['ADMIN'],
};

// Routes that handle auth on the client side (auto-trigger OAuth if needed)
export const CLIENT_AUTH_ROUTES = ['/checkout'];

export function checkRouteAccess(
  token: UserToken | null,
  pathname: string
): { allowed: boolean; redirectTo?: string } {
  const protectedRoute = Object.keys(PROTECTED_ROUTES).find(route =>
    pathname.startsWith(route)
  );

  if (!protectedRoute) {
    return { allowed: true };
  }

  if (!token) {
    return { allowed: false, redirectTo: `/login?returnTo=${encodeURIComponent(pathname)}` };
  }

  const allowedRoles = PROTECTED_ROUTES[protectedRoute];
  if (!allowedRoles.includes(token.role)) {
    return { allowed: false, redirectTo: '/dashboard' };
  }

  return { allowed: true };
}
