'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { useTranslations } from 'next-intl'

/**
 * A truncated identifier that can actually be taken somewhere.
 *
 * Tables rendered `userId.slice(0, 8) + '...'` as plain text: the operator
 * could read the first eight characters of the thing they needed and had no
 * way to get the rest. Since every other admin search wants the full value,
 * that made cross-referencing a retyping exercise.
 */
export function CopyableId({ value, chars = 8 }: { value: string; chars?: number }) {
  const t = useTranslations('common')
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={value}
      aria-label={`${t('copy')}: ${value}`}
      className="group inline-flex items-center gap-1.5 rounded font-mono text-xs text-slate-600 transition-colors hover:text-violet-600 dark:text-slate-300 dark:hover:text-violet-400"
    >
      <span>{value.slice(0, chars)}…</span>
      {copied ? (
        <Check className="h-3 w-3 text-emerald-500" />
      ) : (
        <Copy className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </button>
  )
}
