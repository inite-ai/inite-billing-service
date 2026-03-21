import { NextRequest, NextResponse } from 'next/server';

const AUTH_DOMAIN = process.env.AUTH_SERVICE_URL || process.env.NEXT_PUBLIC_AUTH_SERVICE_URL || 'https://auth.inite.ai';
const CLIENT_ID = process.env.OAUTH_CLIENT_ID || process.env.NEXT_PUBLIC_OAUTH_CLIENT_ID || 'inite-billing';
const CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { code, code_verifier, redirect_uri } = body;

    if (!code || !code_verifier || !redirect_uri) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    const params: Record<string, string> = {
      grant_type: 'authorization_code',
      code,
      redirect_uri,
      client_id: CLIENT_ID,
      code_verifier,
    };
    if (CLIENT_SECRET) {
      params.client_secret = CLIENT_SECRET;
    }

    const tokenResponse = await fetch(`${AUTH_DOMAIN}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.json();
      return NextResponse.json(
        { error: error.error_description || 'Token exchange failed' },
        { status: tokenResponse.status }
      );
    }

    const tokens = await tokenResponse.json();
    const { access_token, id_token, expires_in, refresh_token } = tokens;

    // Do not return access_token in the response body — it is set as an
    // httpOnly cookie below, which is the only secure transport for it.
    const response = NextResponse.json({
      id_token,
      expires_in,
    });

    response.cookies.set('access_token', access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: expires_in,
      path: '/',
    });

    if (refresh_token) {
      response.cookies.set('refresh_token', refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 24 * 60 * 60,
      });
    }

    return response;
  } catch (error) {
    console.error('Token exchange error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
