'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

interface EntitlementFormProps {
  onSubmit: (data: { userId: string; key: string; expiresAt?: string }) => Promise<void>
  onCancel: () => void
}

export function EntitlementForm({ onSubmit, onCancel }: EntitlementFormProps) {
  const [userId, setUserId] = useState('')
  const [key, setKey] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [loading, setLoading] = useState(false)

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
      <Input label="User ID" value={userId} onChange={(e) => setUserId(e.target.value)} required placeholder="UUID" />
      <Input label="Entitlement Key" value={key} onChange={(e) => setKey(e.target.value)} required />
      <Input label="Expires At" type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
      <div className="flex gap-3 justify-end">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={loading}>Create</Button>
      </div>
    </form>
  )
}
