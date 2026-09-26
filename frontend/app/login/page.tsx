'use client';

import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, Loader2, Lock } from 'lucide-react';
import { LedgerShell } from '@/components/ledger/LedgerShell';
import { OAuthClient } from '@/lib/oauth-client';
import { safeReturnTo } from '@/lib/safe-redirect';
import { useTranslations } from 'next-intl';

function LoginContent() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useTranslations('login');
  const searchParams = useSearchParams();
  const returnTo = searchParams?.get('returnTo');

  const handleLogin = async () => {
    try {
      setIsLoading(true);
      setError(null);
      // Stored already narrowed to this origin, so nothing off-site can be
      // parked in sessionStorage waiting for the callback to follow it.
      if (returnTo) {
        sessionStorage.setItem('returnTo', safeReturnTo(returnTo));
      }
      await OAuthClient.login();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
      setIsLoading(false);
    }
  };

  return (
    <LedgerShell footer={<><Lock className="h-3 w-3" aria-hidden />{t('secureAuth')}</>}>
      <div className="panel rise w-full max-w-[440px] overflow-hidden">
        <div className="mesh p-7 sm:p-9">
          <p className="eyebrow mb-5">
            <span className="dot">●</span> {t('eyebrow')}
          </p>
          <h1 className="mb-4 text-[34px] sm:text-[40px]">{t('headline')}</h1>
          <p className="mb-8 text-[15px] leading-relaxed text-[color:var(--dim)]">{t('subtitle')}</p>

          {error && (
            <p className="note err mb-5" role="alert">
              {error}
            </p>
          )}

          <button type="button" onClick={handleLogin} disabled={isLoading} className="btn acc block">
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('connecting')}
              </>
            ) : (
              <>
                {t('signInWith')}
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </div>
        <div className="flex items-center justify-between border-t border-[color:var(--line-2)] px-7 py-3.5 sm:px-9">
          <span className="mono text-[11.5px] text-[color:var(--dim-2)]">{t('protocol')}</span>
          <span className="live">
            <i />
            auth.inite.ai
          </span>
        </div>
      </div>
    </LedgerShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="lp" />}>
      <LoginContent />
    </Suspense>
  );
}
