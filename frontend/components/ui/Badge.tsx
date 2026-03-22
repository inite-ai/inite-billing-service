'use client'

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info'

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 ring-1 ring-emerald-200 dark:ring-emerald-800/50',
  warning: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 ring-1 ring-amber-200 dark:ring-amber-800/50',
  error: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400 ring-1 ring-red-200 dark:ring-red-800/50',
  info: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 ring-1 ring-blue-200 dark:ring-blue-800/50',
}

const statusVariantMap: Record<string, BadgeVariant> = {
  active: 'success',
  trialing: 'info',
  paid: 'success',
  earned: 'success',
  pending: 'warning',
  processing: 'warning',
  created: 'default',
  open: 'info',
  past_due: 'warning',
  canceled: 'error',
  ended: 'error',
  failed: 'error',
  refunded: 'warning',
  expired: 'error',
  voided: 'error',
  revoked: 'error',
  inactive: 'default',
  suspended: 'error',
}

const statusDotColors: Record<BadgeVariant, string> = {
  default: 'bg-slate-400',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  error: 'bg-red-500',
  info: 'bg-blue-500',
}

export function Badge({ children, variant, className = '' }: {
  children: React.ReactNode
  variant?: BadgeVariant
  className?: string
}) {
  const resolvedVariant = variant || statusVariantMap[String(children).toLowerCase()] || 'default'

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${variantStyles[resolvedVariant]} ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${statusDotColors[resolvedVariant]}`} />
      {children}
    </span>
  )
}
