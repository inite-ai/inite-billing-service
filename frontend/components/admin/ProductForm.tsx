'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import type { Product, Service } from '@/lib/types'
import { useTranslations } from 'next-intl'
import { Plus, X } from 'lucide-react'

interface ProductFormProps {
  initial?: Product
  services: Service[]
  onSubmit: (data: {
    code: string
    name: string
    moduleScope: string
    type: string
    serviceId?: string
    metadata?: Record<string, unknown>
  }) => Promise<void>
  onCancel: () => void
}

export function ProductForm({ initial, services, onSubmit, onCancel }: ProductFormProps) {
  const meta = (initial?.metadata || {}) as Record<string, unknown>

  const [code, setCode] = useState(initial?.code || '')
  const [name, setName] = useState(initial?.name || '')
  const [type, setType] = useState<string>(initial?.type || 'one_time')
  const [serviceId, setServiceId] = useState(initial?.serviceId || '')

  // Display
  const [description, setDescription] = useState((meta.description as string) || '')
  const [highlighted, setHighlighted] = useState(!!meta.highlighted)

  // Features
  const [features, setFeatures] = useState<string[]>(
    Array.isArray(meta.features) ? (meta.features as string[]) : []
  )

  // Credits
  const [creditsPerPeriod, setCreditsPerPeriod] = useState<string>(
    meta.creditsPerPeriod != null ? String(meta.creditsPerPeriod) : ''
  )
  const [bonusCredits, setBonusCredits] = useState<string>(
    meta.bonusCredits != null ? String(meta.bonusCredits) : ''
  )

  // Entitlements
  const [entitlementKeys, setEntitlementKeys] = useState<string>(
    Array.isArray(meta.entitlements) ? (meta.entitlements as string[]).join(', ') : ''
  )

  const [loading, setLoading] = useState(false)
  const t = useTranslations('forms')
  const tc = useTranslations('common')

  const showCredits = type === 'subscription' || type === 'usage'

  const addFeature = () => setFeatures([...features, ''])
  const removeFeature = (idx: number) => setFeatures(features.filter((_, i) => i !== idx))
  const updateFeature = (idx: number, val: string) => {
    const next = [...features]
    next[idx] = val
    setFeatures(next)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const parsedEntitlements = entitlementKeys
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean)

      const filteredFeatures = features.filter((f) => f.trim() !== '')

      const metadata: Record<string, unknown> = {}
      if (description) metadata.description = description
      if (filteredFeatures.length > 0) metadata.features = filteredFeatures
      if (creditsPerPeriod) metadata.creditsPerPeriod = Number(creditsPerPeriod)
      if (bonusCredits) metadata.bonusCredits = Number(bonusCredits)
      if (highlighted) metadata.highlighted = true
      if (parsedEntitlements.length > 0) metadata.entitlements = parsedEntitlements

      await onSubmit({
        code,
        name,
        moduleScope: code,
        type,
        serviceId: serviceId || undefined,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      })
    } finally {
      setLoading(false)
    }
  }

  const sectionDivider = 'border-t border-slate-200 dark:border-slate-700 pt-5 mt-5'

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Basic Info */}
      <Input
        label={t('code')}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        required
        disabled={!!initial}
      />
      <Input
        label={t('name')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <Select
        label={t('type')}
        value={type}
        onChange={(e) => setType(e.target.value)}
        options={[
          { value: 'one_time', label: t('typeOneTime') },
          { value: 'subscription', label: t('typeSubscription') },
          { value: 'usage', label: t('typeUsage') },
        ]}
      />
      <Select
        label={t('service')}
        value={serviceId}
        onChange={(e) => setServiceId(e.target.value)}
        options={[
          { value: '', label: t('noneOption') },
          ...services.map((s) => ({ value: s.id, label: s.name })),
        ]}
      />

      {/* Display */}
      <div className={sectionDivider}>
        <div className="space-y-4">
          <div className="w-full">
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1.5">
              {t('description')}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('descriptionPlaceholder')}
              rows={3}
              className="
                w-full px-3.5 py-2.5
                bg-white dark:bg-slate-900
                border border-slate-200 dark:border-slate-700 rounded-xl text-sm
                text-slate-700 dark:text-slate-200
                placeholder-slate-400 dark:placeholder-slate-500
                focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all
                resize-none
              "
            />
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={highlighted}
              onChange={(e) => setHighlighted(e.target.checked)}
              className="
                w-4 h-4 rounded border-slate-300 dark:border-slate-600
                text-violet-600 focus:ring-violet-500/30
                bg-white dark:bg-slate-900
              "
            />
            <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
              {t('highlighted')}
            </span>
          </label>
        </div>
      </div>

      {/* Features */}
      <div className={sectionDivider}>
        <div className="space-y-3">
          <label className="block text-sm font-medium text-slate-600 dark:text-slate-400">
            {t('featuresList')}
          </label>
          {features.map((feat, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                value={feat}
                onChange={(e) => updateFeature(idx, e.target.value)}
                placeholder={t('featurePlaceholder')}
                className="
                  flex-1 px-3.5 py-2
                  bg-white dark:bg-slate-900
                  border border-slate-200 dark:border-slate-700 rounded-xl text-sm
                  text-slate-700 dark:text-slate-200
                  placeholder-slate-400 dark:placeholder-slate-500
                  focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all
                "
              />
              <button
                type="button"
                onClick={() => removeFeature(idx)}
                className="p-1.5 text-slate-400 hover:text-red-500 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addFeature}
            className="flex items-center gap-1.5 text-sm text-violet-600 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300 transition-colors"
          >
            <Plus className="w-4 h-4" />
            {t('addFeature')}
          </button>
        </div>
      </div>

      {/* Credits */}
      {showCredits && (
        <div className={sectionDivider}>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label={t('creditsPerPeriod')}
              type="number"
              min={0}
              value={creditsPerPeriod}
              onChange={(e) => setCreditsPerPeriod(e.target.value)}
            />
            <Input
              label={t('bonusCredits')}
              type="number"
              min={0}
              value={bonusCredits}
              onChange={(e) => setBonusCredits(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Entitlements */}
      <div className={sectionDivider}>
        <div className="space-y-1.5">
          <Input
            label={t('entitlementKeys')}
            value={entitlementKeys}
            onChange={(e) => setEntitlementKeys(e.target.value)}
          />
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {t('entitlementKeysHint')}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 justify-end pt-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {tc('cancel')}
        </Button>
        <Button type="submit" loading={loading}>
          {initial ? tc('update') : tc('create')}
        </Button>
      </div>
    </form>
  )
}
