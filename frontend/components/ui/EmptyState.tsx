import type { LucideIcon } from 'lucide-react'

/**
 * The zero state.
 *
 * An empty admin table is usually a first-run moment, not a dead end, so it
 * takes an action: the operator's next step belongs here rather than only in a
 * button at the top of the page they have to go find.
 */
export function EmptyState({
  icon: Icon,
  title,
  subtitle,
  action,
}: {
  icon: LucideIcon
  title: string
  subtitle?: string
  action?: React.ReactNode
}) {
  return (
    <div className="px-4 py-12 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800">
        <Icon className="h-5 w-5 text-slate-500 dark:text-slate-400" aria-hidden="true" />
      </div>
      <p className="font-medium text-slate-900 dark:text-slate-100">{title}</p>
      {subtitle && (
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">
          {subtitle}
        </p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}
