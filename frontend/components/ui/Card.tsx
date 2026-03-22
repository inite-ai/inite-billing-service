'use client'

import { HTMLAttributes, forwardRef } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info'
  hover?: boolean
}

const variantStyles = {
  default: 'bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800',
  success: 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800/50',
  warning: 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/50',
  error: 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800/50',
  info: 'bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800/50',
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ variant = 'default', hover = false, className = '', children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`
          rounded-2xl p-5 border backdrop-blur-sm
          ${variantStyles[variant]}
          ${hover ? 'hover:shadow-lg hover:shadow-slate-200/50 dark:hover:shadow-slate-900/50 hover:-translate-y-0.5 cursor-pointer' : 'shadow-sm'}
          transition-all duration-200
          ${className}
        `}
        {...props}
      >
        {children}
      </div>
    )
  }
)

Card.displayName = 'Card'
