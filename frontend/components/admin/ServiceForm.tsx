'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import type { Service } from '@/lib/types'
import { useTranslations } from 'next-intl'

interface ServiceFormProps {
  initial?: Service
  onSubmit: (data: { code: string; name: string }) => Promise<void>
  onCancel: () => void
}

export function ServiceForm({ initial, onSubmit, onCancel }: ServiceFormProps) {
  const [code, setCode] = useState(initial?.code || '')
  const [name, setName] = useState(initial?.name || '')
  const [loading, setLoading] = useState(false)
  const t = useTranslations('forms')
  const tc = useTranslations('common')

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
      <Input label={t('code')} value={code} onChange={(e) => setCode(e.target.value)} required disabled={!!initial} />
      <Input label={t('name')} value={name} onChange={(e) => setName(e.target.value)} required />
      <div className="flex gap-3 justify-end">
        <Button type="button" variant="ghost" onClick={onCancel}>{tc('cancel')}</Button>
        <Button type="submit" loading={loading}>{initial ? tc('update') : tc('create')}</Button>
      </div>
    </form>
  )
}
