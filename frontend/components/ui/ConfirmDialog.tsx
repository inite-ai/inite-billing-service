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
  confirmLabel?: string
  variant?: 'danger' | 'default'
}

export function ConfirmDialog({ isOpen, onClose, onConfirm, title, message, confirmLabel, variant = 'default' }: ConfirmDialogProps) {
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
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">{message}</p>
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
