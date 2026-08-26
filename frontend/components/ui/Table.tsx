'use client'

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

export function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={`border-b border-slate-200 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:text-slate-400 ${className}`}
    >
      {children}
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
