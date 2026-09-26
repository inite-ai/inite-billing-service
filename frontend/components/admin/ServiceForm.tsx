'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import type { Service } from '@/lib/types'
import { useTranslations } from 'next-intl'

export interface ServiceFormValues {
  code: string
  name: string
  metadata?: Record<string, unknown>
}

interface ServiceFormProps {
  initial?: Service
  onSubmit: (data: ServiceFormValues) => Promise<void>
  onCancel: () => void
}

export function ServiceForm({ initial, onSubmit, onCancel }: ServiceFormProps) {
  const [code, setCode] = useState(initial?.code || '')
  const [name, setName] = useState(initial?.name || '')
  // The name customers see in the catalog; the internal name stays as it is.
  const [displayName, setDisplayName] = useState(
    typeof initial?.metadata?.displayName === 'string' ? initial.metadata.displayName : '',
  )
  const [loading, setLoading] = useState(false)
  const t = useTranslations('forms')
  const tc = useTranslations('common')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      // Keep whatever else the service carries in metadata.
      const metadata: Record<string, unknown> = { ...(initial?.metadata ?? {}) }
      if (displayName.trim()) metadata.displayName = displayName.trim()
      else delete metadata.displayName
      await onSubmit({ code, name, metadata })
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label={t('code')} value={code} onChange={(e) => setCode(e.target.value)} required disabled={!!initial} />
      <Input label={t('name')} value={name} onChange={(e) => setName(e.target.value)} required />
      <Input
        label={t('catalogName')}
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        placeholder={name}
      />
      <div className="flex gap-3 justify-end">
        <Button type="button" variant="ghost" onClick={onCancel}>{tc('cancel')}</Button>
        <Button type="submit" loading={loading}>{initial ? tc('update') : tc('create')}</Button>
      </div>
    </form>
  )
}
