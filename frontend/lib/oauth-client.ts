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

/** Set while a silent (`prompt=none`) attempt is in flight, so the callback knows to fall back. */
const SILENT_KEY = 'oauth_silent'

/** What the identity provider answers a silent attempt that needs the person. */
export const SILENT_SSO_ERRORS = ['login_required', 'interaction_required', 'consent_required', 'account_selection_required']

export class OAuthClient {
  /**
   * Sign in through auth.inite.ai.
   *
   * By default it first tries silently (`prompt=none`): someone already
   * signed in to INITE — on the landing, or on a sibling product that uses
   * the same identity — comes straight back with a code, no login form and
   * no consent screen. Only if the provider answers that it needs the person
   * does the callback start the ordinary, interactive sign-in. The redirect
   * is top-level, so the provider's session cookie is first-party and this
   * works from any domain, not just *.inite.ai.
   */
  static async login({ interactive = false }: { interactive?: boolean } = {}): Promise<void> {
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
      if (interactive) sessionStorage.removeItem(SILENT_KEY);
      else sessionStorage.setItem(SILENT_KEY, '1');
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
    if (!interactive) params.set('prompt', 'none');

    // Off to the identity provider — a different origin, and deliberately a
    // full navigation. The lint rule cannot tell that AUTH_DOMAIN is absolute.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `${AUTH_DOMAIN}/oauth/authorize?${params}`;
  }

  /**
   * After a silent attempt the provider could not complete: true when the
   * callback should start the interactive sign-in instead of showing an
   * error. Consumes the marker, so a failed interactive sign-in is not
   * retried in a loop.
   */
  static shouldFallBackToInteractive(error: string | null | undefined): boolean {
    if (typeof window === 'undefined') return false;
    const silent = sessionStorage.getItem(SILENT_KEY) === '1';
    sessionStorage.removeItem(SILENT_KEY);
    return silent && !!error && SILENT_SSO_ERRORS.includes(error);
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
    sessionStorage.removeItem(SILENT_KEY);

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

    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `${AUTH_DOMAIN}/oauth/logout?${params}`;
  }
}
