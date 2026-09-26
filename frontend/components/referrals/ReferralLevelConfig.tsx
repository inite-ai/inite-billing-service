'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
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
  const t = useTranslations('referralLevelForm')
  const tc = useTranslations('common')
  const [serviceId, setServiceId] = useState('')
  const [name, setName] = useState('')
  const [commissionRate, setCommissionRate] = useState('')
  const [minDirectReferrals, setMinDirectReferrals] = useState('')
  const [minActiveReferrals, setMinActiveReferrals] = useState('')
  const [minPersonalOrders, setMinPersonalOrders] = useState('')
  const [minDownlineOrders, setMinDownlineOrders] = useState('')
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
      if (minDownlineOrders) criteria.minDownlineOrders = parseInt(minDownlineOrders)
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
      <Select label={t('service')} value={serviceId} onChange={(e) => setServiceId(e.target.value)} required options={[
        { value: '', label: t('selectService') },
        ...services.map((s) => ({ value: s.id, label: s.name })),
      ]} />
      <Input label={t('name')} value={name} onChange={(e) => setName(e.target.value)} required placeholder={t('namePlaceholder')} />
      <Input label={t('rate')} type="number" step="0.1" value={commissionRate} onChange={(e) => setCommissionRate(e.target.value)} required placeholder="15" />
      <p className="text-sm text-gray-500">{t('level', { level: nextLevel })}</p>

      <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
          {t('criteria')}
        </p>
        <p className="text-xs text-gray-400 mb-3">
          {t('criteriaHint')}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Input label={t('minDirect')} type="number" value={minDirectReferrals} onChange={(e) => setMinDirectReferrals(e.target.value)} placeholder="0" />
          <Input label={t('minActive')} type="number" value={minActiveReferrals} onChange={(e) => setMinActiveReferrals(e.target.value)} placeholder="0" />
          <Input label={t('minPersonal')} type="number" value={minPersonalOrders} onChange={(e) => setMinPersonalOrders(e.target.value)} placeholder="0" />
          <Input label={t('minDownline')} type="number" value={minDownlineOrders} onChange={(e) => setMinDownlineOrders(e.target.value)} placeholder="0" />
          <Input label={t('minVolume')} type="number" value={minMonthlyVolume} onChange={(e) => setMinMonthlyVolume(e.target.value)} placeholder="0" />
        </div>
        <label className="flex items-center gap-2 mt-3 cursor-pointer">
          <input type="checkbox" checked={personalPurchaseRequired} onChange={(e) => setPersonalPurchaseRequired(e.target.checked)} className="rounded border-gray-300" />
          <span className="text-sm text-gray-700 dark:text-gray-300">{t('personalPurchaseRequired')}</span>
        </label>
      </div>

      <div className="flex gap-3 justify-end">
        <Button type="button" variant="ghost" onClick={onCancel}>{tc('cancel')}</Button>
        <Button type="submit" loading={loading}>{t('create')}</Button>
      </div>
    </form>
  )
}
