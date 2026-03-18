'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import type { Service, QualificationCriteria } from '@/lib/types'

interface ReferralLevelConfigProps {
  services: Service[]
  nextLevel: number
  onSubmit: (data: {
    serviceId: string
    level: number
    commissionRate: number
    name: string
    qualificationCriteria?: QualificationCriteria
  }) => Promise<void>
  onCancel: () => void
}

export function ReferralLevelConfig({ services, nextLevel, onSubmit, onCancel }: ReferralLevelConfigProps) {
  const [serviceId, setServiceId] = useState('')
  const [name, setName] = useState('')
  const [commissionRate, setCommissionRate] = useState('')
  const [minDirectReferrals, setMinDirectReferrals] = useState('')
  const [minActiveReferrals, setMinActiveReferrals] = useState('')
  const [minPersonalOrders, setMinPersonalOrders] = useState('')
  const [minMonthlyVolume, setMinMonthlyVolume] = useState('')
  const [personalPurchaseRequired, setPersonalPurchaseRequired] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const criteria: QualificationCriteria = {}
      if (minDirectReferrals) criteria.minDirectReferrals = parseInt(minDirectReferrals)
      if (minActiveReferrals) criteria.minActiveReferrals = parseInt(minActiveReferrals)
      if (minPersonalOrders) criteria.minPersonalOrders = parseInt(minPersonalOrders)
      if (minMonthlyVolume) criteria.minMonthlyVolume = parseFloat(minMonthlyVolume)
      if (personalPurchaseRequired) criteria.personalPurchaseRequired = true

      await onSubmit({
        serviceId,
        level: nextLevel,
        commissionRate: parseFloat(commissionRate) / 100,
        name,
        qualificationCriteria: Object.keys(criteria).length > 0 ? criteria : undefined,
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
      <Input label="Commission Rate (%)" type="number" step="0.1" value={commissionRate} onChange={(e) => setCommissionRate(e.target.value)} required placeholder="e.g. 15" />
      <p className="text-sm text-gray-500">Level: {nextLevel}</p>

      <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
          Qualification Criteria (optional)
        </p>
        <p className="text-xs text-gray-400 mb-3">
          If an affiliate doesn't meet these conditions, they are ejected and levels shift upward.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Min Direct Referrals" type="number" value={minDirectReferrals} onChange={(e) => setMinDirectReferrals(e.target.value)} placeholder="0" />
          <Input label="Min Active Referrals" type="number" value={minActiveReferrals} onChange={(e) => setMinActiveReferrals(e.target.value)} placeholder="0" />
          <Input label="Min Personal Orders" type="number" value={minPersonalOrders} onChange={(e) => setMinPersonalOrders(e.target.value)} placeholder="0" />
          <Input label="Min Monthly Volume ($)" type="number" value={minMonthlyVolume} onChange={(e) => setMinMonthlyVolume(e.target.value)} placeholder="0" />
        </div>
        <label className="flex items-center gap-2 mt-3 cursor-pointer">
          <input type="checkbox" checked={personalPurchaseRequired} onChange={(e) => setPersonalPurchaseRequired(e.target.checked)} className="rounded border-gray-300" />
          <span className="text-sm text-gray-700 dark:text-gray-300">Personal purchase required</span>
        </label>
      </div>

      <div className="flex gap-3 justify-end">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={loading}>Create Level</Button>
      </div>
    </form>
  )
}
