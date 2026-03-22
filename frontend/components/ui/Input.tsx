'use client'

import { forwardRef, InputHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = '', ...props }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1.5">
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={`
            w-full px-3.5 py-2.5
            bg-white dark:bg-slate-900
            border rounded-xl text-sm
            text-slate-700 dark:text-slate-200
            placeholder-slate-400 dark:placeholder-slate-500
            focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all
            ${error ? 'border-red-400 focus:ring-red-500/30 focus:border-red-500' : 'border-slate-200 dark:border-slate-700'}
            ${className}
          `}
          {...props}
        />
        {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
      </div>
    )
  }
)

Input.displayName = 'Input'
