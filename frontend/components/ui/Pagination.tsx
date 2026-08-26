'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface PaginationProps {
  page: number
  pages: number
  onPageChange: (page: number) => void
}

/**
 * Page control for the admin tables.
 *
 * Was the one primitive still drawn from the `gray` ramp while the rest of the
 * system had moved to `slate`, and its two controls were unlabelled icons.
 */
export function Pagination({ page, pages, onPageChange }: PaginationProps) {
  const t = useTranslations('common.pagination')

  if (pages <= 1) return null

  const buttonClass =
    'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition-colors hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'

  return (
    <nav aria-label={t('label')} className="mt-4 flex items-center justify-center gap-2">
      <button
        type="button"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        aria-label={t('previous')}
        className={buttonClass}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      {/* The full sentence, not "1 / 5": the count is announced to a screen
          reader and read at a glance by everyone else. */}
      <span aria-live="polite" className="text-sm tabular-nums text-slate-600 dark:text-slate-400">
        {t('page', { page, pages })}
      </span>
      <button
        type="button"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= pages}
        aria-label={t('next')}
        className={buttonClass}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </nav>
  )
}
