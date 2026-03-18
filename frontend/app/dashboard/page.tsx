'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { StatsCards } from '@/components/dashboard/StatsCards'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import { useAuth } from '@/contexts/AuthContext'
import { CreditCard, ArrowRight, Calendar, Loader2 } from 'lucide-react'
import api from '@/lib/api'
import type { Order, Subscription, AffiliateStats, Entitlement } from '@/lib/types'
import Link from 'next/link'

export default function DashboardPage() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
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
          api.get('/v1/orders').catch(() => ({ data: [] })),
          api.get('/v1/subscriptions').catch(() => ({ data: [] })),
          api.get('/v1/entitlements').catch(() => ({ data: [] })),
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
    <div className="min-h-screen">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Welcome, {user.name || user.email}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Manage your subscriptions, orders, and referral program</p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-gray-500"><Loader2 className="w-5 h-5 animate-spin" /> Loading...</div>
        ) : (
          <div className="space-y-6">
            <StatsCards
              activeSubscriptions={activeSubs.length}
              totalOrders={orders.length}
              totalReferrals={affiliateStats?.totalReferrals || 0}
              pendingCommissions={affiliateStats?.pendingCommissions || '0'}
            />

            {/* Active Subscriptions */}
            <Card>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Active Subscriptions</h3>
                <Link href="/subscriptions">
                  <Button size="sm" variant="ghost" icon={<ArrowRight className="w-4 h-4" />}>View All</Button>
                </Link>
              </div>
              {activeSubs.length === 0 ? (
                <div className="text-center py-6">
                  <CreditCard className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                  <p className="text-gray-500 dark:text-gray-400 mb-3">No active subscriptions</p>
                  <Link href="/catalog"><Button size="sm">Browse Catalog</Button></Link>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {activeSubs.map((sub) => (
                    <div key={sub.id} className="border border-gray-200 dark:border-gray-700 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-semibold text-gray-900 dark:text-white">
                          {sub.price?.product?.name || 'Subscription'}
                        </h4>
                        <Badge>{sub.status}</Badge>
                      </div>
                      <div className="text-sm text-gray-500 dark:text-gray-400 space-y-1">
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4" />
                          <span>Renews {new Date(sub.currentPeriodEnd).toLocaleDateString()}</span>
                        </div>
                        {sub.price && (
                          <p className="font-medium text-gray-900 dark:text-white">
                            {sub.price.amount} {sub.price.currency}/{sub.price.interval || 'month'}
                          </p>
                        )}
                      </div>
                      {sub.cancelAtPeriodEnd && (
                        <p className="text-xs text-orange-500 mt-2">Cancels at period end</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Active Entitlements */}
            {activeEntitlements.length > 0 && (
              <Card>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Your Entitlements</h3>
                <div className="flex flex-wrap gap-2">
                  {activeEntitlements.map((e) => (
                    <div key={e.id} className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">
                      <p className="text-sm font-medium text-green-800 dark:text-green-300">{e.key}</p>
                      {e.expiresAt && (
                        <p className="text-xs text-green-600 dark:text-green-400">
                          Expires: {new Date(e.expiresAt).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Recent Orders */}
            <Card>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Recent Orders</h3>
                <Link href="/orders">
                  <Button size="sm" variant="ghost" icon={<ArrowRight className="w-4 h-4" />}>View All</Button>
                </Link>
              </div>
              {orders.length === 0 ? (
                <p className="text-gray-500 dark:text-gray-400 text-sm py-4">No orders yet</p>
              ) : (
                <Table>
                  <Thead>
                    <tr><Th>Date</Th><Th>Amount</Th><Th>Mode</Th><Th>Status</Th></tr>
                  </Thead>
                  <Tbody>
                    {orders.slice(0, 5).map((order) => (
                      <tr key={order.id}>
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
          </div>
        )}
      </main>
    </div>
  )
}
