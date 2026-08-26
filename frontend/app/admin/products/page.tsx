'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { Select } from '@/components/ui/Select'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import { ProductForm } from '@/components/admin/ProductForm'
import { Plus, Trash2, Eye, EyeOff, Package } from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import { getErrorMessage } from '@/lib/api-error'
import type { Product, Service } from '@/lib/types'
import { ActiveBadge } from '@/components/ui/StatusBadge'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/ui/ErrorState'
import { IconButton } from '@/components/ui/IconButton'

export default function AdminProductsPage() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const { confirm, DialogElement } = useConfirmDialog()

  const [filterService, setFilterService] = useState('')
  const [showModal, setShowModal] = useState(false)

  const productsUrl = filterService
    ? `/v1/admin/products?serviceId=${filterService}`
    : '/v1/admin/products'
  const { data: products, loading, error, refetch } = useApiQuery<Product[]>(productsUrl)
  const { data: services } = useApiQuery<Service[]>('/v1/admin/services')

  const handleCreate = async (data: any) => {
    await api.post('/v1/admin/products', data)
    toast.success(t('products.created'))
    setShowModal(false)
    refetch()
  }

  const handleToggleActive = async (id: string, isActive: boolean) => {
    try {
      await api.put(`/v1/admin/products/${id}`, { isActive: !isActive })
      toast.success(isActive ? t('products.deactivated') : t('products.activated'))
      refetch()
    } catch (e) {
      toast.error(getErrorMessage(e, 'Failed to toggle product status'))
    }
  }

  const handleDelete = async (id: string) => {
    // Deleting a product takes its prices with it; the dialog names which one.
    const product = (products || []).find((p) => p.id === id)
    const ok = await confirm({
      title: t('products.deleteConfirm'),
      message: t('products.deleteConfirm'),
      record: product ? `${product.name} · ${product.code}` : id,
      variant: 'danger',
    })
    if (!ok) return
    try {
      await api.delete(`/v1/admin/products/${id}`)
      toast.success(t('products.deleted'))
      refetch()
    } catch (e) {
      toast.error(getErrorMessage(e, t('products.deleteError')))
    }
  }

  const servicesList = services || []

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('products.title')}</h1>
        <div className="flex gap-3">
          {servicesList.length > 0 && (
            <div className="w-48">
              <Select value={filterService} onChange={(e) => setFilterService(e.target.value)} options={[
                { value: '', label: t('products.allServices') },
                ...servicesList.map((s) => ({ value: s.id, label: s.name })),
              ]} />
            </div>
          )}
          <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setShowModal(true)}>{t('products.addProduct')}</Button>
        </div>
      </div>

      <Card>
        {loading ? (
          <TableSkeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : !products || products.length === 0 ? (
          <EmptyState icon={Package} title={t('products.noProducts')} />
        ) : (
          <>
            <p className="text-sm text-slate-500 mb-3">{t('products.productCount', { count: products.length })}</p>
            <Table>
              <Thead>
                <tr><Th>{t('products.tableCode')}</Th><Th>{t('products.tableName')}</Th><Th>{t('products.tableType')}</Th><Th>{t('products.tableService')}</Th><Th>{t('products.tablePrices')}</Th><Th>{t('products.tableStatus')}</Th><Th>{t('products.tableActions')}</Th></tr>
              </Thead>
              <Tbody>
                {products.map((p) => (
                  <tr key={p.id}>
                    <Td className="font-mono text-sm">{p.code}</Td>
                    <Td className="font-semibold">{p.name}</Td>
                    <Td><Badge>{t.has(`products.types.${p.type}`) ? t(`products.types.${p.type}`) : p.type}</Badge></Td>
                    <Td>{p.service?.name || <span className="text-slate-400">-</span>}</Td>
                    <Td>{p.prices?.length || 0}</Td>
                    <Td><ActiveBadge active={p.isActive} /></Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <IconButton
                          onClick={() => handleToggleActive(p.id, p.isActive)}
                          tone="primary"
                          label={p.isActive ? tc('deactivate') : tc('activate')}
                          icon={p.isActive ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
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
          </>
        )}
      </Card>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={t('products.createTitle')}>
        <ProductForm services={servicesList} onSubmit={handleCreate} onCancel={() => setShowModal(false)} />
      </Modal>

      {DialogElement}
    </div>
  )
}
