'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import { PriceForm } from '@/components/admin/PriceForm'
import { Plus, Trash2 } from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import type { Price, Product } from '@/lib/types'

export default function AdminPricesPage() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')

  const [prices, setPrices] = useState<Price[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    const [priceRes, prodRes] = await Promise.all([
      api.get('/v1/admin/prices'),
      api.get('/v1/admin/products'),
    ])
    setPrices(priceRes.data)
    setProducts(prodRes.data)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleCreate = async (data: any) => {
    await api.post('/v1/admin/prices', data)
    toast.success(t('prices.created'))
    setShowModal(false)
    load()
  }

  const handleDelete = async (id: string) => {
    if (!confirm(t('prices.deleteConfirm'))) return
    await api.delete(`/v1/admin/prices/${id}`)
    toast.success(t('prices.deleted'))
    load()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('prices.title')}</h1>
        <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setShowModal(true)}>{t('prices.addPrice')}</Button>
      </div>

      <Card>
        {loading ? <div className="text-gray-500 py-4">{tc('loading')}</div> : (
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
                  <Td><Badge>{p.isActive ? tc('status.active') : tc('status.inactive')}</Badge></Td>
                  <Td><button onClick={() => handleDelete(p.id)} className="text-gray-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button></Td>
                </tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Card>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={t('prices.createTitle')}>
        <PriceForm products={products} onSubmit={handleCreate} onCancel={() => setShowModal(false)} />
      </Modal>
    </div>
  )
}
