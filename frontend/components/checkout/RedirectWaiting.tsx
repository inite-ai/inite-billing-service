'use client'

import { useTranslations } from 'next-intl'
import { Check, ExternalLink, Loader2, RefreshCw, X } from 'lucide-react'

/**
 * Shown while the customer pays on the provider's own page.
 *
 * The provider's page is opened in its own window rather than replacing this
 * one, so the customer never leaves the shop: this page stays behind it,
 * checks the payment with the provider itself, and moves on the moment it
 * goes through — with or without a webhook. If the window was closed or
 * blocked, it can be opened again from here.
 */
export function RedirectWaiting({
  provider,
  outcome,
  checking,
  windowOpened,
  onReopen,
  onCheck,
  errorUrl,
}: {
  provider: string
  outcome: 'paid' | 'failed' | null
  checking: boolean
  windowOpened: boolean
  onReopen: () => void
  onCheck: () => void
  errorUrl?: string | null
}) {
  const t = useTranslations('checkout.redirect')

  if (outcome === 'paid') {
    return (
      <div className="py-6 text-center" role="status">
        <div className="badge-ic ok">
          <Check className="h-6 w-6" />
        </div>
        <h2 className="text-[26px]">{t('paidTitle')}</h2>
        <p className="mt-1 text-sm text-[color:var(--dim)]">{t('paidHint')}</p>
      </div>
    )
  }

  if (outcome === 'failed') {
    return (
      <div className="py-6 text-center" role="alert">
        <div className="badge-ic bad">
          <X className="h-6 w-6" />
        </div>
        <h2 className="text-[26px]">{t('failedTitle')}</h2>
        <p className="mt-1 text-sm text-[color:var(--dim)]">{t('failedHint')}</p>
        {errorUrl && (
          <a href={errorUrl} className="link mt-5 inline-block text-sm">
            {t('back')}
          </a>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5 py-2" role="status" aria-live="polite">
      <div className="flex items-start gap-3">
        <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-[color:var(--accent)]" />
        <div>
          <h2 className="text-lg font-semibold text-[color:var(--ink)]">
            {windowOpened ? t('titleWindow', { provider }) : t('titleResume', { provider })}
          </h2>
          <p className="mt-1 text-sm text-[color:var(--dim)]">{t('hint')}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2.5 sm:flex-row">
        <button
          type="button"
          onClick={onReopen}
          className="btn acc justify-center"
        >
          <ExternalLink className="h-4 w-4" />
          {windowOpened ? t('reopen') : t('open')}
        </button>
        <button
          type="button"
          onClick={onCheck}
          disabled={checking}
          className="btn ghost justify-center"
        >
          <RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} />
          {t('check')}
        </button>
      </div>
    </div>
  )
}
