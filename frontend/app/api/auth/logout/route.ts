import { NextRequest, NextResponse } from 'next/server';
import { DEMO_SESSION_COOKIE } from '@/lib/demo';
import { safeReturnTo } from '@/lib/safe-redirect';

/** Every cookie a session leaves, the demo's readable one included. */
function clearSession(response: NextResponse): NextResponse {
  const secure = process.env.NODE_ENV === 'production';
  response.cookies.set('access_token', '', {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });

  response.cookies.set('refresh_token', '', {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });

  response.cookies.set(DEMO_SESSION_COOKIE, '', {
    httpOnly: false,
    secure,
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  return response;
}

export async function POST() {
  try {
    return clearSession(NextResponse.json({ success: true }));
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * `GET /api/auth/logout?return_to=/path`: the demo banner's «Leave the demo».
 * A demo session holds no session at auth, so it only clears this site's
 * cookies and lands on a path here.
 */
export async function GET(request: NextRequest) {
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get('return_to'), '/');
  return clearSession(NextResponse.redirect(new URL(returnTo, request.url), { status: 303 }));
}
