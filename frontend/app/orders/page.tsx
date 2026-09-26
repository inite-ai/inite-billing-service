'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { motion } from 'framer-motion'
import { ClientLayout } from '@/components/layout/ClientLayout'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useFormat } from '@/lib/useFormat'
import Link from 'next/link'
import { Modal } from '@/components/ui/Modal'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import { Tabs } from '@/components/ui/Tabs'
import { useAuth } from '@/contexts/AuthContext'
import { Receipt, Loader2, ArrowRight } from 'lucide-react'
import api from '@/lib/api'
import type { Order } from '@/lib/types'

export default function OrdersPage() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const t = useTranslations('orders')
  const tc = useTranslations('common')
  const ts = useTranslations('common.status')
  const f = useFormat()

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

  // Spent per currency — adding dollars to roubles gives a number that means nothing.
  const paidTotals = f.totals(orders.filter((o) => o.status === 'paid'))
  const awaitingPayment = (o: Order) => o.status === 'created' || o.status === 'open'

  return (
    <ClientLayout>
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">{t('title')}</h1>
        {paidTotals && (
          <div className="text-right">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-slate-500">{t('spent')}</p>
            <p className="font-mono text-lg font-semibold text-slate-900 dark:text-white">{paidTotals}</p>
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
            <p className="text-slate-500 font-medium">{statusFilter ? t('noFilteredOrders', { status: ts.has(statusFilter as never) ? ts(statusFilter as never) : statusFilter }) : t('noOrders')}</p>
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
                    <Td>{f.date(order.createdAt)}</Td>
                    <Td className="font-medium">{order.price?.product?.name || order.price?.code || '—'}</Td>
                    <Td className="font-mono font-semibold">{f.money(order.amount, order.currency)}</Td>
                    <Td><Badge variant={order.mode === 'SUBSCRIPTION' ? 'info' : 'default'}>{f.mode(order.mode)}</Badge></Td>
                    <Td>
                      <div className="flex items-center gap-3">
                        <StatusBadge status={order.status} />
                        {awaitingPayment(order) && (
                          <Link
                            href={`/checkout/${order.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs font-semibold text-[#ccff00] hover:underline"
                          >
                            {t('payNow')}
                          </Link>
                        )}
                      </div>
                    </Td>
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
                {selectedOrder.price?.product?.name || t('untitledOrder')}
              </h4>
              <StatusBadge status={selectedOrder.status} />
            </div>

            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">{t('detailOrderId')}</span>
                <span className="font-mono text-xs text-slate-600 dark:text-slate-300">{selectedOrder.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{t('detailAmount')}</span>
                <span className="font-mono font-semibold text-slate-900 dark:text-white">{f.money(selectedOrder.amount, selectedOrder.currency)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{t('detailMode')}</span>
                <span className="text-slate-700 dark:text-slate-300">{f.mode(selectedOrder.mode)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{t('detailDate')}</span>
                <span className="text-slate-700 dark:text-slate-300">{f.dateTime(selectedOrder.createdAt)}</span>
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
                      <span className="text-slate-700 dark:text-slate-300">{f.interval(selectedOrder.price.interval)}</span>
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

            {awaitingPayment(selectedOrder) && (
              <Link href={`/checkout/${selectedOrder.id}`} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#ccff00] px-4 py-2.5 text-sm font-semibold text-[#0a0a0b] hover:brightness-110">
                {t('completePayment')}
                <ArrowRight className="h-4 w-4" />
              </Link>
            )}

            {/* Payment Intents */}
            {selectedOrder.paymentIntents && selectedOrder.paymentIntents.length > 0 && (
              <div>
                <h5 className="text-sm font-semibold text-slate-600 dark:text-slate-300 mb-2">{t('paymentDetails')}</h5>
                {selectedOrder.paymentIntents.map((pi) => (
                  <div key={pi.id} className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3 text-sm space-y-2">
                    <div className="flex justify-between">
                      <span className="text-slate-500">{t('paymentRail')}</span>
                      <span className="text-slate-700 dark:text-slate-300">{f.rail(pi.rail)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">{t('paymentStatus')}</span>
                      <StatusBadge status={pi.status} />
                    </div>
                    {pi.method && (
                      <div className="flex justify-between">
                        <span className="text-slate-500">{t('paymentMethod')}</span>
                        <span className="text-slate-700 dark:text-slate-300">{f.method(pi.method)}</span>
                      </div>
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
