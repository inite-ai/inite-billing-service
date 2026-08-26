'use client'

/**
 * Loading placeholders shaped like the content that replaces them.
 *
 * The admin used to drop a centred spinner into the card body, so every table
 * collapsed to a single line and the page jumped when data arrived. A skeleton
 * holds the layout still and tells the operator what is coming.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-slate-200/70 dark:bg-slate-700/50 ${className}`}
    />
  )
}

// Uneven widths read as data; equal bars read as a progress meter.
const COLUMN_WIDTHS = ['w-full', 'w-3/4', 'w-5/6', 'w-2/3', 'w-4/5', 'w-1/2']

/** Table body placeholder. `columns` keeps the column rhythm of the real table. */
export function TableSkeleton({ rows = 5, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="divide-y divide-slate-100 dark:divide-slate-800"
    >
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="flex items-center gap-4 px-4 py-3.5">
          {Array.from({ length: columns }).map((_, column) => (
            <div key={column} className="flex-1">
              <Skeleton className={`h-4 ${COLUMN_WIDTHS[(row + column) % COLUMN_WIDTHS.length]}`} />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/** Card-grid placeholder for the stat rows above several admin tables. */
export function CardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          aria-busy="true"
          className="rounded-2xl p-5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60"
        >
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-20 mt-3" />
        </div>
      ))}
    </>
  )
}
