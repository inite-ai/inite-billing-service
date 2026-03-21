'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useTranslations } from 'next-intl'

interface EntitlementFormProps {
  onSubmit: (data: { userId: string; key: string; expiresAt?: string }) => Promise<void>
  onCancel: () => void
}

export function EntitlementForm({ onSubmit, onCancel }: EntitlementFormProps) {
  const [userId, setUserId] = useState('')
  const [key, setKey] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [loading, setLoading] = useState(false)
  const t = useTranslations('forms')
  const tc = useTranslations('common')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await onSubmit({ userId, key, expiresAt: expiresAt || undefined })
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label={t('userId')} value={userId} onChange={(e) => setUserId(e.target.value)} required placeholder="UUID" />
      <Input label={t('key')} value={key} onChange={(e) => setKey(e.target.value)} required />
      <Input label={t('expiresAt')} type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
      <div className="flex gap-3 justify-end">
        <Button type="button" variant="ghost" onClick={onCancel}>{tc('cancel')}</Button>
        <Button type="submit" loading={loading}>{tc('create')}</Button>
      </div>
    </form>
  )
}
