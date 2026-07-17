'use client'

import { useEffect, useState } from 'react'
import { Check, X, Loader2, ShieldAlert, Clock } from 'lucide-react'
import { useTranslations } from 'next-intl'
import api from '@/lib/api'

export interface ActionData {
  id: string
  toolName: string
  summary: string
  params?: Record<string, unknown>
  status: string
  expiresAt: string
}

type ActionStatus =
  | 'pending'
  | 'executing'
  | 'executed'
  | 'failed'
  | 'rejected'
  | 'expired'

export default function ActionConfirmCard({ action }: { action: ActionData }) {
  const t = useTranslations('assistant.action')
  const [status, setStatus] = useState<ActionStatus>(
    (action.status as ActionStatus) || 'pending',
  )
  const [busy, setBusy] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)

  // A pending card may be stale after reload/expiry — sync with the server
  useEffect(() => {
    if (status !== 'pending') return
    if (new Date(action.expiresAt).getTime() > Date.now()) return
    setStatus('expired')
  }, [status, action.expiresAt])

  const act = async (verb: 'confirm' | 'reject') => {
    setBusy(true)
    setErrorText(null)
    if (verb === 'confirm') setStatus('executing')
    try {
      const { data } = await api.post(`/v1/assistant/actions/${action.id}/${verb}`)
      setStatus(data.status as ActionStatus)
      if (data.error) setErrorText(data.error)
    } catch (err: any) {
      const serverStatus = err?.response?.data?.status
      if (err?.response?.status === 409 && serverStatus) {
        setStatus(serverStatus as ActionStatus)
      } else {
        setStatus('pending')
        setErrorText(err?.response?.data?.message || 'Request failed')
      }
    } finally {
      setBusy(false)
    }
  }

  const statusBadge = () => {
    switch (status) {
      case 'executed':
        return (
          <span className="flex items-center gap-1 text-green-600 dark:text-green-400 text-xs font-medium">
            <Check className="w-3.5 h-3.5" /> {t('executed')}
          </span>
        )
      case 'failed':
        return (
          <span className="flex items-center gap-1 text-red-500 text-xs font-medium">
            <X className="w-3.5 h-3.5" /> {t('failed')}
          </span>
        )
      case 'rejected':
        return (
          <span className="flex items-center gap-1 text-slate-500 text-xs font-medium">
            <X className="w-3.5 h-3.5" /> {t('rejected')}
          </span>
        )
      case 'expired':
        return (
          <span className="flex items-center gap-1 text-slate-500 text-xs font-medium">
            <Clock className="w-3.5 h-3.5" /> {t('expired')}
          </span>
        )
      case 'executing':
        return (
          <span className="flex items-center gap-1 text-violet-500 text-xs font-medium">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('executing')}
          </span>
        )
      default:
        return null
    }
  }

  return (
    <div className="mt-2 rounded-xl border border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/20 p-3 text-sm">
      <div className="flex items-start gap-2">
        <ShieldAlert className="w-4 h-4 text-violet-500 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-slate-800 dark:text-slate-200">
            {t('title')}
          </p>
          {/* Server-generated summary from the DB row — never model prose */}
          <p className="text-slate-600 dark:text-slate-300 mt-1">
            {action.summary}
          </p>
          {errorText && (
            <p className="text-xs text-red-500 mt-1 break-words">{errorText}</p>
          )}
          <div className="mt-2">
            {status === 'pending' ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => act('confirm')}
                  disabled={busy}
                  className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {t('confirm')}
                </button>
                <button
                  onClick={() => act('reject')}
                  disabled={busy}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
                >
                  {t('reject')}
                </button>
              </div>
            ) : (
              statusBadge()
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
