'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { UserSession } from '@/lib/auth-helper';
import { getUserSession, clearTokens } from '@/lib/auth-helper';

interface AuthContextType {
  user: UserSession | null;
  isLoading: boolean;
  refreshSession: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshSession = async () => {
    try {
      const session = await getUserSession();
      setUser(session);
    } catch (error) {
      console.error('Failed to refresh session:', error);
      setUser(null);
    }
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      clearTokens();
      setUser(null);

      const AUTH_DOMAIN = process.env.NEXT_PUBLIC_AUTH_SERVICE_URL || 'https://auth.inite.ai';
      window.location.href = `${AUTH_DOMAIN}/oauth/logout?post_logout_redirect_uri=${window.location.origin}`;
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  useEffect(() => {
    getUserSession()
      .then((session) => {
        setUser(session);
      })
      .catch((error) => {
        console.error('Failed to load session:', error);
        setUser(null);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, refreshSession, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
