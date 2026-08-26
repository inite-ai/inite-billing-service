'use client'
import { useState, useCallback } from 'react'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

interface ConfirmOptions {
  title: string
  message: string
  record?: string
  variant?: 'danger' | 'default'
  confirmLabel?: string
}

export function useConfirmDialog() {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null)

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({ ...opts, resolve })
    })
  }, [])

  const handleConfirm = useCallback(async () => {
    state?.resolve(true)
    setState(null)
  }, [state])

  const handleClose = useCallback(() => {
    state?.resolve(false)
    setState(null)
  }, [state])

  const DialogElement = state ? (
    <ConfirmDialog
      isOpen={true}
      onClose={handleClose}
      onConfirm={handleConfirm}
      title={state.title}
      message={state.message}
      record={state.record}
      variant={state.variant}
      confirmLabel={state.confirmLabel}
    />
  ) : null

  return { confirm, DialogElement }
}
