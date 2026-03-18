'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import { Tabs } from '@/components/ui/Tabs'
import { useAuth } from '@/contexts/AuthContext'
import { Receipt, Loader2, ExternalLink } from 'lucide-react'
import api from '@/lib/api'
import type { Order } from '@/lib/types'

const statusTabs = [
  { key: '', label: 'All' },
  { key: 'paid', label: 'Paid' },
  { key: 'created', label: 'Pending' },
  { key: 'failed', label: 'Failed' },
  { key: 'refunded', label: 'Refunded' },
]

export default function OrdersPage() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const [orders, setOrders] = useState<Order[]>([])
  const [statusFilter, setStatusFilter] = useState('')
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (authLoading) return
    if (!user) { router.push('/login'); return }

    async function load() {
      try {
        const params: Record<string, string> = {}
        if (statusFilter) params.status = statusFilter
        const res = await api.get('/v1/orders', { params })
        setOrders(res.data)
      } finally {
        setLoading(false)
      }
    }
    setLoading(true)
    load()
  }, [statusFilter, user, authLoading, router])

  if (authLoading || !user) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-violet-500" /></div>
  }

  const paidTotal = orders.filter((o) => o.status === 'paid').reduce((s, o) => s + Number(o.amount), 0)

  return (
    <div className="min-h-screen">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Order History</h1>
          {paidTotal > 0 && (
            <p className="text-sm text-gray-500">Total spent: <span className="font-semibold text-gray-900 dark:text-white">${paidTotal.toFixed(2)}</span></p>
          )}
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{orders.length} order{orders.length !== 1 ? 's' : ''}</p>

        <div className="mb-4">
          <Tabs tabs={statusTabs} activeTab={statusFilter} onChange={setStatusFilter} />
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-gray-500"><Loader2 className="w-5 h-5 animate-spin" /> Loading...</div>
        ) : orders.length === 0 ? (
          <Card>
            <div className="text-center py-8">
              <Receipt className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <p className="text-gray-500 dark:text-gray-400">{statusFilter ? `No ${statusFilter} orders` : 'No orders yet'}</p>
            </div>
          </Card>
        ) : (
          <Card>
            <Table>
              <Thead>
                <tr><Th>Date</Th><Th>Product</Th><Th>Amount</Th><Th>Mode</Th><Th>Status</Th></tr>
              </Thead>
              <Tbody>
                {orders.map((order) => (
                  <tr key={order.id} className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50" onClick={() => setSelectedOrder(order)}>
                    <Td>{new Date(order.createdAt).toLocaleDateString()}</Td>
                    <Td>{order.price?.product?.name || order.price?.code || '-'}</Td>
                    <Td className="font-semibold">{order.amount} {order.currency}</Td>
                    <Td><Badge variant={order.mode === 'SUBSCRIPTION' ? 'info' : 'default'}>{order.mode}</Badge></Td>
                    <Td><Badge>{order.status}</Badge></Td>
                  </tr>
                ))}
              </Tbody>
            </Table>
          </Card>
        )}

        {/* Order Detail Modal */}
        <Modal
          isOpen={!!selectedOrder}
          onClose={() => setSelectedOrder(null)}
          title="Order Details"
        >
          {selectedOrder && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-gray-900 dark:text-white">
                  {selectedOrder.price?.product?.name || 'Order'}
                </h4>
                <Badge>{selectedOrder.status}</Badge>
              </div>

              <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-4 space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Order ID</span>
                  <span className="font-mono text-xs">{selectedOrder.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Amount</span>
                  <span className="font-semibold">{selectedOrder.amount} {selectedOrder.currency}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Mode</span>
                  <span>{selectedOrder.mode}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Date</span>
                  <span>{new Date(selectedOrder.createdAt).toLocaleString()}</span>
                </div>
                {selectedOrder.price && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Price Code</span>
                      <span className="font-mono text-xs">{selectedOrder.price.code}</span>
                    </div>
                    {selectedOrder.price.interval && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Billing Interval</span>
                        <span>{selectedOrder.price.interval}</span>
                      </div>
                    )}
                  </>
                )}
                {selectedOrder.externalId && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">External ID</span>
                    <span className="font-mono text-xs">{selectedOrder.externalId}</span>
                  </div>
                )}
              </div>

              {/* Payment Intents */}
              {selectedOrder.paymentIntents && selectedOrder.paymentIntents.length > 0 && (
                <div>
                  <h5 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Payment Details</h5>
                  {selectedOrder.paymentIntents.map((pi) => (
                    <div key={pi.id} className="bg-gray-50 dark:bg-gray-900 rounded-xl p-3 text-sm space-y-2">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Payment Rail</span>
                        <span>{pi.rail}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Status</span>
                        <Badge>{pi.status}</Badge>
                      </div>
                      {pi.method && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">Method</span>
                          <span>{pi.method}</span>
                        </div>
                      )}
                      {pi.checkoutUrl && pi.status === 'created' && (
                        <a
                          href={pi.checkoutUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-violet-500 hover:text-violet-600 text-sm"
                        >
                          <ExternalLink className="w-3 h-3" /> Complete Payment
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Modal>
      </main>
    </div>
  )
}
