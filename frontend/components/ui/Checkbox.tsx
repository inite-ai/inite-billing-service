'use client'

import { useEffect, useRef } from 'react'

interface CheckboxProps {
  checked: boolean
  /** Header checkbox: some rows selected, but not all. */
  indeterminate?: boolean
  onChange: () => void
  /** Required — a checkbox in a table cell has no visible label of its own. */
  label: string
  disabled?: boolean
}

/**
 * A row or header checkbox.
 *
 * `indeterminate` is a DOM property, not an attribute, so it has to be written
 * through a ref — React will not set it from JSX. Without it a "select all"
 * box shows unchecked while three rows are selected, which reads as "clicking
 * this selects nothing".
 */
export function Checkbox({ checked, indeterminate = false, onChange, label, disabled }: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked
  }, [indeterminate, checked])

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      aria-label={label}
      onClick={(e) => e.stopPropagation()}
      className="h-4 w-4 cursor-pointer rounded border-slate-300 text-violet-600 accent-violet-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600"
    />
  )
}
