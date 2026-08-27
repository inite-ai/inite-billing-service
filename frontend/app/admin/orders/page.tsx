'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import { Pagination } from '@/components/ui/Pagination'
import { Tabs } from '@/components/ui/Tabs'
import { Search, Loader2, Receipt } from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import type { Order, PaginatedResponse } from '@/lib/types'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/ui/ErrorState'

export default function AdminOrdersPage() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')

  const statusTabs = [
    { key: '', label: t('orders.tabAll') },
    { key: 'paid', label: t('orders.tabPaid') },
    { key: 'created', label: t('orders.tabCreated') },
    { key: 'failed', label: t('orders.tabFailed') },
    { key: 'refunded', label: t('orders.tabRefunded') },
  ]

  const [data, setData] = useState<PaginatedResponse<Order> | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [userSearch, setUserSearch] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Order | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean
    title: string
    message: string
    onConfirm: () => Promise<void>
    variant?: 'danger' | 'default'
  } | null>(null)

  const load = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const params: Record<string, string | number> = { page, limit: 20 }
      if (statusFilter) params.status = statusFilter
      if (userSearch.trim()) params.userId = userSearch.trim()
      const res = await api.get('/v1/admin/orders', { params })
      setData(res.data)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      const message = err.response?.data?.message || 'Failed to load orders'
      setLoadError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [statusFilter, page])

  const handleSearch = () => { setPage(1); load() }

  const handleDetail = async (id: string) => {
    setDetailLoading(true)
    try {
      const res = await api.get(`/v1/admin/orders/${id}`)
      setSelected(res.data)
    } catch {
      toast.error(t('orders.detailLoadError'))
    } finally {
      setDetailLoading(false)
    }
  }

  const handleRefund = (id: string) => {
    setConfirmState({
      isOpen: true,
      title: t('orders.refundConfirm'),
      message: t('orders.refundConfirm'),
      variant: 'danger',
      onConfirm: async () => {
        try {
          await api.post(`/v1/admin/orders/${id}/refund`)
          toast.success(t('orders.refunded'))
          setSelected(null)
          load()
        } catch (e: unknown) {
          const err = e as { response?: { data?: { message?: string } } }
          toast.error(err.response?.data?.message || t('orders.refundError'))
          throw e
        }
      },
    })
  }

  return (
    <div>
      <PageHeader title={t('orders.title')} />

      <div className="flex flex-wrap items-center gap-4 mb-4">
        <Tabs tabs={statusTabs} activeTab={statusFilter} onChange={(v) => { setStatusFilter(v); setPage(1) }} />
        <div className="flex items-center gap-2 ml-auto">
          <div className="w-64">
            <Input
              placeholder={t('orders.searchPlaceholder')}
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <Button size="sm" variant="secondary" onClick={handleSearch} icon={<Search className="w-4 h-4" />}>{tc('search')}</Button>
        </div>
      </div>

      <Card>
        {loading ? (
          <TableSkeleton />
        ) : loadError ? (
          <ErrorState message={loadError} onRetry={load} />
        ) : !data || data.items.length === 0 ? (
          <div className="text-center py-8">
            <Receipt className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
            <p className="text-slate-500">{t('orders.noOrders')}</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-slate-500 mb-3">{t('orders.totalOrders', { count: data.total })}</p>
            <Table>
              <Thead>
                <tr><Th>{t('orders.tableDate')}</Th><Th>{t('orders.tableUser')}</Th><Th>{t('orders.tableProduct')}</Th><Th>{t('orders.tableAmount')}</Th><Th>{t('orders.tableMode')}</Th><Th>{t('orders.tableStatus')}</Th><Th>{t('orders.tableActions')}</Th></tr>
              </Thead>
              <Tbody>
                {data.items.map((order) => (
                  <tr key={order.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50" onClick={() => handleDetail(order.id)}>
                    <Td>{new Date(order.createdAt).toLocaleDateString()}</Td>
                    <Td className="font-mono text-xs">{order.userId.slice(0, 8)}...</Td>
                    <Td>{(order as any).price?.product?.name || '-'}</Td>
                    <Td className="font-semibold">{order.amount} {order.currency}</Td>
                    <Td><Badge variant={order.mode === 'SUBSCRIPTION' ? 'info' : 'default'}>{order.mode}</Badge></Td>
                    <Td><StatusBadge status={order.status} /></Td>
                    <Td>
                      <div onClick={(e) => e.stopPropagation()}>
                        {order.status === 'paid' && (
                          <Button size="sm" variant="danger" onClick={() => handleRefund(order.id)}>{tc('refund')}</Button>
                        )}
                      </div>
                    </Td>
                  </tr>
                ))}
              </Tbody>
            </Table>
            <Pagination page={data.page} pages={data.pages} onPageChange={setPage} />
          </>
        )}
      </Card>

      {/* Order Detail Modal */}
      <Modal isOpen={!!selected} onClose={() => setSelected(null)} title={t('orders.detailTitle')}>
        {detailLoading ? (
          <TableSkeleton />
        ) : selected && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <StatusBadge status={selected.status} />
              <span className="text-sm text-slate-500">{new Date(selected.createdAt).toLocaleString()}</span>
            </div>

            <div className="bg-slate-50 dark:bg-slate-900 rounded-xl p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">{t('orders.detailOrderId')}</span><span className="font-mono text-xs">{selected.id}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">{t('orders.detailUserId')}</span><span className="font-mono text-xs">{selected.userId}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">{t('orders.detailAmount')}</span><span className="font-semibold">{selected.amount} {selected.currency}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">{t('orders.detailMode')}</span><span>{selected.mode}</span></div>
              {selected.externalId && <div className="flex justify-between"><span className="text-slate-500">{t('orders.detailExternalId')}</span><span className="font-mono text-xs">{selected.externalId}</span></div>}
              {(selected as any).price?.product?.name && <div className="flex justify-between"><span className="text-slate-500">{t('orders.detailProduct')}</span><span>{(selected as any).price.product.name}</span></div>}
            </div>

            {/* Payment Intents */}
            {selected.paymentIntents && selected.paymentIntents.length > 0 && (
              <div>
                <h5 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">{t('orders.paymentIntents')}</h5>
                {selected.paymentIntents.map((pi) => (
                  <div key={pi.id} className="bg-slate-50 dark:bg-slate-900 rounded-xl p-3 text-sm space-y-1 mb-2">
                    <div className="flex justify-between"><span className="text-slate-500">{t('orders.paymentRail')}</span><span>{pi.rail}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">{t('orders.paymentStatus')}</span><StatusBadge status={pi.status} /></div>
                    {pi.method && <div className="flex justify-between"><span className="text-slate-500">{t('orders.paymentMethod')}</span><span>{pi.method}</span></div>}
                  </div>
                ))}
              </div>
            )}

            {/* Commissions */}
            {(selected as any).affiliateCommissions?.length > 0 && (
              <div>
                <h5 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">{t('orders.affiliateCommissions')}</h5>
                {(selected as any).affiliateCommissions.map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between text-sm py-1">
                    <span>L{c.level} - {(Number(c.commissionRate) * 100).toFixed(1)}%</span>
                    <span className="font-semibold text-green-600">${Number(c.amount).toFixed(2)} {c.currency}</span>
                  </div>
                ))}
              </div>
            )}

            {selected.status === 'paid' && (
              <Button variant="danger" onClick={() => handleRefund(selected.id)} className="w-full">{t('orders.refundOrder')}</Button>
            )}
          </div>
        )}
      </Modal>

      {confirmState && (
        <ConfirmDialog
          isOpen={confirmState.isOpen}
          onClose={() => setConfirmState(null)}
          onConfirm={confirmState.onConfirm}
          title={confirmState.title}
          message={confirmState.message}
          variant={confirmState.variant}
        />
      )}
    </div>
  )
}
