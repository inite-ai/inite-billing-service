'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import type { Product } from '@/lib/types'
import { useTranslations } from 'next-intl'

export interface PriceFormValues {
  productId: string
  code: string
  currency: string
  amount: number
  interval?: string
  trialDays?: number
  graceDays?: number
}

interface PriceFormProps {
  products: Product[]
  onSubmit: (data: PriceFormValues) => Promise<void>
  onCancel: () => void
}

export function PriceForm({ products, onSubmit, onCancel }: PriceFormProps) {
  const [productId, setProductId] = useState('')
  const [code, setCode] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [amount, setAmount] = useState('')
  const [interval, setInterval] = useState('')
  const [trialDays, setTrialDays] = useState('')
  const [graceDays, setGraceDays] = useState('')
  const [loading, setLoading] = useState(false)
  const t = useTranslations('forms')
  const tc = useTranslations('common')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await onSubmit({
        productId,
        code,
        currency,
        amount: parseFloat(amount),
        interval: interval || undefined,
        trialDays: trialDays ? parseInt(trialDays) : undefined,
        graceDays: graceDays ? parseInt(graceDays) : undefined,
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Select label={t('product')} value={productId} onChange={(e) => setProductId(e.target.value)} required options={[
        { value: '', label: t('selectProduct') },
        ...products.map((p) => ({ value: p.id, label: `${p.name} (${p.code})` })),
      ]} />
      <Input label={t('code')} value={code} onChange={(e) => setCode(e.target.value)} required />
      <div className="grid grid-cols-2 gap-4">
        <Input label={t('amount')} type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        <Input label={t('currency')} value={currency} onChange={(e) => setCurrency(e.target.value)} required />
      </div>
      <Select label={t('interval')} value={interval} onChange={(e) => setInterval(e.target.value)} options={[
        { value: '', label: t('intervalNone') },
        { value: 'month', label: t('intervalMonthly') },
        { value: 'year', label: t('intervalYearly') },
      ]} />
      <div className="grid grid-cols-2 gap-4">
        <Input label={t('trialDays')} type="number" value={trialDays} onChange={(e) => setTrialDays(e.target.value)} />
        <Input label={t('graceDays')} type="number" value={graceDays} onChange={(e) => setGraceDays(e.target.value)} />
      </div>
      <div className="flex gap-3 justify-end">
        <Button type="button" variant="ghost" onClick={onCancel}>{tc('cancel')}</Button>
        <Button type="submit" loading={loading}>{tc('create')}</Button>
      </div>
    </form>
  )
}
