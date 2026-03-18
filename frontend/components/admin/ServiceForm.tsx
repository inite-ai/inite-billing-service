'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import type { Service } from '@/lib/types'

interface ServiceFormProps {
  initial?: Service
  onSubmit: (data: { code: string; name: string }) => Promise<void>
  onCancel: () => void
}

export function ServiceForm({ initial, onSubmit, onCancel }: ServiceFormProps) {
  const [code, setCode] = useState(initial?.code || '')
  const [name, setName] = useState(initial?.name || '')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await onSubmit({ code, name })
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="Code" value={code} onChange={(e) => setCode(e.target.value)} required disabled={!!initial} />
      <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
      <div className="flex gap-3 justify-end">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={loading}>{initial ? 'Update' : 'Create'}</Button>
      </div>
    </form>
  )
}
