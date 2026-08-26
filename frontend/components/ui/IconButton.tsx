'use client'

import { ButtonHTMLAttributes, forwardRef } from 'react'
import { Loader2 } from 'lucide-react'

type IconButtonTone = 'neutral' | 'primary' | 'danger' | 'success' | 'warning'

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  /** Required: the row actions are icon-only, so this is the control's only name. */
  label: string
  icon: React.ReactNode
  tone?: IconButtonTone
  loading?: boolean
}

/**
 * Resting colour is slate-500, not slate-400: an icon carrying no text label
 * has to clear the 4.5:1 floor on its own.
 *
 * A string-level palette check reads `text-slate-500` next to `hover:bg-*-50`
 * as grey text on a tinted surface. The two never coexist — the same hover that
 * paints the surface also sets `hover:text-*-600`.
 */
const toneStyles: Record<IconButtonTone, string> = {
  neutral: 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800',
  primary: 'text-slate-500 hover:text-violet-600 dark:hover:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20',
  danger: 'text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20',
  success: 'text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20',
  warning: 'text-slate-500 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20',
}

/**
 * The icon-only control used in table action columns.
 *
 * The hand-rolled version was a bare `<button>` wrapping a 16px icon with a
 * `title` attribute: no accessible name for a screen reader that ignores
 * `title`, no hover surface, and a tap target a third of the size a finger
 * needs. `label` is required and becomes both the accessible name and the
 * tooltip, and the control carries a real 32px target.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, icon, tone = 'neutral', loading = false, disabled, className = '', ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        title={label}
        disabled={disabled || loading}
        className={`
          inline-flex items-center justify-center w-8 h-8 rounded-lg
          transition-colors duration-150
          disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent
          ${toneStyles[tone]}
          ${className}
        `}
        {...props}
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : icon}
      </button>
    )
  },
)

IconButton.displayName = 'IconButton'
