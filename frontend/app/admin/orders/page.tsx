'use client'

import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import { Pagination } from '@/components/ui/Pagination'
import { Tabs } from '@/components/ui/Tabs'
import { Search, Loader2, Receipt } from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import type { Order, PaginatedResponse } from '@/lib/types'

const statusTabs = [
  { key: '', label: 'All' },
  { key: 'paid', label: 'Paid' },
  { key: 'created', label: 'Created' },
  { key: 'failed', label: 'Failed' },
  { key: 'refunded', label: 'Refunded' },
]

export default function AdminOrdersPage() {
  const [data, setData] = useState<PaginatedResponse<Order> | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [userSearch, setUserSearch] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Order | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    const params: Record<string, string | number> = { page, limit: 20 }
    if (statusFilter) params.status = statusFilter
    if (userSearch.trim()) params.userId = userSearch.trim()
    const res = await api.get('/v1/admin/orders', { params })
    setData(res.data)
    setLoading(false)
  }

  useEffect(() => { load() }, [statusFilter, page])

  const handleSearch = () => { setPage(1); load() }

  const handleDetail = async (id: string) => {
    setDetailLoading(true)
    try {
      const res = await api.get(`/v1/admin/orders/${id}`)
      setSelected(res.data)
    } catch {
      toast.error('Failed to load order details')
    } finally {
      setDetailLoading(false)
    }
  }

  const handleRefund = async (id: string) => {
    if (!confirm('Refund this order? This action cannot be undone.')) return
    try {
      await api.post(`/v1/admin/orders/${id}/refund`)
      toast.success('Order refunded')
      setSelected(null)
      load()
    } catch {
      toast.error('Failed to refund order')
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Orders</h1>

      <div className="flex flex-wrap items-center gap-4 mb-4">
        <Tabs tabs={statusTabs} activeTab={statusFilter} onChange={(v) => { setStatusFilter(v); setPage(1) }} />
        <div className="flex items-center gap-2 ml-auto">
          <div className="w-64">
            <Input
              placeholder="Search by User ID..."
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <Button size="sm" variant="secondary" onClick={handleSearch} icon={<Search className="w-4 h-4" />}>Search</Button>
        </div>
      </div>

      <Card>
        {loading ? (
          <div className="flex items-center gap-2 text-gray-500 py-4"><Loader2 className="w-5 h-5 animate-spin" /> Loading...</div>
        ) : !data || data.items.length === 0 ? (
          <div className="text-center py-8">
            <Receipt className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500">No orders found</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-500 mb-3">{data.total} total orders</p>
            <Table>
              <Thead>
                <tr><Th>Date</Th><Th>User</Th><Th>Product</Th><Th>Amount</Th><Th>Mode</Th><Th>Status</Th><Th>Actions</Th></tr>
              </Thead>
              <Tbody>
                {data.items.map((order) => (
                  <tr key={order.id} className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50" onClick={() => handleDetail(order.id)}>
                    <Td>{new Date(order.createdAt).toLocaleDateString()}</Td>
                    <Td className="font-mono text-xs">{order.userId.slice(0, 8)}...</Td>
                    <Td>{(order as any).price?.product?.name || '-'}</Td>
                    <Td className="font-semibold">{order.amount} {order.currency}</Td>
                    <Td><Badge variant={order.mode === 'SUBSCRIPTION' ? 'info' : 'default'}>{order.mode}</Badge></Td>
                    <Td><Badge>{order.status}</Badge></Td>
                    <Td>
                      <div onClick={(e) => e.stopPropagation()}>
                        {order.status === 'paid' && (
                          <Button size="sm" variant="danger" onClick={() => handleRefund(order.id)}>Refund</Button>
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
      <Modal isOpen={!!selected} onClose={() => setSelected(null)} title="Order Details">
        {detailLoading ? (
          <div className="flex items-center gap-2 text-gray-500 py-4"><Loader2 className="w-5 h-5 animate-spin" /> Loading...</div>
        ) : selected && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Badge>{selected.status}</Badge>
              <span className="text-sm text-gray-500">{new Date(selected.createdAt).toLocaleString()}</span>
            </div>

            <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Order ID</span><span className="font-mono text-xs">{selected.id}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">User ID</span><span className="font-mono text-xs">{selected.userId}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Amount</span><span className="font-semibold">{selected.amount} {selected.currency}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Mode</span><span>{selected.mode}</span></div>
              {selected.externalId && <div className="flex justify-between"><span className="text-gray-500">External ID</span><span className="font-mono text-xs">{selected.externalId}</span></div>}
              {(selected as any).price?.product?.name && <div className="flex justify-between"><span className="text-gray-500">Product</span><span>{(selected as any).price.product.name}</span></div>}
            </div>

            {/* Payment Intents */}
            {selected.paymentIntents && selected.paymentIntents.length > 0 && (
              <div>
                <h5 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Payment Intents</h5>
                {selected.paymentIntents.map((pi) => (
                  <div key={pi.id} className="bg-gray-50 dark:bg-gray-900 rounded-xl p-3 text-sm space-y-1 mb-2">
                    <div className="flex justify-between"><span className="text-gray-500">Rail</span><span>{pi.rail}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Status</span><Badge>{pi.status}</Badge></div>
                    {pi.method && <div className="flex justify-between"><span className="text-gray-500">Method</span><span>{pi.method}</span></div>}
                  </div>
                ))}
              </div>
            )}

            {/* Commissions */}
            {(selected as any).affiliateCommissions?.length > 0 && (
              <div>
                <h5 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Affiliate Commissions</h5>
                {(selected as any).affiliateCommissions.map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between text-sm py-1">
                    <span>L{c.level} - {(Number(c.commissionRate) * 100).toFixed(1)}%</span>
                    <span className="font-semibold text-green-600">${Number(c.amount).toFixed(2)} {c.currency}</span>
                  </div>
                ))}
              </div>
            )}

            {selected.status === 'paid' && (
              <Button variant="danger" onClick={() => handleRefund(selected.id)} className="w-full">Refund Order</Button>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
