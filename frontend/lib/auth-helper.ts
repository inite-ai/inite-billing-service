/**
 * Auth helper functions for OAuth2 integration
 */

import { decodeJWT, isJWTExpired } from './pkce';

export interface UserSession {
  id: string;
  email: string;
  name: string;
  role: 'USER' | 'ADMIN';
  avatarUrl?: string;
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

export function getIdToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('id_token');
}

export function storeTokens(accessToken: string, idToken: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('access_token', accessToken);
  localStorage.setItem('id_token', idToken);
}

export function clearTokens(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('access_token');
  localStorage.removeItem('id_token');
}

export function isAuthenticated(): boolean {
  const accessToken = getAccessToken();
  if (!accessToken) return false;
  return !isJWTExpired(accessToken);
}

function isAdminFromToken(decoded: Record<string, unknown>): boolean {
  const roles = decoded.roles as string[] | undefined;
  const metadata = decoded.metadata as { isAdmin?: boolean } | undefined;
  return roles?.includes('admin') || metadata?.isAdmin === true;
}

export async function getUserSession(): Promise<UserSession | null> {
  const accessToken = getAccessToken();
  if (!accessToken) {
    return null;
  }
  if (isJWTExpired(accessToken)) {
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });
      if (response.ok) {
        const tokens = await response.json();
        storeTokens(tokens.access_token, tokens.id_token);
        return getUserSessionFromToken(tokens.access_token);
      }
      if (response.status === 401) {
        clearTokens();
      }
    } catch (error) {
      console.error('Failed to refresh token:', error);
      return null;
    }
    return null;
  }
  return getUserSessionFromToken(accessToken);
}

async function getUserSessionFromToken(accessToken: string): Promise<UserSession | null> {
  try {
    const decoded = decodeJWT(accessToken);
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
  let accessToken = getAccessToken();

  if (!accessToken) {
    throw new Error('Authentication required');
  }
  if (isJWTExpired(accessToken)) {
    const refreshResponse = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });
    if (!refreshResponse.ok) {
      if (refreshResponse.status === 401) clearTokens();
      throw new Error('Authentication required');
    }
    const tokens = await refreshResponse.json();
    storeTokens(tokens.access_token, tokens.id_token);
    accessToken = tokens.access_token;
  }

  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
    Authorization: `Bearer ${accessToken}`,
  };

  let response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    const refreshResponse = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });
    if (refreshResponse.ok) {
      const tokens = await refreshResponse.json();
      storeTokens(tokens.access_token, tokens.id_token);
      headers.Authorization = `Bearer ${tokens.access_token}`;
      response = await fetch(url, { ...options, headers });
    } else if (refreshResponse.status === 401) {
      clearTokens();
    }
  }

  return response;
}
