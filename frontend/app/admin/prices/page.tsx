'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import { PriceForm, type PriceFormValues } from '@/components/admin/PriceForm'
import { Plus, Trash2 } from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import type { Price, Product } from '@/lib/types'
import { ActiveBadge } from '@/components/ui/StatusBadge'
import { IconButton } from '@/components/ui/IconButton'

export default function AdminPricesPage() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')

  const [prices, setPrices] = useState<Price[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState(true)
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
      const [priceRes, prodRes] = await Promise.all([
        api.get('/v1/admin/prices'),
        api.get('/v1/admin/products'),
      ])
      setPrices(priceRes.data)
      setProducts(prodRes.data)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      toast.error(err.response?.data?.message || 'Failed to load prices')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleCreate = async (data: PriceFormValues) => {
    await api.post('/v1/admin/prices', data)
    toast.success(t('prices.created'))
    setShowModal(false)
    load()
  }

  const handleDelete = (id: string) => {
    setConfirmState({
      isOpen: true,
      title: t('prices.deleteConfirm'),
      message: t('prices.deleteConfirm'),
      variant: 'danger',
      onConfirm: async () => {
        try {
          await api.delete(`/v1/admin/prices/${id}`)
          toast.success(t('prices.deleted'))
          load()
        } catch (e: unknown) {
          const err = e as { response?: { data?: { message?: string } } }
          toast.error(err.response?.data?.message || 'Failed to delete price')
          throw e
        }
      },
    })
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('prices.title')}</h1>
        <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setShowModal(true)}>{t('prices.addPrice')}</Button>
      </div>

      <Card>
        {loading ? <div className="text-slate-500 py-4">{tc('loading')}</div> : (
          <Table>
            <Thead>
              <tr><Th>{t('prices.tableCode')}</Th><Th>{t('prices.tableProduct')}</Th><Th>{t('prices.tableAmount')}</Th><Th>{t('prices.tableInterval')}</Th><Th>{t('prices.tableStatus')}</Th><Th>{t('prices.tableActions')}</Th></tr>
            </Thead>
            <Tbody>
              {prices.map((p) => (
                <tr key={p.id}>
                  <Td className="font-mono">{p.code}</Td>
                  <Td>{p.product?.name || p.productId}</Td>
                  <Td className="font-semibold">{p.amount} {p.currency}</Td>
                  <Td>{p.interval || t('prices.oneTime')}</Td>
                  <Td><ActiveBadge active={p.isActive} /></Td>
                  <Td>
                    <IconButton
                      onClick={() => handleDelete(p.id)}
                      tone="danger"
                      label={tc('delete')}
                      icon={<Trash2 className="w-4 h-4" />}
                    />
                  </Td>
                </tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Card>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={t('prices.createTitle')}>
        <PriceForm products={products} onSubmit={handleCreate} onCancel={() => setShowModal(false)} />
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
