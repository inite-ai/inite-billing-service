'use client'

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info'

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
  success: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  warning: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  error: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  info: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
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

export function Badge({ children, variant, className = '' }: {
  children: React.ReactNode
  variant?: BadgeVariant
  className?: string
}) {
  const resolvedVariant = variant || statusVariantMap[String(children).toLowerCase()] || 'default'

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${variantStyles[resolvedVariant]} ${className}`}>
      {children}
    </span>
  )
}
