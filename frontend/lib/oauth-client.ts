/**
 * OAuth2 Client for INITE Auth Service
 * Handles authorization code flow with PKCE
 */

import { generateCodeVerifier, generateCodeChallenge, generateState } from './pkce';
import { clearTokens } from './auth-helper';
import { LOCALE_COOKIE, supportedLocale, type AppLocale } from '@/i18n/locales';

const AUTH_DOMAIN = process.env.NEXT_PUBLIC_AUTH_SERVICE_URL || 'https://auth.inite.ai';
const CLIENT_ID = process.env.NEXT_PUBLIC_OAUTH_CLIENT_ID || 'inite-billing';

export interface TokenResponse {
  id_token: string;
  expires_in: number;
}

export interface CallbackResult extends TokenResponse {
  /** Where the sign-in was started from, as `login({ returnTo })` recorded it. */
  returnTo: string | null;
}

/** Set while a silent (`prompt=none`) attempt is in flight, so the callback knows to fall back. */
const SILENT_KEY = 'oauth_silent'

/**
 * A sign-in in flight, by its `state`, in localStorage: `inite_signin:<state>`
 * → `{ v: code_verifier, r: returnTo, t: started at }`.
 *
 * sessionStorage alone belongs to one tab. A magic link from the sign-in email
 * opens in a new tab, which reached /callback with no verifier, no state and
 * no returnTo: the code could not be exchanged, the buyer was asked to sign in
 * again, and that second sign-in ended on /dashboard instead of the checkout
 * they had started from. localStorage is shared by every tab of this origin.
 */
const PENDING_PREFIX = 'inite_signin:'
/** As long as a magic link or a slow sign-in can reasonably take. */
const PENDING_TTL_MS = 30 * 60 * 1000

interface PendingSignIn {
  v: string
  r: string | null
  t: number
}

function readPending(state: string): PendingSignIn | null {
  try {
    const raw = localStorage.getItem(PENDING_PREFIX + state)
    if (!raw) return null
    const pending = JSON.parse(raw) as Partial<PendingSignIn>
    if (typeof pending.v !== 'string' || typeof pending.t !== 'number') return null
    if (Date.now() - pending.t > PENDING_TTL_MS) return null
    return { v: pending.v, r: typeof pending.r === 'string' ? pending.r : null, t: pending.t }
  } catch {
    return null
  }
}

function forgetPending(state: string): void {
  try {
    localStorage.removeItem(PENDING_PREFIX + state)
  } catch {
    // storage unavailable — nothing was kept
  }
}

/** Store this sign-in, and drop the expired ones so abandoned attempts do not pile up. */
function keepPending(state: string, pending: PendingSignIn): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (key?.startsWith(PENDING_PREFIX) && !readPending(key.slice(PENDING_PREFIX.length))) {
        localStorage.removeItem(key)
      }
    }
    localStorage.setItem(PENDING_PREFIX + state, JSON.stringify(pending))
  } catch {
    // Private mode or a full quota: the same-tab sessionStorage path still works.
  }
}

/** What the identity provider answers a silent attempt that needs the person. */
export const SILENT_SSO_ERRORS = ['login_required', 'interaction_required', 'consent_required', 'account_selection_required']

/**
 * The language the buyer is reading right now: the page's `<html lang>`
 * (next-intl's locale for this render, which already honours `?locale=`),
 * then the `locale` cookie. Null when neither names a supported language —
 * the identity provider then falls back to its own cookie / the browser.
 */
export function currentUiLocale(): AppLocale | null {
  if (typeof document === 'undefined') return null
  const fromPage = supportedLocale(document.documentElement?.lang)
  if (fromPage) return fromPage
  const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]+)`))
  return supportedLocale(match ? decodeURIComponent(match[1]) : null)
}

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
  static async login({
    interactive = false,
    returnTo,
  }: { interactive?: boolean; returnTo?: string | null } = {}): Promise<void> {
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
      // The way back travels with the sign-in, so whichever tab finishes it
      // (a magic link opens a new one) returns to the checkout.
      const back = returnTo ?? sessionStorage.getItem('returnTo');
      if (returnTo) sessionStorage.setItem('returnTo', returnTo);
      keepPending(state, { v: codeVerifier, r: back, t: Date.now() });
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
    // OIDC ui_locales: the INITE login page opens in the checkout's language.
    const uiLocale = currentUiLocale();
    if (uiLocale) params.set('ui_locales', uiLocale);

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

  static async handleCallback(code: string, state: string): Promise<CallbackResult> {
    if (typeof window === 'undefined') {
      throw new Error('Window is not defined');
    }

    // This tab started the sign-in, or another tab of this origin did (a
    // magic link opens a new one). A state nobody here started is refused.
    const pending = state ? readPending(state) : null;
    const sameTab = !!state && state === sessionStorage.getItem('oauth_state');
    if (!sameTab && !pending) {
      throw new Error('State mismatch - possible CSRF attack');
    }

    const codeVerifier = (sameTab ? sessionStorage.getItem('code_verifier') : null) ?? pending?.v;
    if (!codeVerifier) {
      throw new Error('Code verifier not found');
    }
    // One use: a replayed callback finds nothing to exchange with.
    forgetPending(state);

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

    return { ...tokens, returnTo: pending?.r ?? null };
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
