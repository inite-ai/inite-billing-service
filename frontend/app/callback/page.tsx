'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Check, Loader2, X } from 'lucide-react';
import { LedgerShell } from '@/components/ledger/LedgerShell';
import { OAuthClient } from '@/lib/oauth-client';
import { storeIdToken, clearTokens } from '@/lib/auth-helper';
import { safeReturnTo } from '@/lib/safe-redirect';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslations } from 'next-intl';

function CallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refreshSession } = useAuth();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const t = useTranslations('callback');

  useEffect(() => {
    let handled = false;

    const handleCallback = async () => {
      if (handled) return;
      handled = true;

      try {
        const code = searchParams?.get('code');
        const state = searchParams?.get('state');
        const errorParam = searchParams?.get('error');
        const errorDescription = searchParams?.get('error_description');

        if (errorParam) {
          // The silent attempt found no INITE session (or needs the person):
          // carry on with the ordinary sign-in rather than show an error.
          if (OAuthClient.shouldFallBackToInteractive(errorParam)) {
            await OAuthClient.login({ interactive: true });
            return;
          }
          throw new Error(errorDescription || errorParam);
        }

        if (!code || !state) {
          throw new Error('Missing authorization code or state');
        }

        // Clear any existing session before storing new tokens
        clearTokens();
        await fetch('/api/auth/logout', { method: 'POST' });

        const tokens = await OAuthClient.handleCallback(code, state);
        if (tokens.id_token) {
          storeIdToken(tokens.id_token);
        }
        await refreshSession();

        setStatus('success');

        setTimeout(() => {
          const requested = searchParams?.get('returnTo') || sessionStorage.getItem('returnTo');
          sessionStorage.removeItem('returnTo');
          router.push(safeReturnTo(requested));
        }, 1500);
      } catch (err) {
        console.error('OAuth callback error:', err);
        setError(err instanceof Error ? err.message : 'Authentication failed');
        setStatus('error');

        setTimeout(() => {
          router.push('/login');
        }, 3000);
      }
    };

    handleCallback();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const title = status === 'loading' ? t('authenticating') : status === 'success' ? t('success') : t('failed');
  const hint = status === 'loading' ? t('pleaseWait') : status === 'success' ? t('successMessage') : error || t('failedMessage');

  return (
    <LedgerShell>
      <div className="panel rise w-full max-w-[420px] p-9 text-center" role={status === 'error' ? 'alert' : 'status'} aria-live="polite">
        <div className={`badge-ic ${status === 'success' ? 'ok' : status === 'error' ? 'bad' : ''}`}>
          {status === 'loading' && <Loader2 className="h-6 w-6 animate-spin text-[color:var(--accent)]" />}
          {status === 'success' && <Check className="h-6 w-6" />}
          {status === 'error' && <X className="h-6 w-6" />}
        </div>
        <p className="eyebrow mb-3">
          <span className="dot">●</span> {t('eyebrow')}
        </p>
        <h1 className="mb-3 text-[30px]">{title}</h1>
        <p className="text-[15px] leading-relaxed text-[color:var(--dim)]">{hint}</p>
        {status === 'error' && <p className="mono mt-5 text-[12px] text-[color:var(--dim-2)]">{t('redirecting')}</p>}
      </div>
    </LedgerShell>
  );
}

export default function CallbackPage() {
  return (
    <Suspense fallback={<div className="lp" />}>
      <CallbackContent />
    </Suspense>
  );
}
