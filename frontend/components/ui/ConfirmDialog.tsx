'use client'

import { useState } from 'react'
import { Modal } from './Modal'
import { Button } from './Button'
import { useTranslations } from 'next-intl'

interface ConfirmDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => Promise<void> | void
  title: string
  message: string
  /** What is about to be changed — an order id, a service code, an amount. */
  record?: string
  confirmLabel?: string
  variant?: 'danger' | 'default'
}

/**
 * Confirmation for an action that cannot be taken back.
 *
 * Every call site passed the same string as `title` and `message`, so the
 * dialog printed one sentence twice in two type sizes and said nothing the
 * heading had not already said. And none of them named the record: "Delete this
 * service?" is a speed bump, not a safeguard — operators learn to click through
 * it, and the one time the wrong row was selected there is no undo.
 *
 * The duplicate is now dropped, and `record` renders the subject in a block the
 * eye cannot skip.
 */
export function ConfirmDialog({ isOpen, onClose, onConfirm, title, message, record, confirmLabel, variant = 'default' }: ConfirmDialogProps) {
  const [loading, setLoading] = useState(false)
  const tc = useTranslations('common')

  const handleConfirm = async () => {
    setLoading(true)
    try {
      await onConfirm()
      onClose()
    } catch {
      // error handled by caller
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      {message !== title && (
        <p className="text-sm text-slate-500 dark:text-slate-400">{message}</p>
      )}
      {record && (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900 dark:bg-slate-800 dark:text-slate-100">
          {record}
        </p>
      )}
      <div className="mb-6" />
      <div className="flex gap-3 justify-end">
        <Button variant="ghost" onClick={onClose} disabled={loading}>{tc('cancel')}</Button>
        <Button
          variant={variant === 'danger' ? 'danger' : 'primary'}
          onClick={handleConfirm}
          loading={loading}
        >
          {confirmLabel || tc('confirm')}
        </Button>
      </div>
    </Modal>
  )
}
