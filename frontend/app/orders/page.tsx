'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { motion } from 'framer-motion'
import { ClientLayout } from '@/components/layout/ClientLayout'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import { Tabs } from '@/components/ui/Tabs'
import { useAuth } from '@/contexts/AuthContext'
import { Receipt, Loader2, ExternalLink } from 'lucide-react'
import api from '@/lib/api'
import type { Order } from '@/lib/types'

export default function OrdersPage() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const t = useTranslations('orders')
  const tc = useTranslations('common')

  const statusTabs = [
    { key: '', label: t('tabAll') },
    { key: 'paid', label: t('tabPaid') },
    { key: 'created', label: t('tabPending') },
    { key: 'failed', label: t('tabFailed') },
    { key: 'refunded', label: t('tabRefunded') },
  ]
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
        const res = await api.get('/v1/orders/me', { params })
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
    <ClientLayout>
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">{t('title')}</h1>
        {paidTotal > 0 && (
          <div className="text-right">
            <p className="text-xs text-slate-400 uppercase tracking-wide">{t('totalSpent', { amount: '' }).replace('$', '').trim()}</p>
            <p className="text-lg font-bold text-slate-900 dark:text-white">${paidTotal.toFixed(2)}</p>
          </div>
        )}
      </div>
      <p className="text-sm text-slate-500 mb-6">{t('orderCount', { count: orders.length })}</p>

      <div className="mb-5">
        <Tabs tabs={statusTabs} activeTab={statusFilter} onChange={setStatusFilter} />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500"><Loader2 className="w-5 h-5 animate-spin" /> {tc('loading')}</div>
      ) : orders.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-4">
              <Receipt className="w-7 h-7 text-slate-400" />
            </div>
            <p className="text-slate-500 font-medium">{statusFilter ? t('noFilteredOrders', { status: statusFilter }) : t('noOrders')}</p>
          </div>
        </Card>
      ) : (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <Card>
            <Table>
              <Thead>
                <tr><Th>{t('tableDate')}</Th><Th>{t('tableProduct')}</Th><Th>{t('tableAmount')}</Th><Th>{t('tableMode')}</Th><Th>{t('tableStatus')}</Th></tr>
              </Thead>
              <Tbody>
                {orders.map((order) => (
                  <tr key={order.id} className="table-row-hover cursor-pointer" onClick={() => setSelectedOrder(order)}>
                    <Td>{new Date(order.createdAt).toLocaleDateString()}</Td>
                    <Td className="font-medium">{order.price?.product?.name || order.price?.code || '-'}</Td>
                    <Td className="font-semibold">{order.amount} {order.currency}</Td>
                    <Td><Badge variant={order.mode === 'SUBSCRIPTION' ? 'info' : 'default'}>{order.mode}</Badge></Td>
                    <Td><Badge>{order.status}</Badge></Td>
                  </tr>
                ))}
              </Tbody>
            </Table>
          </Card>
        </motion.div>
      )}

      {/* Order Detail Modal */}
      <Modal
        isOpen={!!selectedOrder}
        onClose={() => setSelectedOrder(null)}
        title={t('detailTitle')}
      >
        {selectedOrder && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-slate-900 dark:text-white">
                {selectedOrder.price?.product?.name || 'Order'}
              </h4>
              <Badge>{selectedOrder.status}</Badge>
            </div>

            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">{t('detailOrderId')}</span>
                <span className="font-mono text-xs text-slate-600 dark:text-slate-300">{selectedOrder.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{t('detailAmount')}</span>
                <span className="font-semibold text-slate-900 dark:text-white">{selectedOrder.amount} {selectedOrder.currency}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{t('detailMode')}</span>
                <span className="text-slate-700 dark:text-slate-300">{selectedOrder.mode}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{t('detailDate')}</span>
                <span className="text-slate-700 dark:text-slate-300">{new Date(selectedOrder.createdAt).toLocaleString()}</span>
              </div>
              {selectedOrder.price && (
                <>
                  <div className="flex justify-between">
                    <span className="text-slate-500">{t('detailPriceCode')}</span>
                    <span className="font-mono text-xs text-slate-600 dark:text-slate-300">{selectedOrder.price.code}</span>
                  </div>
                  {selectedOrder.price.interval && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">{t('detailBillingInterval')}</span>
                      <span className="text-slate-700 dark:text-slate-300">{selectedOrder.price.interval}</span>
                    </div>
                  )}
                </>
              )}
              {selectedOrder.externalId && (
                <div className="flex justify-between">
                  <span className="text-slate-500">{t('detailExternalId')}</span>
                  <span className="font-mono text-xs text-slate-600 dark:text-slate-300">{selectedOrder.externalId}</span>
                </div>
              )}
            </div>

            {/* Payment Intents */}
            {selectedOrder.paymentIntents && selectedOrder.paymentIntents.length > 0 && (
              <div>
                <h5 className="text-sm font-semibold text-slate-600 dark:text-slate-300 mb-2">{t('paymentDetails')}</h5>
                {selectedOrder.paymentIntents.map((pi) => (
                  <div key={pi.id} className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3 text-sm space-y-2">
                    <div className="flex justify-between">
                      <span className="text-slate-500">{t('paymentRail')}</span>
                      <span className="text-slate-700 dark:text-slate-300">{pi.rail}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">{t('paymentStatus')}</span>
                      <Badge>{pi.status}</Badge>
                    </div>
                    {pi.method && (
                      <div className="flex justify-between">
                        <span className="text-slate-500">{t('paymentMethod')}</span>
                        <span className="text-slate-700 dark:text-slate-300">{pi.method}</span>
                      </div>
                    )}
                    {pi.checkoutUrl && pi.status === 'created' && (
                      <a
                        href={pi.checkoutUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-violet-600 hover:text-violet-700 dark:text-violet-400 text-sm font-medium"
                      >
                        <ExternalLink className="w-3.5 h-3.5" /> {t('completePayment')}
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>
    </ClientLayout>
  )
}
