'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import type { McpPricingMode, McpServer, Service } from '@/lib/types'

export interface McpServerPayload {
  serviceId?: string
  slug: string
  name: string
  description?: string
  upstreamUrl: string
  upstreamHeaders?: Record<string, string | null>
  pricingMode: McpPricingMode
  creditsPerCall?: number
  featureCode?: string | null
  requiredEntitlement?: string
  priceCode?: string
}

interface McpServerFormProps {
  initial?: McpServer
  services: Service[]
  onSubmit: (data: McpServerPayload) => Promise<void>
  onCancel: () => void
}

/**
 * Registering or changing a proxied MCP server.
 *
 * The upstream headers are the operator's own credentials, and the API never
 * returns them — so on edit this shows which header names are stored, and an
 * empty value means "leave that one alone", not "clear it". Clearing is its
 * own explicit action per header, because a save that silently wiped the
 * operator's auth would take their server offline with no error anywhere.
 */
export function McpServerForm({ initial, services, onSubmit, onCancel }: McpServerFormProps) {
  const t = useTranslations('admin.mcp')
  const tc = useTranslations('common')

  const [serviceId, setServiceId] = useState(initial?.serviceId ?? services[0]?.id ?? '')
  const [slug, setSlug] = useState(initial?.slug ?? '')
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [upstreamUrl, setUpstreamUrl] = useState(initial?.upstreamUrl ?? '')
  const [pricingMode, setPricingMode] = useState<McpPricingMode>(initial?.pricingMode ?? 'per_call')
  const [chargeBy, setChargeBy] = useState<'flat' | 'feature'>(initial?.featureCode ? 'feature' : 'flat')
  const [creditsPerCall, setCreditsPerCall] = useState(
    initial?.creditsPerCall != null ? String(initial.creditsPerCall) : '1',
  )
  const [featureCode, setFeatureCode] = useState(initial?.featureCode ?? '')
  const [requiredEntitlement, setRequiredEntitlement] = useState(initial?.requiredEntitlement ?? '')
  const [priceCode, setPriceCode] = useState(initial?.priceCode ?? '')
  const [headerName, setHeaderName] = useState('')
  const [headerValue, setHeaderValue] = useState('')
  const [removed, setRemoved] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const storedHeaders = (initial?.upstreamHeaderKeys ?? []).filter((k) => !removed.includes(k))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const headers: Record<string, string | null> = {}
    for (const key of removed) headers[key] = null
    if (headerName.trim() && headerValue) headers[headerName.trim()] = headerValue

    const payload: McpServerPayload = {
      slug: slug.trim(),
      name: name.trim(),
      description: description.trim() || undefined,
      upstreamUrl: upstreamUrl.trim(),
      pricingMode,
      priceCode: priceCode.trim() || undefined,
    }
    if (!initial) payload.serviceId = serviceId
    if (Object.keys(headers).length > 0) payload.upstreamHeaders = headers

    if (pricingMode === 'per_call') {
      if (chargeBy === 'feature') {
        payload.featureCode = featureCode.trim()
      } else {
        const credits = Number(creditsPerCall)
        if (!Number.isInteger(credits) || credits < 0) {
          setError(t('form.invalidCredits'))
          return
        }
        payload.creditsPerCall = credits
        // Switching from a feature back to a flat rate has to actually drop
        // the feature: the gateway prefers it whenever it is set.
        if (initial?.featureCode) payload.featureCode = null
      }
    }
    if (pricingMode === 'entitlement') payload.requiredEntitlement = requiredEntitlement.trim()

    setLoading(true)
    try {
      await onSubmit(payload)
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message
      setError(Array.isArray(message) ? message.join('; ') : message || t('form.saveFailed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {!initial && (
        <Select
          label={t('form.operator')}
          value={serviceId}
          onChange={(e) => setServiceId(e.target.value)}
          options={services.map((s) => ({ value: s.id, label: `${s.name} · ${s.code}` }))}
          required
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Input label={t('form.name')} value={name} onChange={(e) => setName(e.target.value)} required />
        <div>
          <Input
            label={t('form.slug')}
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            pattern="[a-z0-9][a-z0-9-]{1,62}[a-z0-9]"
            required
          />
          <p className="mt-1.5 font-mono text-xs text-slate-500 dark:text-slate-400">
            /mcp/s/{slug || '…'}
          </p>
        </div>
      </div>

      <Input
        label={t('form.description')}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      <div>
        <Input
          label={t('form.upstreamUrl')}
          type="url"
          value={upstreamUrl}
          onChange={(e) => setUpstreamUrl(e.target.value)}
          placeholder="https://tools.example.com/mcp"
          required
        />
        <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{t('form.upstreamHint')}</p>
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-400">
          {t('form.headers')}
        </legend>
        {storedHeaders.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {storedHeaders.map((key) => (
              <li
                key={key}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-100 py-1 pl-2.5 pr-1 font-mono text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                {key}: ••••••
                <button
                  type="button"
                  onClick={() => setRemoved((r) => [...r, key])}
                  className="rounded px-1.5 py-0.5 font-sans text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
                >
                  {t('form.removeHeader')}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-2 sm:grid-cols-[2fr_3fr]">
          <Input
            aria-label={t('form.headerName')}
            placeholder={t('form.headerName')}
            value={headerName}
            onChange={(e) => setHeaderName(e.target.value)}
            className="font-mono"
          />
          <Input
            aria-label={t('form.headerValue')}
            placeholder={t('form.headerValue')}
            type="password"
            autoComplete="off"
            value={headerValue}
            onChange={(e) => setHeaderValue(e.target.value)}
            className="font-mono"
          />
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">{t('form.headersHint')}</p>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label={t('form.pricingMode')}
          value={pricingMode}
          onChange={(e) => setPricingMode(e.target.value as McpPricingMode)}
          options={[
            { value: 'per_call', label: t('pricing.per_call') },
            { value: 'entitlement', label: t('pricing.entitlement') },
            { value: 'free', label: t('pricing.free') },
          ]}
        />
        {pricingMode === 'per_call' && (
          <Select
            label={t('form.chargeBy')}
            value={chargeBy}
            onChange={(e) => setChargeBy(e.target.value as 'flat' | 'feature')}
            options={[
              { value: 'flat', label: t('form.chargeFlat') },
              { value: 'feature', label: t('form.chargeFeature') },
            ]}
          />
        )}
      </div>

      {pricingMode === 'per_call' && chargeBy === 'flat' && (
        <Input
          label={t('form.creditsPerCall')}
          type="number"
          min={0}
          step={1}
          value={creditsPerCall}
          onChange={(e) => setCreditsPerCall(e.target.value)}
          required
        />
      )}
      {pricingMode === 'per_call' && chargeBy === 'feature' && (
        <Input
          label={t('form.featureCode')}
          value={featureCode}
          onChange={(e) => setFeatureCode(e.target.value)}
          className="font-mono"
          required
        />
      )}
      {pricingMode === 'entitlement' && (
        <Input
          label={t('form.requiredEntitlement')}
          value={requiredEntitlement}
          onChange={(e) => setRequiredEntitlement(e.target.value)}
          placeholder="access.pro"
          className="font-mono"
          required
        />
      )}
      {pricingMode !== 'free' && (
        <div>
          <Input
            label={t('form.priceCode')}
            value={priceCode}
            onChange={(e) => setPriceCode(e.target.value)}
            className="font-mono"
          />
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{t('form.priceCodeHint')}</p>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-3">
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
