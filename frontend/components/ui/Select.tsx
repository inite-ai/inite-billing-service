'use client'

import { SelectHTMLAttributes, forwardRef } from 'react'
import { ChevronDown } from 'lucide-react'

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  options: { value: string; label: string }[]
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, options, className = '', ...props }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1.5">
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            className={`
              w-full px-3.5 py-2.5 appearance-none
              bg-white dark:bg-slate-900
              border border-slate-200 dark:border-slate-700 rounded-xl
              text-sm text-slate-700 dark:text-slate-200
              focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all
              ${className}
            `}
            {...props}
          >
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        </div>
      </div>
    )
  }
)

Select.displayName = 'Select'
