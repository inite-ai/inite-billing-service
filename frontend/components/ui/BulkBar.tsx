'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface BulkBarProps {
  count: number
  onClear: () => void
  children: React.ReactNode
  /** Shown next to the count — e.g. the total amount of the selected payouts. */
  summary?: string
}

/**
 * The action bar for a selection.
 *
 * Anchored to the bottom of the viewport rather than the top of the table: on a
 * long queue the operator is scrolled well past the header by the time they
 * have finished choosing rows, and the actions have to be where the work is.
 *
 * It says what is selected, not just how many — a bulk action on payouts is
 * money leaving, and "12 selected · $4,180.00" is the sentence someone should
 * read before they confirm.
 */
export function BulkBar({ count, onClear, children, summary }: BulkBarProps) {
  const t = useTranslations('common.bulk')

  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          role="region"
          aria-label={t('label')}
          className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4"
        >
          <div className="flex w-full max-w-3xl flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-2xl shadow-slate-900/10 backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/95 dark:shadow-black/40">
            <span aria-live="polite" className="text-sm font-medium text-slate-900 dark:text-white">
              {t('selected', { count })}
              {summary ? <span className="text-slate-500 dark:text-slate-400"> · {summary}</span> : null}
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {children}
              <button
                type="button"
                onClick={onClear}
                aria-label={t('clear')}
                title={t('clear')}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
