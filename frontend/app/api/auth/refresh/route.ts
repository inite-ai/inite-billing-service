import { NextRequest, NextResponse } from 'next/server';

const AUTH_DOMAIN = process.env.AUTH_SERVICE_URL || process.env.NEXT_PUBLIC_AUTH_SERVICE_URL || 'https://auth.inite.ai';
const CLIENT_ID = process.env.OAUTH_CLIENT_ID || process.env.NEXT_PUBLIC_OAUTH_CLIENT_ID || 'inite-billing';
const CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET;

export async function POST(request: NextRequest) {
  if (!CLIENT_SECRET) {
    return NextResponse.json({ error: 'OAuth configuration error' }, { status: 500 });
  }

  try {
    const refreshToken = request.cookies.get('refresh_token')?.value;

    if (!refreshToken) {
      const response = NextResponse.json(
        { error: 'No refresh token found' },
        { status: 401 }
      );
      // Clear stale access_token so middleware stops treating user as authenticated
      response.cookies.set('access_token', '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 0,
        path: '/',
      });
      return response;
    }

    const tokenResponse = await fetch(`${AUTH_DOMAIN}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.json();
      // Log the full error server-side only — never expose to the client
      console.error('Token refresh failed:', error);

      const response = NextResponse.json(
        { error: 'Token refresh failed' },
        { status: tokenResponse.status }
      );

      response.cookies.delete('refresh_token');
      // Clear stale access_token so middleware stops treating user as authenticated
      response.cookies.set('access_token', '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 0,
        path: '/',
      });
      return response;
    }

    const tokens = await tokenResponse.json();

    // Do not return access_token in the response body — it is set as an
    // httpOnly cookie below, which is the only secure transport for it.
    const response = NextResponse.json({
      id_token: tokens.id_token,
      expires_in: tokens.expires_in,
    });

    response.cookies.set('access_token', tokens.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: tokens.expires_in || 3600,
      path: '/',
    });

    if (tokens.refresh_token) {
      response.cookies.set('refresh_token', tokens.refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 24 * 60 * 60,
      });
    }

    return response;
  } catch (error) {
    console.error('Token refresh error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
