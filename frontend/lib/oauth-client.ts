/**
 * OAuth2 Client for INITE Auth Service
 * Handles authorization code flow with PKCE
 */

import { generateCodeVerifier, generateCodeChallenge, generateState } from './pkce';
import { clearTokens } from './auth-helper';

const AUTH_DOMAIN = process.env.NEXT_PUBLIC_AUTH_SERVICE_URL || 'https://auth.inite.ai';
const CLIENT_ID = process.env.NEXT_PUBLIC_OAUTH_CLIENT_ID || 'inite-billing';

export interface TokenResponse {
  id_token: string;
  expires_in: number;
}

export class OAuthClient {
  static async login(): Promise<void> {
    // Always clear existing session before starting new login
    clearTokens();
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore — clearing old cookies is best-effort
    }

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateState();

    if (typeof window !== 'undefined') {
      sessionStorage.setItem('code_verifier', codeVerifier);
      sessionStorage.setItem('oauth_state', state);
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: `${window.location.origin}/callback`,
      scope: 'openid profile email offline_access',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    window.location.href = `${AUTH_DOMAIN}/oauth/authorize?${params}`;
  }

  static async handleCallback(code: string, state: string): Promise<TokenResponse> {
    if (typeof window === 'undefined') {
      throw new Error('Window is not defined');
    }

    const savedState = sessionStorage.getItem('oauth_state');
    if (state !== savedState) {
      throw new Error('State mismatch - possible CSRF attack');
    }

    const codeVerifier = sessionStorage.getItem('code_verifier');
    if (!codeVerifier) {
      throw new Error('Code verifier not found');
    }

    const response = await fetch('/api/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        code_verifier: codeVerifier,
        redirect_uri: `${window.location.origin}/callback`,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Token exchange failed');
    }

    const tokens = await response.json();

    sessionStorage.removeItem('code_verifier');
    sessionStorage.removeItem('oauth_state');

    return tokens;
  }

  static async refreshToken(): Promise<TokenResponse> {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error('Token refresh failed');
    }

    return await response.json();
  }

  static async logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' });

    const params = new URLSearchParams({
      post_logout_redirect_uri: window.location.origin,
    });

    window.location.href = `${AUTH_DOMAIN}/oauth/logout?${params}`;
  }
}
