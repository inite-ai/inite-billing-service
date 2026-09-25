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
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/10">
          <Check className="h-7 w-7 text-emerald-400" />
        </div>
        <h2 className="text-xl font-semibold text-white">{t('paidTitle')}</h2>
        <p className="mt-1 text-sm text-slate-400">{t('paidHint')}</p>
      </div>
    )
  }

  if (outcome === 'failed') {
    return (
      <div className="py-6 text-center" role="alert">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/10">
          <X className="h-7 w-7 text-red-400" />
        </div>
        <h2 className="text-xl font-semibold text-white">{t('failedTitle')}</h2>
        <p className="mt-1 text-sm text-slate-400">{t('failedHint')}</p>
        {errorUrl && (
          <a href={errorUrl} className="mt-4 inline-block text-sm text-violet-300 underline hover:text-violet-200">
            {t('back')}
          </a>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5 py-2" role="status" aria-live="polite">
      <div className="flex items-start gap-3">
        <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-violet-400" />
        <div>
          <h2 className="text-lg font-semibold text-white">
            {windowOpened ? t('titleWindow', { provider }) : t('titleResume', { provider })}
          </h2>
          <p className="mt-1 text-sm text-slate-400">{t('hint')}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2.5 sm:flex-row">
        <button
          type="button"
          onClick={onReopen}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition-colors hover:bg-violet-500"
        >
          <ExternalLink className="h-4 w-4" />
          {windowOpened ? t('reopen') : t('open')}
        </button>
        <button
          type="button"
          onClick={onCheck}
          disabled={checking}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-slate-700/40 px-4 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-600/50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} />
          {t('check')}
        </button>
      </div>
    </div>
  )
}
