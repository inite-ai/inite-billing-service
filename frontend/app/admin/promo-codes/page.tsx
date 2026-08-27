'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import { Plus, Pencil, Trash2, EyeOff, Eye, Tag } from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import { getErrorMessage } from '@/lib/api-error'
import type { PromoCode, Service } from '@/lib/types'
import { PageHeader } from '@/components/ui/PageHeader'
import { ActiveBadge } from '@/components/ui/StatusBadge'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/ui/ErrorState'
import { IconButton } from '@/components/ui/IconButton'

interface PromoCodeFormData {
  code: string
  name: string
  discountType: 'percentage' | 'fixed_amount'
  discountValue: string
  serviceId: string
  validFrom: string
  validUntil: string
  minPurchaseAmount: string
  maxDiscountAmount: string
  maxUsageCount: string
  maxUsagePerUser: string
}

function defaultDatetime(offsetMs = 0): string {
  const d = new Date(Date.now() + offsetMs)
  return d.toISOString().slice(0, 16)
}

const emptyForm: PromoCodeFormData = {
  code: '',
  name: '',
  discountType: 'percentage',
  discountValue: '',
  serviceId: '',
  validFrom: defaultDatetime(),
  validUntil: defaultDatetime(365 * 24 * 60 * 60 * 1000),
  minPurchaseAmount: '',
  maxDiscountAmount: '',
  maxUsageCount: '',
  maxUsagePerUser: '1',
}

function PromoCodeForm({
  initial,
  services,
  onSubmit,
  onCancel,
  t,
  tc,
  tf,
}: {
  initial?: PromoCode
  services: Service[]
  onSubmit: (data: PromoCodeFormData) => Promise<void>
  onCancel: () => void
  t: (key: string) => string
  tc: (key: string) => string
  tf: (key: string) => string
}) {
  const [form, setForm] = useState<PromoCodeFormData>(() => {
    if (initial) {
      return {
        code: initial.code,
        name: initial.name,
        discountType: initial.discountType,
        discountValue: initial.discountValue,
        serviceId: initial.serviceId || '',
        validFrom: initial.validFrom ? initial.validFrom.slice(0, 16) : '',
        validUntil: initial.validUntil ? initial.validUntil.slice(0, 16) : '',
        minPurchaseAmount: initial.minPurchaseAmount || '',
        maxDiscountAmount: initial.maxDiscountAmount || '',
        maxUsageCount: initial.maxUsageCount?.toString() || '',
        maxUsagePerUser: initial.maxUsagePerUser?.toString() || '1',
      }
    }
    return { ...emptyForm }
  })
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await onSubmit(form)
    } finally {
      setLoading(false)
    }
  }

  const update = (field: keyof PromoCodeFormData, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label={t('promoCodes.tableCode')}
        value={form.code}
        onChange={(e) => update('code', e.target.value.toUpperCase())}
        required
        disabled={!!initial}
        placeholder="SUMMER2024"
      />
      <Input
        label={t('promoCodes.tableName')}
        value={form.name}
        onChange={(e) => update('name', e.target.value)}
        required
      />
      <div className="grid grid-cols-2 gap-4">
        <Select
          label={tf('type')}
          value={form.discountType}
          onChange={(e) => update('discountType', e.target.value)}
          options={[
            { value: 'percentage', label: t('promoCodes.discountTypePercentage') },
            { value: 'fixed_amount', label: t('promoCodes.discountTypeFixed') },
          ]}
        />
        <Input
          label={t('promoCodes.tableDiscount')}
          type="number"
          step="0.01"
          min="0"
          value={form.discountValue}
          onChange={(e) => update('discountValue', e.target.value)}
          required
        />
      </div>
      <Select
        label={tf('service')}
        value={form.serviceId}
        onChange={(e) => update('serviceId', e.target.value)}
        options={[
          { value: '', label: t('promoCodes.allServices') },
          ...services.map((s) => ({ value: s.id, label: s.name })),
        ]}
      />
      <div className="grid grid-cols-2 gap-4">
        <Input
          label={t('promoCodes.validFrom')}
          type="datetime-local"
          value={form.validFrom}
          onChange={(e) => update('validFrom', e.target.value)}
          required
        />
        <Input
          label={t('promoCodes.validUntil')}
          type="datetime-local"
          value={form.validUntil}
          onChange={(e) => update('validUntil', e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Input
          label={t('promoCodes.minPurchase')}
          type="number"
          step="0.01"
          min="0"
          value={form.minPurchaseAmount}
          onChange={(e) => update('minPurchaseAmount', e.target.value)}
        />
        <Input
          label={t('promoCodes.maxDiscount')}
          type="number"
          step="0.01"
          min="0"
          value={form.maxDiscountAmount}
          onChange={(e) => update('maxDiscountAmount', e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Input
          label={t('promoCodes.maxUsage')}
          type="number"
          min="0"
          value={form.maxUsageCount}
          onChange={(e) => update('maxUsageCount', e.target.value)}
        />
        <Input
          label={t('promoCodes.maxUsagePerUser')}
          type="number"
          min="1"
          value={form.maxUsagePerUser}
          onChange={(e) => update('maxUsagePerUser', e.target.value)}
        />
      </div>
      <div className="flex gap-3 justify-end">
        <Button type="button" variant="ghost" onClick={onCancel}>{tc('cancel')}</Button>
        <Button type="submit" loading={loading}>{initial ? tc('update') : tc('create')}</Button>
      </div>
    </form>
  )
}

export default function AdminPromoCodesPage() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const tf = useTranslations('forms')
  const { confirm, DialogElement } = useConfirmDialog()

  const { data: promoCodes, loading, error, refetch } = useApiQuery<PromoCode[]>('/v1/admin/promo-codes')
  const { data: services } = useApiQuery<Service[]>('/v1/admin/services')

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<PromoCode | undefined>()

  const servicesList = services || []

  const handleCreate = async (data: PromoCodeFormData) => {
    const payload: Record<string, unknown> = {
      code: data.code,
      name: data.name,
      discountType: data.discountType,
      discountValue: data.discountValue,
      validFrom: new Date(data.validFrom).toISOString(),
    }
    if (data.serviceId) payload.serviceId = data.serviceId
    if (data.validUntil) payload.validUntil = new Date(data.validUntil).toISOString()
    if (data.minPurchaseAmount) payload.minPurchaseAmount = data.minPurchaseAmount
    if (data.maxDiscountAmount) payload.maxDiscountAmount = data.maxDiscountAmount
    if (data.maxUsageCount) payload.maxUsageCount = parseInt(data.maxUsageCount)
    if (data.maxUsagePerUser) payload.maxUsagePerUser = parseInt(data.maxUsagePerUser)

    await api.post('/v1/admin/promo-codes', payload)
    toast.success(t('promoCodes.created'))
    setShowModal(false)
    refetch()
  }

  const handleUpdate = async (data: PromoCodeFormData) => {
    if (!editing) return
    const payload: Record<string, unknown> = {
      name: data.name,
      discountType: data.discountType,
      discountValue: data.discountValue,
      validFrom: new Date(data.validFrom).toISOString(),
    }
    if (data.serviceId) payload.serviceId = data.serviceId
    else payload.serviceId = null
    if (data.validUntil) payload.validUntil = new Date(data.validUntil).toISOString()
    else payload.validUntil = null
    if (data.minPurchaseAmount) payload.minPurchaseAmount = data.minPurchaseAmount
    else payload.minPurchaseAmount = null
    if (data.maxDiscountAmount) payload.maxDiscountAmount = data.maxDiscountAmount
    else payload.maxDiscountAmount = null
    if (data.maxUsageCount) payload.maxUsageCount = parseInt(data.maxUsageCount)
    else payload.maxUsageCount = null
    if (data.maxUsagePerUser) payload.maxUsagePerUser = parseInt(data.maxUsagePerUser)
    else payload.maxUsagePerUser = null

    await api.put(`/v1/admin/promo-codes/${editing.id}`, payload)
    toast.success(t('promoCodes.updated'))
    setShowModal(false)
    setEditing(undefined)
    refetch()
  }

  const handleToggleActive = async (id: string, isActive: boolean) => {
    try {
      await api.put(`/v1/admin/promo-codes/${id}`, { isActive: !isActive })
      toast.success(isActive ? t('promoCodes.deactivated') : t('promoCodes.activated'))
      refetch()
    } catch (e) {
      toast.error(getErrorMessage(e, 'Failed to toggle promo code status'))
    }
  }

  const handleDelete = async (id: string) => {
    const promo = (promoCodes || []).find((p) => p.id === id)
    const ok = await confirm({
      title: t('promoCodes.deleteConfirm'),
      message: t('promoCodes.deleteConfirm'),
      record: promo ? promo.code : id,
      variant: 'danger',
    })
    if (!ok) return
    try {
      await api.delete(`/v1/admin/promo-codes/${id}`)
      toast.success(t('promoCodes.deleted'))
      refetch()
    } catch (e) {
      toast.error(getErrorMessage(e, t('promoCodes.deleteError')))
    }
  }

  const promoList = promoCodes || []

  const formatDiscount = (promo: PromoCode) => {
    if (promo.discountType === 'percentage') {
      return `${promo.discountValue}%`
    }
    return `$${promo.discountValue}`
  }

  const getServiceName = (serviceId?: string) => {
    if (!serviceId) return t('promoCodes.allServices')
    const service = servicesList.find((s) => s.id === serviceId)
    return service?.name || serviceId
  }

  const formatUsage = (promo: PromoCode) => {
    if (promo.maxUsageCount) {
      return `${promo.currentUsageCount} / ${promo.maxUsageCount}`
    }
    return `${promo.currentUsageCount}`
  }

  const isExpired = (promo: PromoCode) => {
    if (!promo.validUntil) return false
    return new Date(promo.validUntil) < new Date()
  }

  return (
    <div>
      <PageHeader
        title={t('promoCodes.title')}
        subtitle={t('promoCodes.subtitle')}
        actions={
    <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => { setEditing(undefined); setShowModal(true) }}>
              {t('promoCodes.addPromoCode')}
            </Button>
        }
      />
      <Card>
        {loading ? (
          <TableSkeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : promoList.length === 0 ? (
          <EmptyState icon={Tag} title={t('promoCodes.noPromoCodes')} subtitle={t('promoCodes.noPromoCodesHint')} />
        ) : (
          <Table>
            <Thead>
              <tr>
                <Th>{t('promoCodes.tableCode')}</Th>
                <Th>{t('promoCodes.tableName')}</Th>
                <Th>{t('promoCodes.tableDiscount')}</Th>
                <Th>{t('promoCodes.tableService')}</Th>
                <Th>{t('promoCodes.tableUsage')}</Th>
                <Th>{t('promoCodes.tableValid')}</Th>
                <Th>{t('promoCodes.tableStatus')}</Th>
                <Th>{t('promoCodes.tableActions')}</Th>
              </tr>
            </Thead>
            <Tbody>
              {promoList.map((promo) => (
                <tr key={promo.id}>
                  <Td className="font-mono font-semibold">{promo.code}</Td>
                  <Td>{promo.name}</Td>
                  <Td>
                    <Badge variant={promo.discountType === 'percentage' ? 'info' : 'default'}>
                      {formatDiscount(promo)}
                    </Badge>
                  </Td>
                  <Td>{getServiceName(promo.serviceId)}</Td>
                  <Td>{formatUsage(promo)}</Td>
                  <Td>
                    {promo.validUntil
                      ? new Date(promo.validUntil).toLocaleDateString()
                      : t('promoCodes.unlimited')}
                  </Td>
                  <Td>
                    {isExpired(promo) ? (
                      <Badge variant="error">{t('promoCodes.expired')}</Badge>
                    ) : (
                      <ActiveBadge active={promo.isActive} />
                    )}
                  </Td>
                  <Td>
                    <div className="flex gap-2">
                      <IconButton onClick={() => { setEditing(promo); setShowModal(true) }} tone="primary" label={tc('edit')} icon={<Pencil className="w-4 h-4" />} />
                      <IconButton
                        onClick={() => handleToggleActive(promo.id, promo.isActive)}
                        tone="warning"
                        label={promo.isActive ? tc('deactivate') : tc('activate')}
                        icon={promo.isActive ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      />
                      <IconButton
                        onClick={() => handleDelete(promo.id)}
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

      <Modal
        isOpen={showModal}
        onClose={() => { setShowModal(false); setEditing(undefined) }}
        title={editing ? t('promoCodes.editTitle') : t('promoCodes.createTitle')}
      >
        <PromoCodeForm
          initial={editing}
          services={servicesList}
          onSubmit={editing ? handleUpdate : handleCreate}
          onCancel={() => { setShowModal(false); setEditing(undefined) }}
          t={t}
          tc={tc}
          tf={tf}
        />
      </Modal>

      {DialogElement}
    </div>
  )
}
