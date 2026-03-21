'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import { ProductForm } from '@/components/admin/ProductForm'
import { Plus, Trash2, Pencil, Eye, EyeOff, Package, Loader2 } from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import type { Product, Service } from '@/lib/types'

export default function AdminProductsPage() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')

  const [products, setProducts] = useState<Product[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [filterService, setFilterService] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    const params: Record<string, string> = {}
    if (filterService) params.serviceId = filterService
    const [prodRes, svcRes] = await Promise.all([
      api.get('/v1/admin/products', { params }),
      api.get('/v1/admin/services').catch(() => ({ data: [] })),
    ])
    setProducts(prodRes.data)
    setServices(svcRes.data)
    setLoading(false)
  }

  useEffect(() => { load() }, [filterService])

  const handleCreate = async (data: any) => {
    await api.post('/v1/admin/products', data)
    toast.success(t('products.created'))
    setShowModal(false)
    load()
  }

  const handleToggleActive = async (id: string, isActive: boolean) => {
    await api.put(`/v1/admin/products/${id}`, { isActive: !isActive })
    toast.success(isActive ? t('products.deactivated') : t('products.activated'))
    load()
  }

  const handleDelete = async (id: string) => {
    if (!confirm(t('products.deleteConfirm'))) return
    try {
      await api.delete(`/v1/admin/products/${id}`)
      toast.success(t('products.deleted'))
      load()
    } catch (e: any) {
      toast.error(e.response?.data?.message || t('products.deleteError'))
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('products.title')}</h1>
        <div className="flex gap-3">
          {services.length > 0 && (
            <div className="w-48">
              <Select value={filterService} onChange={(e) => setFilterService(e.target.value)} options={[
                { value: '', label: t('products.allServices') },
                ...services.map((s) => ({ value: s.id, label: s.name })),
              ]} />
            </div>
          )}
          <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setShowModal(true)}>{t('products.addProduct')}</Button>
        </div>
      </div>

      <Card>
        {loading ? (
          <div className="flex items-center gap-2 text-gray-500 py-4"><Loader2 className="w-5 h-5 animate-spin" /> {tc('loading')}</div>
        ) : products.length === 0 ? (
          <div className="text-center py-8">
            <Package className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500">{t('products.noProducts')}</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-500 mb-3">{t('products.productCount', { count: products.length })}</p>
            <Table>
              <Thead>
                <tr><Th>{t('products.tableCode')}</Th><Th>{t('products.tableName')}</Th><Th>{t('products.tableType')}</Th><Th>{t('products.tableService')}</Th><Th>{t('products.tablePrices')}</Th><Th>{t('products.tableStatus')}</Th><Th>{t('products.tableActions')}</Th></tr>
              </Thead>
              <Tbody>
                {products.map((p) => (
                  <tr key={p.id}>
                    <Td className="font-mono text-sm">{p.code}</Td>
                    <Td className="font-semibold">{p.name}</Td>
                    <Td><Badge>{p.type}</Badge></Td>
                    <Td>{p.service?.name || <span className="text-gray-400">-</span>}</Td>
                    <Td>{p.prices?.length || 0}</Td>
                    <Td><Badge>{p.isActive ? tc('status.active') : tc('status.inactive')}</Badge></Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleToggleActive(p.id, p.isActive)}
                          className="text-gray-400 hover:text-blue-500"
                          title={p.isActive ? tc('deactivate') : tc('activate')}
                        >
                          {p.isActive ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                        <button onClick={() => handleDelete(p.id)} className="text-gray-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
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
        <ProductForm services={services} onSubmit={handleCreate} onCancel={() => setShowModal(false)} />
      </Modal>
    </div>
  )
}
