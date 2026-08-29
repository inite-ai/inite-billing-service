'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import { Tabs } from '@/components/ui/Tabs'
import { Gauge, Loader2, Plus, Pencil, Trash2 } from 'lucide-react'
import api from '@/lib/api'
import { IconButton } from '@/components/ui/IconButton'
import { Button } from '@/components/ui/Button'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import toast from 'react-hot-toast'
import { getErrorMessage } from '@/lib/api-error'

const errorMessage = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { message?: string } } }).response?.data?.message || fallback

interface Feature {
  id: string
  code: string
  name: string
  serviceId: string | null
  service?: { code: string; name: string } | null
  unit: string
  creditsPerUnit: string
  tierRates: Record<string, number> | null
  isActive: boolean
}

interface Quota {
  id: string
  featureId: string | null
  feature?: { code: string; name: string } | null
  serviceId: string | null
  userId: string | null
  window: string
  limitUnits: number | null
  limitCredits: number | null
  softCapPct: number
  overagePolicy: string
  isActive: boolean
}

interface UsageRow {
  featureCode: string | null
  featureName: string
  unit: string | null
  totalCredits: number
  totalUnits: number
  eventCount: number
}

const emptyFeatureForm = {
  code: '',
  name: '',
  unit: 'requests',
  creditsPerUnit: '1',
  tierRatesText: '{}',
}

const emptyQuotaForm = {
  featureId: '',
  userId: '',
  window: 'month',
  limitUnits: '',
  limitCredits: '',
  softCapPct: '80',
  overagePolicy: 'block',
}

export default function AdminMeteringPage() {
  const t = useTranslations('admin.metering')
  const { confirm, DialogElement } = useConfirmDialog()
  const tc = useTranslations('common')
  const [tab, setTab] = useState('features')
  const [loading, setLoading] = useState(true)
  const [features, setFeatures] = useState<Feature[]>([])
  const [quotas, setQuotas] = useState<Quota[]>([])
  const [usage, setUsage] = useState<UsageRow[]>([])
  const [featureModal, setFeatureModal] = useState<null | { id?: string }>(null)
  const [quotaModal, setQuotaModal] = useState(false)
  const [featureForm, setFeatureForm] = useState(emptyFeatureForm)
  const [quotaForm, setQuotaForm] = useState(emptyQuotaForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [featRes, quotaRes, usageRes] = await Promise.all([
        api.get('/v1/admin/metering/features'),
        api.get('/v1/admin/metering/quotas'),
        api.get('/v1/admin/metering/usage'),
      ])
      setFeatures(featRes.data ?? [])
      setQuotas(quotaRes.data ?? [])
      setUsage(usageRes.data ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const openFeatureModal = (feature?: Feature) => {
    setFormError(null)
    if (feature) {
      setFeatureForm({
        code: feature.code,
        name: feature.name,
        unit: feature.unit,
        creditsPerUnit: String(feature.creditsPerUnit),
        tierRatesText: JSON.stringify(feature.tierRates ?? {}, null, 0),
      })
      setFeatureModal({ id: feature.id })
    } else {
      setFeatureForm(emptyFeatureForm)
      setFeatureModal({})
    }
  }

  const saveFeature = async () => {
    setSaving(true)
    setFormError(null)
    try {
      let tierRates: Record<string, number>
      try {
        tierRates = JSON.parse(featureForm.tierRatesText || '{}')
      } catch {
        setFormError(t('invalidTierRates'))
        return
      }
      const payload = {
        code: featureForm.code,
        name: featureForm.name,
        unit: featureForm.unit,
        creditsPerUnit: parseFloat(featureForm.creditsPerUnit),
        tierRates,
      }
      if (featureModal?.id) {
        const { code: _code, ...rest } = payload
        await api.put(`/v1/admin/metering/features/${featureModal.id}`, rest)
      } else {
        await api.post('/v1/admin/metering/features', payload)
      }
      setFeatureModal(null)
      load()
    } catch (err) {
      setFormError(getErrorMessage(err, 'Error'))
    } finally {
      setSaving(false)
    }
  }

  // These three had no error path at all: a rejected request left the row
  // exactly as it was and said nothing, so a failed delete looked like a
  // delete that had not been clicked yet.
  const toggleFeature = async (feature: Feature) => {
    try {
      await api.put(`/v1/admin/metering/features/${feature.id}`, {
        isActive: !feature.isActive,
      })
    } catch (e) {
      toast.error(errorMessage(e, t('actionFailed')))
    } finally {
      load()
    }
  }

  const deleteFeature = async (feature: Feature) => {
    const ok = await confirm({
      title: t('confirmDelete', { name: feature.code }),
      message: t('confirmDelete', { name: feature.code }),
      record: `${feature.name} · ${feature.code}`,
      variant: 'danger',
    })
    if (!ok) return
    try {
      await api.delete(`/v1/admin/metering/features/${feature.id}`)
    } catch (e) {
      toast.error(errorMessage(e, t('actionFailed')))
    } finally {
      load()
    }
  }

  const saveQuota = async () => {
    setSaving(true)
    setFormError(null)
    try {
      await api.post('/v1/admin/metering/quotas', {
        featureId: quotaForm.featureId || undefined,
        userId: quotaForm.userId || undefined,
        window: quotaForm.window,
        limitUnits: quotaForm.limitUnits
          ? parseInt(quotaForm.limitUnits, 10)
          : undefined,
        limitCredits: quotaForm.limitCredits
          ? parseInt(quotaForm.limitCredits, 10)
          : undefined,
        softCapPct: parseInt(quotaForm.softCapPct, 10) || 80,
        overagePolicy: quotaForm.overagePolicy,
      })
      setQuotaModal(false)
      setQuotaForm(emptyQuotaForm)
      load()
    } catch (err) {
      setFormError(getErrorMessage(err, 'Error'))
    } finally {
      setSaving(false)
    }
  }

  const deleteQuota = async (quota: Quota) => {
    const ok = await confirm({
      title: t('confirmDeleteQuota'),
      message: t('confirmDeleteQuota'),
      record: `${quota.feature?.code ?? t('allFeatures')} · ${quota.window}`,
      variant: 'danger',
    })
    if (!ok) return
    try {
      await api.delete(`/v1/admin/metering/quotas/${quota.id}`)
    } catch (e) {
      toast.error(errorMessage(e, t('actionFailed')))
    } finally {
      load()
    }
  }

  const maxCredits = Math.max(1, ...usage.map((u) => u.totalCredits))

  const inputCls =
    'w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900'

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <Gauge className="w-6 h-6 text-violet-500" />
        {t('title')}
      </h1>

      <Tabs
        tabs={[
          { key: 'features', label: t('tabFeatures') },
          { key: 'quotas', label: t('tabQuotas') },
          { key: 'usage', label: t('tabUsage') },
        ]}
        activeTab={tab}
        onChange={setTab}
      />

      {loading ? (
        <div className="py-12 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
        </div>
      ) : tab === 'features' ? (
        <Card>
          <div className="flex justify-end mb-4">
            <Button onClick={() => openFeatureModal()} icon={<Plus className="w-4 h-4" />} size="sm">
  {t('addFeature')}
            </Button>
          </div>
          <Table>
            <Thead>
              <tr>
                <Th>{t('columns.code')}</Th>
                <Th>{t('columns.name')}</Th>
                <Th>{t('columns.unit')}</Th>
                <Th>{t('columns.rate')}</Th>
                <Th>{t('columns.tierRates')}</Th>
                <Th>{t('columns.status')}</Th>
                <Th>{''}</Th>
              </tr>
            </Thead>
            <Tbody>
              {features.map((f) => (
                <tr key={f.id}>
                  <Td className="font-mono text-xs">{f.code}</Td>
                  <Td>{f.name}</Td>
                  <Td>{f.unit}</Td>
                  <Td>{Number(f.creditsPerUnit)}</Td>
                  <Td className="font-mono text-xs">
                    {JSON.stringify(f.tierRates ?? {})}
                  </Td>
                  <Td>
                    <button onClick={() => toggleFeature(f)}>
                      <Badge variant={f.isActive ? 'success' : 'default'}>
                        {f.isActive ? t('active') : t('inactive')}
                      </Badge>
                    </button>
                  </Td>
                  <Td>
                    <div className="flex gap-1">
                      <IconButton
                        onClick={() => openFeatureModal(f)}
                        tone="primary"
                        label={tc('edit')}
                        icon={<Pencil className="w-4 h-4" />}
                      />
                      <IconButton
                        onClick={() => deleteFeature(f)}
                        tone="danger"
                        label={tc('delete')}
                        icon={<Trash2 className="w-4 h-4" />}
                      />
                    </div>
                  </Td>
                </tr>
              ))}
              {features.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-sm text-center text-slate-500"
                  >
                    {t('emptyFeatures')}
                  </td>
                </tr>
              )}
            </Tbody>
          </Table>
        </Card>
      ) : tab === 'quotas' ? (
        <Card>
          <div className="flex justify-end mb-4">
            <Button onClick={() => {
                setFormError(null)
                setQuotaModal(true)
              }} icon={<Plus className="w-4 h-4" />} size="sm">
  {t('addQuota')}
            </Button>
          </div>
          <Table>
            <Thead>
              <tr>
                <Th>{t('columns.feature')}</Th>
                <Th>{t('columns.scope')}</Th>
                <Th>{t('columns.window')}</Th>
                <Th>{t('columns.limits')}</Th>
                <Th>{t('columns.softCap')}</Th>
                <Th>{t('columns.policy')}</Th>
                <Th>{''}</Th>
              </tr>
            </Thead>
            <Tbody>
              {quotas.map((q) => (
                <tr key={q.id}>
                  <Td className="font-mono text-xs">
                    {q.feature?.code ?? t('allFeatures')}
                  </Td>
                  <Td className="font-mono text-xs">
                    {q.userId ? `user: ${q.userId.slice(0, 10)}…` : t('allUsers')}
                  </Td>
                  <Td>{q.window}</Td>
                  <Td className="text-xs">
                    {q.limitCredits != null && `${q.limitCredits} cr`}
                    {q.limitCredits != null && q.limitUnits != null && ' / '}
                    {q.limitUnits != null && `${q.limitUnits} u`}
                  </Td>
                  <Td>{q.softCapPct}%</Td>
                  <Td>
                    <Badge variant={q.overagePolicy === 'block' ? 'warning' : 'info'}>
                      {q.overagePolicy}
                    </Badge>
                  </Td>
                  <Td>
                    <IconButton
                      onClick={() => deleteQuota(q)}
                      tone="danger"
                      label={tc('delete')}
                      icon={<Trash2 className="w-4 h-4" />}
                    />
                  </Td>
                </tr>
              ))}
              {quotas.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-sm text-center text-slate-500"
                  >
                    {t('emptyQuotas')}
                  </td>
                </tr>
              )}
            </Tbody>
          </Table>
        </Card>
      ) : (
        <Card>
          <h2 className="text-sm font-semibold text-slate-500 mb-4">
            {t('usageLast30d')}
          </h2>
          <div className="space-y-3">
            {usage.map((u) => (
              <div key={u.featureCode ?? 'unmetered'}>
                <div className="flex justify-between text-sm mb-1">
                  <span>
                    {u.featureName}
                    {u.unit && (
                      <span className="text-slate-400"> · {u.unit}</span>
                    )}
                  </span>
                  <span className="text-slate-500">
                    {u.totalCredits} cr · {u.eventCount} {t('events')}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-500 to-purple-500"
                    style={{ width: `${(u.totalCredits / maxCredits) * 100}%` }}
                  />
                </div>
              </div>
            ))}
            {usage.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-8">
                {t('emptyUsage')}
              </p>
            )}
          </div>
        </Card>
      )}

      {/* Feature modal */}
      <Modal
        isOpen={!!featureModal}
        onClose={() => setFeatureModal(null)}
        title={featureModal?.id ? t('editFeature') : t('addFeature')}
      >
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-500">{t('columns.code')}</label>
            <input
              className={inputCls}
              value={featureForm.code}
              disabled={!!featureModal?.id}
              onChange={(e) =>
                setFeatureForm({ ...featureForm, code: e.target.value })
              }
              placeholder="ai.chat.tokens"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">{t('columns.name')}</label>
            <input
              className={inputCls}
              value={featureForm.name}
              onChange={(e) =>
                setFeatureForm({ ...featureForm, name: e.target.value })
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500">{t('columns.unit')}</label>
              <select
                className={inputCls}
                value={featureForm.unit}
                onChange={(e) =>
                  setFeatureForm({ ...featureForm, unit: e.target.value })
                }
              >
                {['tokens', 'requests', 'generations', 'seconds'].map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500">{t('columns.rate')}</label>
              <input
                className={inputCls}
                type="number"
                step="0.000001"
                value={featureForm.creditsPerUnit}
                onChange={(e) =>
                  setFeatureForm({ ...featureForm, creditsPerUnit: e.target.value })
                }
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500">
              {t('columns.tierRates')} — JSON
            </label>
            <input
              className={`${inputCls} font-mono`}
              value={featureForm.tierRatesText}
              onChange={(e) =>
                setFeatureForm({ ...featureForm, tierRatesText: e.target.value })
              }
              placeholder='{"opus": 5, "haiku": 0.25}'
            />
          </div>
          {formError && <p className="text-xs text-red-500">{formError}</p>}
          <Button onClick={saveFeature} loading={saving} disabled={!featureForm.code || !featureForm.name} className="w-full">
  {t('save')}
            </Button>
        </div>
      </Modal>

      {/* Quota modal */}
      <Modal
        isOpen={quotaModal}
        onClose={() => setQuotaModal(false)}
        title={t('addQuota')}
      >
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-500">{t('columns.feature')}</label>
            <select
              className={inputCls}
              value={quotaForm.featureId}
              onChange={(e) =>
                setQuotaForm({ ...quotaForm, featureId: e.target.value })
              }
            >
              <option value="">{t('allFeatures')}</option>
              {features.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.code}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500">
              {t('quotaUserHint')}
            </label>
            <input
              className={inputCls}
              value={quotaForm.userId}
              onChange={(e) =>
                setQuotaForm({ ...quotaForm, userId: e.target.value })
              }
              placeholder={t('allUsers')}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500">{t('columns.window')}</label>
              <select
                className={inputCls}
                value={quotaForm.window}
                onChange={(e) =>
                  setQuotaForm({ ...quotaForm, window: e.target.value })
                }
              >
                {['day', 'week', 'month', 'billing_period'].map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500">{t('columns.softCap')}</label>
              <input
                className={inputCls}
                type="number"
                min={1}
                max={100}
                value={quotaForm.softCapPct}
                onChange={(e) =>
                  setQuotaForm({ ...quotaForm, softCapPct: e.target.value })
                }
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500">{t('limitCredits')}</label>
              <input
                className={inputCls}
                type="number"
                min={1}
                value={quotaForm.limitCredits}
                onChange={(e) =>
                  setQuotaForm({ ...quotaForm, limitCredits: e.target.value })
                }
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">{t('limitUnits')}</label>
              <input
                className={inputCls}
                type="number"
                min={1}
                value={quotaForm.limitUnits}
                onChange={(e) =>
                  setQuotaForm({ ...quotaForm, limitUnits: e.target.value })
                }
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500">{t('columns.policy')}</label>
            <select
              className={inputCls}
              value={quotaForm.overagePolicy}
              onChange={(e) =>
                setQuotaForm({ ...quotaForm, overagePolicy: e.target.value })
              }
            >
              <option value="block">block</option>
              <option value="notify_only">notify_only</option>
            </select>
          </div>
          {formError && <p className="text-xs text-red-500">{formError}</p>}
          <Button onClick={saveQuota} loading={saving} disabled={(!quotaForm.limitCredits && !quotaForm.limitUnits)} className="w-full">
  {t('save')}
            </Button>
        </div>
      </Modal>

      {DialogElement}
    </div>
  )
}
