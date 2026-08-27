'use client'

import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'

/**
 * The admin data table.
 *
 * The wrapper bleeds to the card edge so a horizontally scrolling table does
 * not appear to start inside a gutter, and the header sticks: these tables run
 * past a screen height and a scrolled column with no header is unreadable.
 */
export function Table({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`-mx-5 -mb-5 overflow-x-auto px-5 pb-5 ${className}`}>
      <table className="min-w-full border-separate border-spacing-0">{children}</table>
    </div>
  )
}

export function Thead({ children }: { children: React.ReactNode }) {
  // Near-opaque rather than the card's own translucency: rows must not read
  // through a header they are scrolling beneath.
  return (
    <thead className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm dark:bg-slate-900/95">
      {children}
    </thead>
  )
}

export function Tbody({ children }: { children: React.ReactNode }) {
  return <tbody>{children}</tbody>
}

/**
 * A body row. Hover is a scanning aid on a wide table, not decoration — it
 * keeps the eye on one record while crossing columns.
 */
export function Tr({
  children,
  className = '',
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={`transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40 ${className}`}
      {...props}
    >
      {children}
    </tr>
  )
}

export type SortDirection = 'asc' | 'desc'

export interface SortState {
  key: string
  dir: SortDirection
}

interface ThProps {
  children: React.ReactNode
  className?: string
  /** Set to make the column sortable. Must be a key the API accepts. */
  sortKey?: string
  sort?: SortState | null
  onSort?: (key: string) => void
}

const thClass =
  'border-b border-slate-200 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:text-slate-400'

/**
 * A column header — sortable when the page hands it a `sortKey`.
 *
 * `aria-sort` sits on the `th`, not on the button inside it: that is the
 * element a screen reader reads when it announces the column. The indicator
 * always occupies its space — a hint arrow at rest, a solid one when active —
 * so the header row does not jump by an icon's width on the first click.
 *
 * The sort itself is applied by the API over the whole filtered set. Sorting
 * the rows already in the DOM would rank one page under a header that claims
 * to rank the table.
 */
export function Th({ children, className = '', sortKey, sort, onSort }: ThProps) {
  if (!sortKey || !onSort) {
    return (
      <th scope="col" className={`${thClass} ${className}`}>
        {children}
      </th>
    )
  }

  const active = sort?.key === sortKey
  const ariaSort = active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'

  return (
    <th scope="col" aria-sort={ariaSort} className={`${thClass} ${className}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="group -mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 uppercase tracking-wider transition-colors hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:hover:text-white"
      >
        {children}
        {active ? (
          sort!.dir === 'asc' ? (
            <ArrowUp className="h-3 w-3 text-violet-600 dark:text-violet-400" aria-hidden />
          ) : (
            <ArrowDown className="h-3 w-3 text-violet-600 dark:text-violet-400" aria-hidden />
          )
        ) : (
          <ChevronsUpDown
            className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60"
            aria-hidden
          />
        )}
      </button>
    </th>
  )
}

export function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <td
      className={`border-b border-slate-100 px-4 py-3.5 text-sm text-slate-700 dark:border-slate-800 dark:text-slate-300 ${className}`}
    >
      {children}
    </td>
  )
}
