'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import { Plus, Trash2, Wallet, Loader2, Power, PowerOff } from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import { PageHeader } from '@/components/ui/PageHeader'
import { ActiveBadge } from '@/components/ui/StatusBadge'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { IconButton } from '@/components/ui/IconButton'

interface PayoutProvider {
  id: string
  code: string
  name: string
  isActive: boolean
  currencies: string[]
  minAmount: string | null
  maxAmount: string | null
  feePercent: string | null
  feeFixed: string | null
  config: any
  metadata: any
  createdAt: string
}

export default function AdminPayoutProvidersPage() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')

  const [providers, setProviders] = useState<PayoutProvider[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ code: '', name: '', currencies: 'USD', minAmount: '', maxAmount: '', feePercent: '', feeFixed: '' })

  const load = async () => {
    try {
      const res = await api.get('/v1/admin/payout-providers')
      setProviders(res.data)
    } catch {
      toast.error('Failed to load payout providers')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleCreate = async () => {
    try {
      await api.post('/v1/admin/payout-providers', {
        code: form.code,
        name: form.name,
        currencies: form.currencies.split(',').map((c) => c.trim()).filter(Boolean),
        minAmount: form.minAmount ? parseFloat(form.minAmount) : undefined,
        maxAmount: form.maxAmount ? parseFloat(form.maxAmount) : undefined,
        feePercent: form.feePercent ? parseFloat(form.feePercent) / 100 : undefined,
        feeFixed: form.feeFixed ? parseFloat(form.feeFixed) : undefined,
      })
      toast.success(t('payoutProviders.created'))
      setShowCreate(false)
      setForm({ code: '', name: '', currencies: 'USD', minAmount: '', maxAmount: '', feePercent: '', feeFixed: '' })
      load()
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to create')
    }
  }

  const handleToggle = async (id: string, isActive: boolean) => {
    try {
      await api.put(`/v1/admin/payout-providers/${id}`, { isActive: !isActive })
      toast.success(isActive ? t('payoutProviders.deactivated') : t('payoutProviders.activated'))
      load()
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm(t('payoutProviders.deleteConfirm'))) return
    try {
      await api.delete(`/v1/admin/payout-providers/${id}`)
      toast.success(t('payoutProviders.deleted'))
      load()
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to delete')
    }
  }

  return (
    <div>
      <PageHeader
        title={t('payoutProviders.title')}
        subtitle={t('payoutProviders.subtitle')}
        actions={
    <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setShowCreate(true)}>
              {t('payoutProviders.addProvider')}
            </Button>
        }
      />
      <Card>
        {loading ? (
          <TableSkeleton />
        ) : providers.length === 0 ? (
          <div className="text-center py-8">
            <Wallet className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
            <p className="text-slate-500 mb-2">{t('payoutProviders.noProviders')}</p>
            <p className="text-sm text-slate-400">{t('payoutProviders.noProvidersHint')}</p>
          </div>
        ) : (
          <Table>
            <Thead>
              <tr>
                <Th>{t('payoutProviders.tableCode')}</Th>
                <Th>{t('payoutProviders.tableName')}</Th>
                <Th>{t('payoutProviders.tableCurrencies')}</Th>
                <Th>{t('payoutProviders.tableFee')}</Th>
                <Th>{t('payoutProviders.tableLimits')}</Th>
                <Th>{t('payoutProviders.tableStatus')}</Th>
                <Th>{t('payoutProviders.tableActions')}</Th>
              </tr>
            </Thead>
            <Tbody>
              {providers.map((p) => (
                <tr key={p.id} className="table-row-hover">
                  <Td className="font-mono font-semibold">{p.code}</Td>
                  <Td>{p.name}</Td>
                  <Td>
                    <div className="flex gap-1 flex-wrap">
                      {p.currencies.map((c) => (
                        <span key={c} className="text-xs bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">{c}</span>
                      ))}
                    </div>
                  </Td>
                  <Td>
                    {p.feePercent ? `${(Number(p.feePercent) * 100).toFixed(1)}%` : ''}
                    {p.feePercent && p.feeFixed ? ' + ' : ''}
                    {p.feeFixed ? `$${Number(p.feeFixed).toFixed(2)}` : ''}
                    {!p.feePercent && !p.feeFixed ? <span className="text-slate-400">—</span> : ''}
                  </Td>
                  <Td>
                    <span className="text-xs text-slate-500">
                      {p.minAmount ? `$${Number(p.minAmount).toFixed(0)}` : '—'}
                      {' — '}
                      {p.maxAmount ? `$${Number(p.maxAmount).toFixed(0)}` : '∞'}
                    </span>
                  </Td>
                  <Td><ActiveBadge active={p.isActive} /></Td>
                  <Td>
                    <div className="flex gap-2">
                      <IconButton
                        onClick={() => handleToggle(p.id, p.isActive)}
                        tone={p.isActive ? 'warning' : 'success'}
                        label={p.isActive ? tc('deactivate') : tc('activate')}
                        icon={p.isActive ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
                      />
                      <IconButton
                        onClick={() => handleDelete(p.id)}
                        tone="danger"
                        label={tc('delete')}
                        icon={<Trash2 className="w-4 h-4" />}
                      />
                    </div>
                  </Td>
                </tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Card>

      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title={t('payoutProviders.createTitle')}>
        <div className="space-y-4">
          <Input label={t('payoutProviders.fieldCode')} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="BANK_WIRE" />
          <Input label={t('payoutProviders.fieldName')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Bank Wire Transfer" />
          <Input label={t('payoutProviders.fieldCurrencies')} value={form.currencies} onChange={(e) => setForm({ ...form, currencies: e.target.value })} placeholder="USD, EUR" />
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('payoutProviders.fieldMinAmount')} type="number" value={form.minAmount} onChange={(e) => setForm({ ...form, minAmount: e.target.value })} placeholder="10" />
            <Input label={t('payoutProviders.fieldMaxAmount')} type="number" value={form.maxAmount} onChange={(e) => setForm({ ...form, maxAmount: e.target.value })} placeholder="10000" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('payoutProviders.fieldFeePercent')} type="number" step="0.1" value={form.feePercent} onChange={(e) => setForm({ ...form, feePercent: e.target.value })} placeholder="2.5" />
            <Input label={t('payoutProviders.fieldFeeFixed')} type="number" step="0.01" value={form.feeFixed} onChange={(e) => setForm({ ...form, feeFixed: e.target.value })} placeholder="0.50" />
          </div>
          <div className="flex gap-3 pt-2">
            <Button onClick={handleCreate} className="flex-1">{tc('create')}</Button>
            <Button variant="secondary" onClick={() => setShowCreate(false)}>{tc('cancel')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
