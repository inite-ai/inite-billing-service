'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { MailX, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
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
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md w-full rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl p-8 text-center space-y-4">
        <div className="flex justify-center">
          {state === 'loading' && (
            <Loader2 className="w-10 h-10 text-violet-500 animate-spin" />
          )}
          {state === 'done' && (
            <CheckCircle2 className="w-10 h-10 text-green-500" />
          )}
          {state === 'error' && <XCircle className="w-10 h-10 text-red-500" />}
        </div>
        <h1 className="text-xl font-bold flex items-center justify-center gap-2">
          <MailX className="w-5 h-5 text-violet-500" />
          {t('title')}
        </h1>
        <p className="text-slate-500 text-sm">
          {state === 'loading' && t('processing')}
          {state === 'done' && t('success')}
          {state === 'error' && t('error')}
        </p>
      </div>
    </div>
  )
}

export default function UnsubscribePage() {
  return (
    <Suspense>
      <UnsubscribeContent />
    </Suspense>
  )
}
