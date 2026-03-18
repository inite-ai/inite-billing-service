'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import type { Service } from '@/lib/types'

interface ReferralLevelConfigProps {
  services: Service[]
  nextLevel: number
  onSubmit: (data: { serviceId: string; level: number; commissionRate: number; name: string }) => Promise<void>
  onCancel: () => void
}

export function ReferralLevelConfig({ services, nextLevel, onSubmit, onCancel }: ReferralLevelConfigProps) {
  const [serviceId, setServiceId] = useState('')
  const [name, setName] = useState('')
  const [commissionRate, setCommissionRate] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await onSubmit({
        serviceId,
        level: nextLevel,
        commissionRate: parseFloat(commissionRate) / 100,
        name,
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Select label="Service" value={serviceId} onChange={(e) => setServiceId(e.target.value)} required options={[
        { value: '', label: 'Select service...' },
        ...services.map((s) => ({ value: s.id, label: s.name })),
      ]} />
      <Input label="Level Name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Direct Referral" />
      <Input label="Commission Rate (%)" type="number" step="0.1" value={commissionRate} onChange={(e) => setCommissionRate(e.target.value)} required placeholder="e.g. 50" />
      <p className="text-sm text-gray-500">Level: {nextLevel}</p>
      <div className="flex gap-3 justify-end">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={loading}>Create Level</Button>
      </div>
    </form>
  )
}
