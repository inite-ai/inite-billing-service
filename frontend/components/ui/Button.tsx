'use client'

import { ButtonHTMLAttributes, forwardRef } from 'react'
import { Loader2 } from 'lucide-react'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: React.ReactNode
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: 'bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:from-violet-700 hover:to-purple-700 shadow-md shadow-violet-500/20 hover:shadow-lg hover:shadow-violet-500/30 active:shadow-sm',
  secondary: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-md shadow-red-500/20',
  ghost: 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800',
  outline: 'bg-transparent text-violet-600 dark:text-violet-400 border border-violet-300 dark:border-violet-700 hover:bg-violet-50 dark:hover:bg-violet-900/20',
}

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm rounded-lg gap-1.5',
  md: 'px-4 py-2.5 text-sm rounded-xl gap-2',
  lg: 'px-6 py-3 text-base rounded-xl gap-2',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading = false, icon, children, disabled, className = '', ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`
          font-medium transition-all duration-200
          disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none
          flex items-center justify-center
          active:scale-[0.97]
          ${variantStyles[variant]}
          ${sizeStyles[size]}
          ${className}
        `}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            {children}
          </>
        ) : (
          <>
            {icon}
            {children}
          </>
        )}
      </button>
    )
  }
)

Button.displayName = 'Button'
