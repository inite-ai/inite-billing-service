'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import type { Product, Service } from '@/lib/types'

interface ProductFormProps {
  initial?: Product
  services: Service[]
  onSubmit: (data: { code: string; name: string; moduleScope: string; type: string; serviceId?: string }) => Promise<void>
  onCancel: () => void
}

export function ProductForm({ initial, services, onSubmit, onCancel }: ProductFormProps) {
  const [code, setCode] = useState(initial?.code || '')
  const [name, setName] = useState(initial?.name || '')
  const [moduleScope, setModuleScope] = useState(initial?.moduleScope || '')
  const [type, setType] = useState<string>(initial?.type || 'one_time')
  const [serviceId, setServiceId] = useState(initial?.serviceId || '')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await onSubmit({ code, name, moduleScope, type, serviceId: serviceId || undefined })
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="Code" value={code} onChange={(e) => setCode(e.target.value)} required disabled={!!initial} />
      <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
      <Input label="Module Scope" value={moduleScope} onChange={(e) => setModuleScope(e.target.value)} required />
      <Select label="Type" value={type} onChange={(e) => setType(e.target.value)} options={[
        { value: 'one_time', label: 'One-time' },
        { value: 'subscription', label: 'Subscription' },
        { value: 'usage', label: 'Usage' },
      ]} />
      <Select label="Service" value={serviceId} onChange={(e) => setServiceId(e.target.value)} options={[
        { value: '', label: 'None' },
        ...services.map((s) => ({ value: s.id, label: s.name })),
      ]} />
      <div className="flex gap-3 justify-end">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={loading}>{initial ? 'Update' : 'Create'}</Button>
      </div>
    </form>
  )
}
