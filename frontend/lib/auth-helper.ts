/**
 * Auth helper functions for OAuth2 integration
 *
 * Tokens are stored in-memory only (never in localStorage).
 * The access_token is managed server-side via httpOnly cookies.
 * The id_token is kept in-memory for client-side user info display.
 */

import { decodeJWT, isJWTExpired } from './pkce';

export interface UserSession {
  id: string;
  email: string;
  name: string;
  role: 'USER' | 'ADMIN';
  avatarUrl?: string;
}

// In-memory token storage — not persisted across page reloads.
// The httpOnly cookie holds the access_token for authenticated requests.
let inMemoryIdToken: string | null = null;

export function getIdToken(): string | null {
  return inMemoryIdToken;
}

export function storeIdToken(idToken: string): void {
  inMemoryIdToken = idToken;
}

export function clearTokens(): void {
  inMemoryIdToken = null;
}

function isAdminFromToken(decoded: Record<string, unknown>): boolean {
  const roles = decoded.roles as string[] | undefined;
  const metadata = decoded.metadata as { isAdmin?: boolean } | undefined;
  return roles?.includes('admin') || metadata?.isAdmin === true;
}

export async function getUserSession(): Promise<UserSession | null> {
  const idToken = getIdToken();

  // If we have an id_token in memory, try to extract user info from it
  if (idToken && !isJWTExpired(idToken)) {
    return getUserSessionFromIdToken(idToken);
  }

  // Try refreshing — the server sets httpOnly cookies and returns id_token
  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });
    if (response.ok) {
      const data = await response.json();
      if (data.id_token) {
        storeIdToken(data.id_token);
        return getUserSessionFromIdToken(data.id_token);
      }
    }
    if (response.status === 401) {
      clearTokens();
      // Server already cleared httpOnly cookies in the 401 response
    }
  } catch (error) {
    console.error('Failed to refresh token:', error);
    return null;
  }

  return null;
}

function getUserSessionFromIdToken(idToken: string): UserSession | null {
  try {
    const decoded = decodeJWT(idToken);
    if (!decoded || !decoded.sub) {
      return null;
    }

    const isAdmin = isAdminFromToken(decoded);

    return {
      id: decoded.sub as string,
      email: (decoded.email as string) || '',
      name: (decoded.name as string) || (decoded.email as string) || '',
      role: isAdmin ? 'ADMIN' : 'USER',
      avatarUrl: decoded.picture as string | undefined,
    };
  } catch (error) {
    console.error('Failed to get user session:', error);
    return null;
  }
}

export async function authenticatedFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  // Send requests with credentials: 'include' so the httpOnly access_token
  // cookie is attached automatically. No need for Authorization header.
  let response = await fetch(url, {
    ...options,
    credentials: 'include',
  });

  if (response.status === 401) {
    const refreshResponse = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });
    if (refreshResponse.ok) {
      const data = await refreshResponse.json();
      if (data.id_token) {
        storeIdToken(data.id_token);
      }
      response = await fetch(url, {
        ...options,
        credentials: 'include',
      });
    } else if (refreshResponse.status === 401) {
      clearTokens();
    }
  }

  return response;
}
