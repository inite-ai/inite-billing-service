'use client'

import { useCallback, useEffect, useId, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * The admin's dialog.
 *
 * It was a `div` over a scrim: no dialog role, no Escape, and focus stayed on
 * the page behind it — so a keyboard user tabbed through the table underneath
 * while a modal covered it, and a screen reader was never told a dialog had
 * opened. Every destructive confirmation in the admin renders through here.
 *
 * Four things this now guarantees: the dialog announces itself and is labelled
 * by its own heading; Escape closes it; Tab cycles inside it instead of
 * escaping to the page behind; and focus returns to whatever opened it, so the
 * operator's place in a long table is not lost on close.
 */
export function Modal({ isOpen, onClose, title, children }: ModalProps) {
  const t = useTranslations('common')
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreTo = useRef<HTMLElement | null>(null)

  const trapFocus = useCallback((event: KeyboardEvent) => {
    const panel = panelRef.current
    if (!panel) return

    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    )
    if (items.length === 0) {
      event.preventDefault()
      return
    }

    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement as HTMLElement | null

    if (event.shiftKey && (active === first || !panel.contains(active))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return

    restoreTo.current = document.activeElement as HTMLElement | null
    document.body.style.overflow = 'hidden'

    // Focus the panel itself rather than its first control: landing on a
    // destructive button is how a stray Enter refunds an order.
    const focusTimer = window.setTimeout(() => panelRef.current?.focus(), 0)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      } else if (event.key === 'Tab') {
        trapFocus(event)
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = ''
      restoreTo.current?.focus?.()
    }
  }, [isOpen, onClose, trapFocus])

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="relative mx-4 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl shadow-slate-900/10 outline-none dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/40"
          >
            <div className="mb-5 flex items-center justify-between">
              <h3 id={titleId} className="text-lg font-semibold text-slate-900 dark:text-white">
                {title}
              </h3>
              <button
                type="button"
                onClick={onClose}
                aria-label={t('close')}
                className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
