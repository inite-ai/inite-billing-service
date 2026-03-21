'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import {
  DollarSign, Receipt, CreditCard, Users, TrendingUp, Package,
  ArrowRight, Loader2, Activity,
} from 'lucide-react'
import Link from 'next/link'
import api from '@/lib/api'
import type { AdminStats, Order, PaginatedResponse } from '@/lib/types'

export default function AdminDashboardPage() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')

  const [stats, setStats] = useState<AdminStats | null>(null)
  const [recentOrders, setRecentOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const [statsRes, ordersRes] = await Promise.all([
          api.get('/v1/admin/stats'),
          api.get('/v1/admin/orders', { params: { limit: 5 } }),
        ])
        setStats(statsRes.data)
        setRecentOrders(ordersRes.data.items || [])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) return <div className="flex items-center gap-2 text-gray-500"><Loader2 className="w-5 h-5 animate-spin" /> {tc('loadingDashboard')}</div>
  if (!stats) return <div className="text-gray-500">{t('dashboard.failedToLoadStats')}</div>

  const statItems = [
    { label: t('dashboard.totalRevenue'), value: `$${stats.totalRevenue}`, icon: DollarSign, color: 'text-green-500', bg: 'bg-green-50 dark:bg-green-900/20' },
    { label: t('dashboard.totalOrders'), value: stats.totalOrders, icon: Receipt, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-900/20' },
    { label: t('dashboard.paidOrders'), value: stats.paidOrders, icon: TrendingUp, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
    { label: t('dashboard.activeSubscriptions'), value: stats.activeSubscriptions, icon: CreditCard, color: 'text-violet-500', bg: 'bg-violet-50 dark:bg-violet-900/20' },
    { label: t('dashboard.activeAffiliates'), value: stats.totalAffiliates, icon: Users, color: 'text-orange-500', bg: 'bg-orange-50 dark:bg-orange-900/20' },
    { label: t('dashboard.totalCommissions'), value: `$${stats.totalCommissions}`, icon: Package, color: 'text-pink-500', bg: 'bg-pink-50 dark:bg-pink-900/20' },
  ]

  const quickActions = [
    { label: t('dashboard.manageServices'), href: '/admin/services', icon: Activity },
    { label: t('dashboard.manageProducts'), href: '/admin/products', icon: Package },
    { label: t('dashboard.viewOrders'), href: '/admin/orders', icon: Receipt },
    { label: t('dashboard.referralConfig'), href: '/admin/referral-config', icon: Users },
  ]

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">{t('dashboard.title')}</h1>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {statItems.map((item) => {
          const Icon = item.icon
          return (
            <Card key={item.label}>
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl ${item.bg} flex items-center justify-center`}>
                  <Icon className={`w-6 h-6 ${item.color}`} />
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">{item.value}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{item.label}</p>
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Orders */}
        <div className="lg:col-span-2">
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{t('dashboard.recentOrders')}</h3>
              <Link href="/admin/orders">
                <Button size="sm" variant="ghost" icon={<ArrowRight className="w-4 h-4" />}>{tc('viewAll')}</Button>
              </Link>
            </div>
            {recentOrders.length === 0 ? (
              <p className="text-gray-500 text-sm py-4">{t('dashboard.noOrdersYet')}</p>
            ) : (
              <Table>
                <Thead>
                  <tr><Th>{t('dashboard.tableDate')}</Th><Th>{t('dashboard.tableUser')}</Th><Th>{t('dashboard.tableAmount')}</Th><Th>{t('dashboard.tableStatus')}</Th></tr>
                </Thead>
                <Tbody>
                  {recentOrders.map((o) => (
                    <tr key={o.id}>
                      <Td>{new Date(o.createdAt).toLocaleDateString()}</Td>
                      <Td className="font-mono text-xs">{o.userId.slice(0, 8)}...</Td>
                      <Td className="font-semibold">{o.amount} {o.currency}</Td>
                      <Td><Badge>{o.status}</Badge></Td>
                    </tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </Card>
        </div>

        {/* Quick Actions */}
        <Card>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">{t('dashboard.quickActions')}</h3>
          <div className="space-y-2">
            {quickActions.map((action) => {
              const Icon = action.icon
              return (
                <Link key={action.href} href={action.href}>
                  <div className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer">
                    <Icon className="w-5 h-5 text-violet-500" />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{action.label}</span>
                    <ArrowRight className="w-4 h-4 text-gray-400 ml-auto" />
                  </div>
                </Link>
              )
            })}
          </div>
        </Card>
      </div>
    </div>
  )
}
