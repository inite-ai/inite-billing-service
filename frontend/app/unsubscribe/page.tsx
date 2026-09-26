'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { MailX, Check, X, Loader2 } from 'lucide-react'
import { LedgerShell } from '@/components/ledger/LedgerShell'
import { API_URL } from '@/lib/config'

function UnsubscribeContent() {
  const params = useSearchParams()
  const t = useTranslations('notifications.unsubscribe')
  const token = params.get('token')
  const category = params.get('category')

  // A missing token is known at first render — deciding it inside the effect
  // meant painting the spinner for a frame and then setting state during that
  // same commit, which is what makes the render cascade.
  const [state, setState] = useState<'loading' | 'done' | 'error'>(token ? 'loading' : 'error')

  useEffect(() => {
    if (!token) return
    fetch(`${API_URL}/v1/notifications/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, category: category || undefined }),
    })
      .then((res) => setState(res.ok ? 'done' : 'error'))
      .catch(() => setState('error'))
  }, [token, category])

  return (
    <LedgerShell>
      <div className="panel rise w-full max-w-[420px] p-9 text-center" role={state === 'error' ? 'alert' : 'status'} aria-live="polite">
        <div className={`badge-ic ${state === 'done' ? 'ok' : state === 'error' ? 'bad' : ''}`}>
          {state === 'loading' && <Loader2 className="h-6 w-6 animate-spin text-[color:var(--accent)]" />}
          {state === 'done' && <Check className="h-6 w-6" />}
          {state === 'error' && <X className="h-6 w-6" />}
        </div>
        <h1 className="mb-3 flex items-center justify-center gap-2.5 text-[28px]">
          <MailX className="h-5 w-5 text-[color:var(--dim)]" aria-hidden />
          {t('title')}
        </h1>
        <p className="text-[15px] leading-relaxed text-[color:var(--dim)]">
          {state === 'loading' && t('processing')}
          {state === 'done' && t('success')}
          {state === 'error' && t('error')}
        </p>
      </div>
    </LedgerShell>
  )
}

export default function UnsubscribePage() {
  return (
    <Suspense>
      <UnsubscribeContent />
    </Suspense>
  )
}
