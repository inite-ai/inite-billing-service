'use client'

import { useTranslations } from 'next-intl'
import { Modal } from './Modal'
import { Button } from './Button'

export interface BulkOutcome {
  id: string
  ok: boolean
  error?: string
}

export interface BulkResult {
  requested: number
  succeeded: number
  failed: number
  results: BulkOutcome[]
}

/**
 * What actually happened to a selection.
 *
 * A bulk action is not atomic — a payout already paid, an order that cannot be
 * refunded — so "12 of 15 done" has to be followed by which three and why.
 * Reporting only the total would leave the operator re-checking every row to
 * find the ones that did not move.
 */
export function BulkResultDialog({
  result,
  onClose,
}: {
  result: BulkResult | null
  onClose: () => void
}) {
  const t = useTranslations('common.bulk')
  const tc = useTranslations('common')
  const failures = result?.results.filter((r) => !r.ok) ?? []

  return (
    <Modal isOpen={!!result && failures.length > 0} onClose={onClose} title={t('failuresTitle')}>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {t('partial', { done: result?.succeeded ?? 0, failed: result?.failed ?? 0 })}
      </p>
      <ul className="mt-4 max-h-72 space-y-2 overflow-y-auto">
        {failures.map((f) => (
          <li
            key={f.id}
            className="rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800"
          >
            <span className="block font-mono text-xs text-slate-500 dark:text-slate-400">{f.id}</span>
            <span className="text-slate-900 dark:text-slate-100">{f.error}</span>
          </li>
        ))}
      </ul>
      <div className="mt-6 flex justify-end">
        <Button onClick={onClose}>{tc('close')}</Button>
      </div>
    </Modal>
  )
}
