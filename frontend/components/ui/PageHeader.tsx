'use client'

/**
 * The admin page title block.
 *
 * Twenty pages hand-wrote this pair of elements, which is how they drifted:
 * titles were drawn from two different neutral ramps, the subtitle sometimes
 * went missing, and the action button sat at a different height on every
 * screen. One component, one rhythm, and the actions wrap under the title on a
 * narrow viewport instead of squeezing it.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  icon,
}: {
  title: string
  subtitle?: string
  actions?: React.ReactNode
  /** Decorative — the title carries the meaning, so it is hidden from readers. */
  icon?: React.ReactNode
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 mb-6">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-white text-balance">
          {icon && <span aria-hidden>{icon}</span>}
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-prose">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </header>
  )
}
