'use client'

import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import { Plus, Pencil, Trash2, Eye, EyeOff, Plug, Loader2, Globe, CreditCard, Zap } from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import type { PaymentProvider } from '@/lib/types'

const KNOWN_PROVIDERS = [
  { code: 'ONE', name: 'ONE Payment', currencies: ['BRL', 'USD'], countries: ['BR', 'LATAM'], modes: ['PAYMENT', 'SUBSCRIPTION'], description: 'Latin America payment gateway — Pix, cards, bank transfer' },
  { code: 'LAVA', name: 'Lava.top', currencies: ['USD', 'EUR'], countries: ['GLOBAL'], modes: ['PAYMENT', 'SUBSCRIPTION'], description: 'Global payments — Visa/Mastercard, USD/EUR. Creator monetization platform.' },
  { code: 'CRYPTO', name: 'Crypto (On-chain)', currencies: ['USDT', 'USDC', 'ETH'], countries: ['GLOBAL'], modes: ['PAYMENT'], description: 'Blockchain payments — direct on-chain invoicing with multi-chain support' },
]

export default function AdminPaymentProvidersPage() {
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
  const [saving, setSaving] = useState(false)

  const load = async () => {
    try {
      const res = await api.get('/v1/admin/payment-providers')
      setProviders(res.data)
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
        config: formApiKey ? { apiKey: formApiKey, apiSecret: formApiSecret } : {},
      })
      toast.success('Provider created')
      setShowCreate(false)
      resetForm()
      load()
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to create provider')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (id: string, isActive: boolean) => {
    await api.put(`/v1/admin/payment-providers/${id}`, { isActive: !isActive })
    toast.success(isActive ? 'Provider deactivated' : 'Provider activated')
    load()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this payment provider?')) return
    await api.delete(`/v1/admin/payment-providers/${id}`)
    toast.success('Provider deleted')
    load()
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
        config: formApiKey ? { apiKey: formApiKey, apiSecret: formApiSecret } : editing.config,
      })
      toast.success('Provider updated')
      setEditing(null)
      resetForm()
      load()
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
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Payment Providers</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Configure payment rails and API credentials</p>
        </div>
        <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => { resetForm(); setShowCreate(true) }}>Add Provider</Button>
      </div>

      {/* Active Providers */}
      <Card>
        {loading ? (
          <div className="flex items-center gap-2 text-gray-500 py-4"><Loader2 className="w-5 h-5 animate-spin" /> Loading...</div>
        ) : providers.length === 0 ? (
          <div className="text-center py-8">
            <Plug className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500 mb-2">No payment providers configured</p>
            <p className="text-sm text-gray-400">Add a provider to start accepting payments</p>
          </div>
        ) : (
          <div className="space-y-4">
            {providers.map((p) => (
              <div key={p.id} className={`border rounded-xl p-4 ${p.isActive ? 'border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/10' : 'border-gray-200 dark:border-gray-700'}`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${p.isActive ? 'bg-green-100 dark:bg-green-900/30' : 'bg-gray-100 dark:bg-gray-800'}`}>
                      <CreditCard className={`w-5 h-5 ${p.isActive ? 'text-green-600' : 'text-gray-400'}`} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-gray-900 dark:text-white">{p.name}</h3>
                        <span className="font-mono text-xs text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">{p.code}</span>
                        <Badge>{p.isActive ? 'active' : 'inactive'}</Badge>
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                        <span className="flex items-center gap-1"><Globe className="w-3 h-3" /> {p.countries.join(', ') || 'No countries'}</span>
                        <span className="flex items-center gap-1"><Zap className="w-3 h-3" /> {p.supportedModes.join(', ')}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleToggleActive(p.id, p.isActive)} className="text-gray-400 hover:text-blue-500" title={p.isActive ? 'Deactivate' : 'Activate'}>
                      {p.isActive ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                    <button onClick={() => startEdit(p)} className="text-gray-400 hover:text-blue-500" title="Edit"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => handleDelete(p.id)} className="text-gray-400 hover:text-red-500" title="Delete"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {p.currencies.map((c) => (
                    <span key={c} className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full font-medium">{c}</span>
                  ))}
                </div>
                {p.webhookUrl && (
                  <p className="text-xs text-gray-400 mt-2 font-mono truncate">Webhook: {p.webhookUrl}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Create Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Add Payment Provider">
        <div className="space-y-4">
          {/* Quick templates */}
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Quick Setup</p>
            <div className="flex flex-wrap gap-2">
              {KNOWN_PROVIDERS.map((tmpl) => (
                <button
                  key={tmpl.code}
                  onClick={() => handleSelectTemplate(tmpl)}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${formCode === tmpl.code ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300' : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                >
                  {tmpl.name}
                </button>
              ))}
            </div>
            {formCode && KNOWN_PROVIDERS.find((t) => t.code === formCode) && (
              <p className="text-xs text-gray-400 mt-2">{KNOWN_PROVIDERS.find((t) => t.code === formCode)?.description}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input label="Code" value={formCode} onChange={(e) => setFormCode(e.target.value.toUpperCase())} required placeholder="LAVA" />
            <Input label="Name" value={formName} onChange={(e) => setFormName(e.target.value)} required placeholder="Lava.top" />
          </div>
          <Input label="Currencies (comma-separated)" value={formCurrencies} onChange={(e) => setFormCurrencies(e.target.value)} placeholder="USD, EUR" />
          <Input label="Countries (comma-separated)" value={formCountries} onChange={(e) => setFormCountries(e.target.value)} placeholder="GLOBAL" />
          <Input label="Supported Modes" value={formModes} onChange={(e) => setFormModes(e.target.value)} placeholder="PAYMENT, SUBSCRIPTION" />
          <Input label="Webhook URL" value={formWebhook} onChange={(e) => setFormWebhook(e.target.value)} placeholder="https://billing-api.inite.ai/v1/webhooks/lava" />

          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">API Credentials (optional, add later)</p>
            <div className="grid grid-cols-2 gap-4">
              <Input label="API Key" value={formApiKey} onChange={(e) => setFormApiKey(e.target.value)} placeholder="sk_live_..." />
              <Input label="API Secret" type="password" value={formApiSecret} onChange={(e) => setFormApiSecret(e.target.value)} placeholder="secret..." />
            </div>
          </div>

          <div className="flex gap-3 justify-end">
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} loading={saving}>Create Provider</Button>
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal isOpen={!!editing} onClose={() => { setEditing(null); resetForm() }} title={`Edit ${editing?.name || 'Provider'}`}>
        <div className="space-y-4">
          <Input label="Name" value={formName} onChange={(e) => setFormName(e.target.value)} />
          <Input label="Currencies" value={formCurrencies} onChange={(e) => setFormCurrencies(e.target.value)} />
          <Input label="Countries" value={formCountries} onChange={(e) => setFormCountries(e.target.value)} />
          <Input label="Supported Modes" value={formModes} onChange={(e) => setFormModes(e.target.value)} />
          <Input label="Webhook URL" value={formWebhook} onChange={(e) => setFormWebhook(e.target.value)} />
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <p className="text-sm text-gray-500 mb-2">Update API credentials (leave empty to keep current)</p>
            <div className="grid grid-cols-2 gap-4">
              <Input label="API Key" value={formApiKey} onChange={(e) => setFormApiKey(e.target.value)} placeholder="Leave empty to keep" />
              <Input label="API Secret" type="password" value={formApiSecret} onChange={(e) => setFormApiSecret(e.target.value)} placeholder="Leave empty to keep" />
            </div>
          </div>
          <div className="flex gap-3 justify-end">
            <Button variant="ghost" onClick={() => { setEditing(null); resetForm() }}>Cancel</Button>
            <Button onClick={handleUpdateConfig} loading={saving}>Save Changes</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
