'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { motion } from 'framer-motion'
import { ClientLayout } from '@/components/layout/ClientLayout'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { StatsCards } from '@/components/dashboard/StatsCards'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import { useAuth } from '@/contexts/AuthContext'
import { CreditCard, ArrowRight, Calendar, Loader2, Sparkles } from 'lucide-react'
import api from '@/lib/api'
import type { Order, Subscription, AffiliateStats, Entitlement } from '@/lib/types'
import Link from 'next/link'

export default function DashboardPage() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const t = useTranslations('dashboard')
  const tc = useTranslations('common')
  const [orders, setOrders] = useState<Order[]>([])
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [entitlements, setEntitlements] = useState<Entitlement[]>([])
  const [affiliateStats, setAffiliateStats] = useState<AffiliateStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (authLoading) return
    if (!user) { router.push('/login'); return }

    async function load() {
      try {
        const [ordersRes, subsRes, entRes] = await Promise.all([
          api.get('/v1/orders/me').catch(() => ({ data: [] })),
          api.get('/v1/subscriptions/me').catch(() => ({ data: [] })),
          api.get('/v1/entitlements/me').catch(() => ({ data: [] })),
        ])
        setOrders(ordersRes.data)
        setSubscriptions(subsRes.data)
        setEntitlements(entRes.data)

        try {
          const statsRes = await api.get('/v1/affiliates/me/stats')
          setAffiliateStats(statsRes.data)
        } catch {}
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [user, authLoading, router])

  if (authLoading || !user) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-violet-500" /></div>
  }

  const activeSubs = subscriptions.filter((s) => s.status === 'active' || s.status === 'trialing')
  const activeEntitlements = entitlements.filter((e) => e.status === 'active')

  return (
    <ClientLayout>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
          {t('welcome', { name: user.name || user.email })}
        </h1>
        <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500"><Loader2 className="w-5 h-5 animate-spin" /> {tc('loading')}</div>
      ) : (
        <div className="space-y-6">
          <StatsCards
            activeSubscriptions={activeSubs.length}
            totalOrders={orders.length}
            totalReferrals={affiliateStats?.totalReferrals || 0}
            pendingCommissions={affiliateStats?.pendingCommissions || '0'}
          />

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Active Subscriptions */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
              <Card className="h-full">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-slate-900 dark:text-white">{t('activeSubscriptionsTitle')}</h3>
                  <Link href="/subscriptions">
                    <Button size="sm" variant="ghost" icon={<ArrowRight className="w-3.5 h-3.5" />}>{tc('viewAll')}</Button>
                  </Link>
                </div>
                {activeSubs.length === 0 ? (
                  <div className="text-center py-8">
                    <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-3">
                      <CreditCard className="w-6 h-6 text-slate-400" />
                    </div>
                    <p className="text-sm text-slate-500 mb-3">{t('noActiveSubscriptions')}</p>
                    <Link href="/catalog"><Button size="sm" variant="outline">{t('browseCatalog')}</Button></Link>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {activeSubs.map((sub) => (
                      <div key={sub.id} className="border border-slate-100 dark:border-slate-800 rounded-xl p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-medium text-slate-900 dark:text-white text-sm">
                            {sub.price?.product?.name || 'Subscription'}
                          </h4>
                          <Badge>{sub.status}</Badge>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1.5 text-slate-500">
                            <Calendar className="w-3.5 h-3.5" />
                            <span>{t('renews', { date: new Date(sub.currentPeriodEnd).toLocaleDateString() })}</span>
                          </div>
                          {sub.price && (
                            <span className="font-semibold text-slate-700 dark:text-slate-200">
                              {sub.price.amount} {sub.price.currency}/{sub.price.interval || 'month'}
                            </span>
                          )}
                        </div>
                        {sub.cancelAtPeriodEnd && (
                          <p className="text-xs text-orange-500 mt-2">{t('cancelsAtPeriodEnd')}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </motion.div>

            {/* Active Entitlements */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
              <Card className="h-full">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-slate-900 dark:text-white">{t('yourEntitlements')}</h3>
                </div>
                {activeEntitlements.length === 0 ? (
                  <div className="text-center py-8">
                    <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-3">
                      <Sparkles className="w-6 h-6 text-slate-400" />
                    </div>
                    <p className="text-sm text-slate-500">{t('noActiveSubscriptions')}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {activeEntitlements.map((e) => (
                      <div key={e.id} className="flex items-center justify-between bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800/50 rounded-xl px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-emerald-500" />
                          <span className="text-sm font-medium text-emerald-800 dark:text-emerald-300">{e.key}</span>
                        </div>
                        {e.expiresAt && (
                          <span className="text-xs text-emerald-600 dark:text-emerald-400">
                            {t('expires', { date: new Date(e.expiresAt).toLocaleDateString() })}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </motion.div>
          </div>

          {/* Recent Orders */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
            <Card>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-slate-900 dark:text-white">{t('recentOrders')}</h3>
                <Link href="/orders">
                  <Button size="sm" variant="ghost" icon={<ArrowRight className="w-3.5 h-3.5" />}>{tc('viewAll')}</Button>
                </Link>
              </div>
              {orders.length === 0 ? (
                <p className="text-slate-500 text-sm py-6 text-center">{t('noOrdersYet')}</p>
              ) : (
                <Table>
                  <Thead>
                    <tr><Th>{t('tableDate')}</Th><Th>{t('tableAmount')}</Th><Th>{t('tableMode')}</Th><Th>{t('tableStatus')}</Th></tr>
                  </Thead>
                  <Tbody>
                    {orders.slice(0, 5).map((order) => (
                      <tr key={order.id} className="table-row-hover">
                        <Td>{new Date(order.createdAt).toLocaleDateString()}</Td>
                        <Td className="font-semibold">{order.amount} {order.currency}</Td>
                        <Td>{order.mode}</Td>
                        <Td><Badge>{order.status}</Badge></Td>
                      </tr>
                    ))}
                  </Tbody>
                </Table>
              )}
            </Card>
          </motion.div>
        </div>
      )}
    </ClientLayout>
  )
}
