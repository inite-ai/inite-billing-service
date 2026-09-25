'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Plus, Pencil, Trash2, Eye, EyeOff, Plug, Globe, CreditCard, Zap } from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import type { PaymentProvider } from '@/lib/types'
import { PageHeader } from '@/components/ui/PageHeader'
import { ActiveBadge } from '@/components/ui/StatusBadge'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { IconButton } from '@/components/ui/IconButton'
import { getErrorMessage } from '@/lib/api-error'

const KNOWN_PROVIDERS = [
  { code: 'ONE', name: 'ONE Payment', currencies: ['BRL', 'USD'], countries: ['BR', 'LATAM'], modes: ['PAYMENT', 'SUBSCRIPTION'], description: 'Latin America payment gateway — Pix, cards, bank transfer' },
  { code: 'LAVA', name: 'Lava.top', currencies: ['RUB', 'USD', 'EUR'], countries: ['RU', 'GLOBAL'], modes: ['PAYMENT', 'SUBSCRIPTION'], description: 'Cards and SBP in roubles, cards and PayPal in USD/EUR. Webhook: https://billing.inite.ai/webhooks/lava' },
  { code: 'CRYPTO', name: 'Crypto (stablecoins)', currencies: ['USD'], countries: ['GLOBAL'], modes: ['PAYMENT'], description: 'USDT/USDC to your own wallets — configured under Crypto payments' },
]

/**
 * Settings a rail needs beyond an API key, per provider code. Secrets are
 * write-only like the key: the form sends what was typed and the server merges
 * it over what is stored.
 */
const PROVIDER_FIELDS: Record<string, Array<{ key: string; secret?: boolean; placeholder?: string }>> = {
  LAVA: [
    { key: 'webhookKey', secret: true },
    { key: 'defaultOfferId', placeholder: '836b9fc5-7ae9-4a27-9642-592bc44072b7' },
    { key: 'apiBaseUrl', placeholder: 'https://gate.lava.top' },
  ],
}

/** Rails whose credential is a single key — no separate secret to ask for. */
const NO_API_SECRET = new Set(['LAVA', 'CRYPTO'])

export default function AdminPaymentProvidersPage() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')

  const [providers, setProviders] = useState<PaymentProvider[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<PaymentProvider | null>(null)
  // Create form
  const [formCode, setFormCode] = useState('')
  const [formName, setFormName] = useState('')
  const [formCurrencies, setFormCurrencies] = useState('')
  const [formCountries, setFormCountries] = useState('')
  const [formModes, setFormModes] = useState('PAYMENT,SUBSCRIPTION')
  const [formWebhook, setFormWebhook] = useState('')
  const [formApiKey, setFormApiKey] = useState('')
  const [formApiSecret, setFormApiSecret] = useState('')
  const [formExtra, setFormExtra] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean
    title: string
    message: string
    record?: string
    onConfirm: () => Promise<void>
    variant?: 'danger' | 'default'
  } | null>(null)

  const load = async () => {
    try {
      const res = await api.get('/v1/admin/payment-providers')
      setProviders(res.data)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      toast.error(err.response?.data?.message || 'Failed to load payment providers')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleSelectTemplate = (tmpl: typeof KNOWN_PROVIDERS[0]) => {
    setFormCode(tmpl.code)
    setFormName(tmpl.name)
    setFormCurrencies(tmpl.currencies.join(', '))
    setFormCountries(tmpl.countries.join(', '))
    setFormModes(tmpl.modes.join(', '))
  }

  const handleCreate = async () => {
    setSaving(true)
    try {
      await api.post('/v1/admin/payment-providers', {
        code: formCode,
        name: formName,
        isActive: false,
        supportedModes: formModes.split(',').map((s) => s.trim()).filter(Boolean),
        currencies: formCurrencies.split(',').map((s) => s.trim()).filter(Boolean),
        countries: formCountries.split(',').map((s) => s.trim()).filter(Boolean),
        webhookUrl: formWebhook || undefined,
        config: {
          ...(formApiKey ? { apiKey: formApiKey } : {}),
          ...(formApiSecret ? { apiSecret: formApiSecret } : {}),
          ...extraConfig(),
        },
      })
      toast.success(t('providers.created'))
      setShowCreate(false)
      resetForm()
      load()
    } catch (e) {
      toast.error(getErrorMessage(e, t('providers.createError')))
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (id: string, isActive: boolean) => {
    try {
      await api.put(`/v1/admin/payment-providers/${id}`, { isActive: !isActive })
      toast.success(isActive ? t('providers.deactivated') : t('providers.activated'))
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      toast.error(err.response?.data?.message || 'Failed to toggle provider status')
    }
  }

  const handleDelete = (id: string) => {
    setConfirmState({
      isOpen: true,
      title: t('providers.deleteConfirm'),
      message: t('providers.deleteConfirm'),
      variant: 'danger',
      onConfirm: async () => {
        try {
          await api.delete(`/v1/admin/payment-providers/${id}`)
          toast.success(t('providers.deleted'))
          load()
        } catch (e: unknown) {
          const err = e as { response?: { data?: { message?: string } } }
          toast.error(err.response?.data?.message || 'Failed to delete payment provider')
          throw e
        }
      },
    })
  }

  const handleUpdateConfig = async () => {
    if (!editing) return
    setSaving(true)
    try {
      await api.put(`/v1/admin/payment-providers/${editing.id}`, {
        name: formName,
        currencies: formCurrencies.split(',').map((s) => s.trim()).filter(Boolean),
        countries: formCountries.split(',').map((s) => s.trim()).filter(Boolean),
        supportedModes: formModes.split(',').map((s) => s.trim()).filter(Boolean),
        webhookUrl: formWebhook || undefined,
        // Only what was typed. The server merges it over what is stored, so an
        // untouched field keeps its value — this page never receives the
        // secrets, and no longer needs to in order to avoid wiping them.
        config: {
          ...(formApiKey ? { apiKey: formApiKey } : {}),
          ...(formApiSecret ? { apiSecret: formApiSecret } : {}),
          ...extraConfig(),
        },
      })
      toast.success(t('providers.updated'))
      setEditing(null)
      resetForm()
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      toast.error(err.response?.data?.message || 'Failed to update provider')
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (p: PaymentProvider) => {
    setEditing(p)
    setFormCode(p.code)
    setFormName(p.name)
    setFormCurrencies(p.currencies.join(', '))
    setFormCountries(p.countries.join(', '))
    setFormModes(p.supportedModes.join(', '))
    setFormWebhook(p.webhookUrl || '')
    setFormApiKey('')
    setFormApiSecret('')
  }

  const resetForm = () => {
    setFormCode('')
    setFormName('')
    setFormCurrencies('')
    setFormCountries('')
    setFormModes('PAYMENT,SUBSCRIPTION')
    setFormWebhook('')
    setFormApiKey('')
    setFormApiSecret('')
    setFormExtra({})
  }

  /** Only fields that were filled in; an empty one keeps what is stored. */
  const extraConfig = () =>
    Object.fromEntries(Object.entries(formExtra).filter(([, value]) => value.trim()).map(([k, v]) => [k, v.trim()]))

  const credentialFields = (code: string, editingExisting: boolean) => {
    if (code === 'CRYPTO') {
      return (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t('providers.cryptoConfiguredElsewhere')}{' '}
          <a href="/admin/crypto" className="font-medium text-violet-600 hover:underline dark:text-violet-400">
            {t('crypto.title')} →
          </a>
        </p>
      )
    }
    const placeholder = editingExisting ? t('providers.leaveEmptyToKeep') : undefined
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label={t('providers.formApiKey')} value={formApiKey} onChange={(e) => setFormApiKey(e.target.value)} placeholder={placeholder ?? 'sk_live_...'} />
        {!NO_API_SECRET.has(code) && (
          <Input label={t('providers.formApiSecret')} type="password" value={formApiSecret} onChange={(e) => setFormApiSecret(e.target.value)} placeholder={placeholder ?? 'secret...'} />
        )}
        {(PROVIDER_FIELDS[code] ?? []).map((field) => (
          <div key={field.key} className="sm:col-span-2">
            <Input
              label={t(`providers.fields.${field.key}`)}
              type={field.secret ? 'password' : 'text'}
              autoComplete="off"
              value={formExtra[field.key] ?? ''}
              onChange={(e) => setFormExtra((x) => ({ ...x, [field.key]: e.target.value }))}
              placeholder={editingExisting ? t('providers.leaveEmptyToKeep') : field.placeholder}
              className={field.secret || field.placeholder ? 'font-mono' : ''}
            />
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{t(`providers.fields.${field.key}Hint`)}</p>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title={t('providers.title')}
        subtitle={t('providers.subtitle')}
        actions={
    <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => { resetForm(); setShowCreate(true) }}>{t('providers.addProvider')}</Button>
        }
      />
      {/* Active Providers */}
      <Card>
        {loading ? (
          <TableSkeleton />
        ) : providers.length === 0 ? (
          <div className="text-center py-8">
            <Plug className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
            <p className="text-slate-500 mb-2">{t('providers.noProviders')}</p>
            <p className="text-sm text-slate-400">{t('providers.noProvidersHint')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {providers.map((p) => (
              <div key={p.id} className={`border rounded-xl p-4 ${p.isActive ? 'border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/10' : 'border-slate-200 dark:border-slate-700'}`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${p.isActive ? 'bg-green-100 dark:bg-green-900/30' : 'bg-slate-100 dark:bg-slate-800'}`}>
                      <CreditCard className={`w-5 h-5 ${p.isActive ? 'text-green-600' : 'text-slate-400'}`} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-slate-900 dark:text-white">{p.name}</h3>
                        <span className="font-mono text-xs text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">{p.code}</span>
                        <ActiveBadge active={p.isActive} />
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-xs text-slate-500">
                        <span className="flex items-center gap-1"><Globe className="w-3 h-3" /> {p.countries.join(', ') || t('providers.noCountries')}</span>
                        <span className="flex items-center gap-1"><Zap className="w-3 h-3" /> {p.supportedModes.join(', ')}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <IconButton
                      onClick={() => handleToggleActive(p.id, p.isActive)}
                      tone="primary"
                      label={p.isActive ? tc('deactivate') : tc('activate')}
                      icon={p.isActive ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    />
                    <IconButton
                      onClick={() => startEdit(p)}
                      tone="primary"
                      label={tc('edit')}
                      icon={<Pencil className="w-4 h-4" />}
                    />
                    <IconButton onClick={() => handleDelete(p.id)} tone="danger" label={tc('delete')} icon={<Trash2 className="w-4 h-4" />} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {p.currencies.map((c) => (
                    <span key={c} className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full font-medium">{c}</span>
                  ))}
                </div>
                {p.webhookUrl && (
                  <p className="text-xs text-slate-400 mt-2 font-mono truncate">{t('providers.webhook', { url: p.webhookUrl })}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Create Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title={t('providers.createTitle')}>
        <div className="space-y-4">
          {/* Quick templates */}
          <div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">{t('providers.quickSetup')}</p>
            <div className="flex flex-wrap gap-2">
              {KNOWN_PROVIDERS.map((tmpl) => (
                <button
                  key={tmpl.code}
                  onClick={() => handleSelectTemplate(tmpl)}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${formCode === tmpl.code ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300' : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                >
                  {tmpl.name}
                </button>
              ))}
            </div>
            {formCode && KNOWN_PROVIDERS.find((t) => t.code === formCode) && (
              <p className="text-xs text-slate-400 mt-2">{KNOWN_PROVIDERS.find((t) => t.code === formCode)?.description}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input label={t('providers.formCode')} value={formCode} onChange={(e) => setFormCode(e.target.value.toUpperCase())} required placeholder="LAVA" />
            <Input label={t('providers.formName')} value={formName} onChange={(e) => setFormName(e.target.value)} required placeholder="Lava.top" />
          </div>
          <Input label={t('providers.formCurrencies')} value={formCurrencies} onChange={(e) => setFormCurrencies(e.target.value)} placeholder="USD, EUR" />
          <Input label={t('providers.formCountries')} value={formCountries} onChange={(e) => setFormCountries(e.target.value)} placeholder="GLOBAL" />
          <Input label={t('providers.formSupportedModes')} value={formModes} onChange={(e) => setFormModes(e.target.value)} placeholder="PAYMENT, SUBSCRIPTION" />
          <Input label={t('providers.formWebhookUrl')} value={formWebhook} onChange={(e) => setFormWebhook(e.target.value)} placeholder="https://billing.inite.ai/webhooks/lava" />

          <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">{t('providers.apiCredentials')}</p>
            {credentialFields(formCode, false)}
          </div>

          <div className="flex gap-3 justify-end">
            <Button variant="ghost" onClick={() => setShowCreate(false)}>{tc('cancel')}</Button>
            <Button onClick={handleCreate} loading={saving}>{t('providers.createProvider')}</Button>
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal isOpen={!!editing} onClose={() => { setEditing(null); resetForm() }} title={editing ? t('providers.editTitle', { name: editing.name }) : ''}>
        <div className="space-y-4">
          <Input label={t('providers.formName')} value={formName} onChange={(e) => setFormName(e.target.value)} />
          <Input label={t('providers.formCurrencies')} value={formCurrencies} onChange={(e) => setFormCurrencies(e.target.value)} />
          <Input label={t('providers.formCountries')} value={formCountries} onChange={(e) => setFormCountries(e.target.value)} />
          <Input label={t('providers.formSupportedModes')} value={formModes} onChange={(e) => setFormModes(e.target.value)} />
          <Input label={t('providers.formWebhookUrl')} value={formWebhook} onChange={(e) => setFormWebhook(e.target.value)} />
          <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
            <p className="text-sm text-slate-500 mb-2">{t('providers.apiCredentialsUpdate')}</p>
            {editing?.configuredKeys?.length ? (
              // What is stored, without sending it: the key names and the last
              // four characters of each, enough to tell one credential from
              // another before overwriting it.
              <p className="mb-3 font-mono text-xs text-slate-500 dark:text-slate-400">
                {editing.configuredKeys
                  .map((key) => `${key} ${editing.configPreview?.[key] ?? ''}`.trim())
                  .join('  ·  ')}
              </p>
            ) : null}
            {credentialFields(editing?.code ?? '', true)}
          </div>
          <div className="flex gap-3 justify-end">
            <Button variant="ghost" onClick={() => { setEditing(null); resetForm() }}>{tc('cancel')}</Button>
            <Button onClick={handleUpdateConfig} loading={saving}>{tc('saveChanges')}</Button>
          </div>
        </div>
      </Modal>

      {confirmState && (
        <ConfirmDialog
          isOpen={confirmState.isOpen}
          onClose={() => setConfirmState(null)}
          onConfirm={confirmState.onConfirm}
          title={confirmState.title}
          message={confirmState.message}
          record={confirmState.record}
          variant={confirmState.variant}
        />
      )}
    </div>
  )
}
