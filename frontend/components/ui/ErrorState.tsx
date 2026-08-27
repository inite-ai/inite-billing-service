'use client'

import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from './Button'

/**
 * A failed load is not an empty list.
 *
 * Every admin table rendered its empty state whenever data was missing, so an
 * API that was down read as "no services yet" — the operator's next move was to
 * create a duplicate of something that already exists. This names the failure
 * and offers the only useful action.
 */
export function ErrorState({
  message,
  onRetry,
}: {
  message?: string | null
  onRetry?: () => void
}) {
  const t = useTranslations('common')

  return (
    <div role="alert" className="text-center py-12 px-4">
      <div className="w-12 h-12 rounded-xl bg-red-50 dark:bg-red-900/20 ring-1 ring-red-200 dark:ring-red-800/50 flex items-center justify-center mx-auto mb-4">
        <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
      </div>
      <p className="text-slate-900 dark:text-slate-100 font-medium">{t('loadFailed')}</p>
      {message && (
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
          {message}
        </p>
      )}
      {onRetry && (
        <Button
          variant="secondary"
          size="sm"
          className="mt-4 mx-auto"
          icon={<RefreshCw className="w-4 h-4" />}
          onClick={onRetry}
        >
          {t('retry')}
        </Button>
      )}
    </div>
  )
}
