'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import {
  Activity, AlertTriangle, ArrowRight, CheckCircle2, Clock, CreditCard,
  DollarSign, Package, Receipt, ShieldAlert, Users, Wallet, Webhook,
} from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { CopyableId } from '@/components/ui/CopyableId'
import { CardSkeleton, TableSkeleton } from '@/components/ui/Skeleton'
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table'
import api from '@/lib/api'
import type { AdminStats, Order } from '@/lib/types'

interface Triage {
  pendingPayouts: number
  pendingPayoutAmount: string
  flaggedRisk: number
  failedWebhooks: number
  pastDueSubscriptions: number
  staleOpenOrders: number
  staleOpenOrdersOlderThanHours: number
  failedOutbox: number
}

export default function AdminDashboardPage() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')

  const [stats, setStats] = useState<AdminStats | null>(null)
  const [triage, setTriage] = useState<Triage | null>(null)
  const [recentOrders, setRecentOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [statsRes, triageRes, ordersRes] = await Promise.all([
        api.get('/v1/admin/stats'),
        api.get('/v1/admin/stats/triage'),
        api.get('/v1/admin/orders', { params: { limit: 5 } }),
      ])
      setStats(statsRes.data)
      setTriage(triageRes.data)
      setRecentOrders(ordersRes.data.items || [])
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      setLoadError(err.response?.data?.message || t('dashboard.failedToLoadStats'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div>
        <PageHeader title={t('dashboard.title')} />
        <CardSkeleton />
        <div className="mt-6"><TableSkeleton /></div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div>
        <PageHeader title={t('dashboard.title')} />
        <ErrorState message={loadError} onRetry={load} />
      </div>
    )
  }

  /**
   * Everything here is a queue somebody has to empty, and every count links to
   * that queue already filtered. The dashboard used to open on six all-time
   * counters — revenue since launch, orders ever placed — which answer how the
   * business is doing and never answer what to do next.
   */
  const queues = triage
    ? [
        {
          key: 'payouts',
          count: triage.pendingPayouts,
          label: t('dashboard.triage.payouts'),
          detail: triage.pendingPayouts > 0 ? `${triage.pendingPayoutAmount}` : undefined,
          href: '/admin/payouts?status=pending',
          icon: Wallet,
        },
        {
          key: 'risk',
          count: triage.flaggedRisk,
          label: t('dashboard.triage.risk'),
          href: '/admin/risk',
          icon: ShieldAlert,
        },
        {
          key: 'webhooks',
          count: triage.failedWebhooks,
          label: t('dashboard.triage.webhooks'),
          href: '/admin/webhooks?status=failed',
          icon: Webhook,
        },
        {
          key: 'pastDue',
          count: triage.pastDueSubscriptions,
          label: t('dashboard.triage.pastDue'),
          href: '/admin/subscriptions?status=past_due',
          icon: CreditCard,
        },
        {
          key: 'staleOrders',
          count: triage.staleOpenOrders,
          label: t('dashboard.triage.staleOrders', {
            hours: triage.staleOpenOrdersOlderThanHours,
          }),
          href: '/admin/orders?status=created',
          icon: Clock,
        },
        {
          key: 'outbox',
          count: triage.failedOutbox,
          label: t('dashboard.triage.outbox'),
          // No screen owns the outbox — saying so beats a link to nowhere.
          hint: t('dashboard.triage.outboxHint'),
          icon: AlertTriangle,
        },
      ]
    : []

  const waiting = queues.reduce((sum, q) => sum + q.count, 0)

  const statItems = [
    { label: t('dashboard.totalRevenue'), value: `$${stats?.totalRevenue ?? '0'}`, icon: DollarSign },
    { label: t('dashboard.totalOrders'), value: stats?.totalOrders ?? 0, icon: Receipt },
    { label: t('dashboard.activeSubscriptions'), value: stats?.activeSubscriptions ?? 0, icon: CreditCard },
    { label: t('dashboard.activeAffiliates'), value: stats?.totalAffiliates ?? 0, icon: Users },
    { label: t('dashboard.totalCommissions'), value: `$${stats?.totalCommissions ?? '0'}`, icon: Package },
    { label: t('dashboard.paidOrders'), value: stats?.paidOrders ?? 0, icon: Activity },
  ]

  return (
    <div>
      <PageHeader title={t('dashboard.title')} subtitle={t('dashboard.subtitle')} />

      <section aria-labelledby="triage-heading" className="mb-8">
        <div className="mb-3 flex items-center gap-3">
          <h2 id="triage-heading" className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {t('dashboard.triage.title')}
          </h2>
          {waiting === 0 && (
            <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              {t('dashboard.triage.allClear')}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {queues.map((q) => {
            const Icon = q.icon
            const active = q.count > 0
            const body = (
              <div
                className={`h-full rounded-2xl border p-4 transition-colors ${
                  active
                    ? 'border-amber-300 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-500/10'
                    : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
                } ${q.href ? 'hover:border-violet-400 dark:hover:border-violet-500' : ''}`}
              >
                <div className="flex items-start justify-between">
                  <Icon
                    className={`h-5 w-5 ${active ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'}`}
                    aria-hidden
                  />
                  {q.href && active && <ArrowRight className="h-4 w-4 text-slate-400" aria-hidden />}
                </div>
                <p
                  className={`mt-3 text-3xl font-bold tabular-nums ${
                    active ? 'text-slate-900 dark:text-white' : 'text-slate-300 dark:text-slate-600'
                  }`}
                >
                  {q.count}
                </p>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{q.label}</p>
                {q.detail && (
                  <p className="mt-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">{q.detail}</p>
                )}
                {q.hint && active && (
                  <p className="mt-0.5 text-xs text-slate-500">{q.hint}</p>
                )}
              </div>
            )

            return q.href ? (
              <Link key={q.key} href={q.href} className="rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500">
                {body}
              </Link>
            ) : (
              <div key={q.key}>{body}</div>
            )
          })}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                {t('dashboard.recentOrders')}
              </h2>
              <Link href="/admin/orders">
                <Button size="sm" variant="ghost" icon={<ArrowRight className="h-4 w-4" />}>
                  {tc('viewAll')}
                </Button>
              </Link>
            </div>
            {recentOrders.length === 0 ? (
              <p className="py-4 text-sm text-slate-500">{t('dashboard.noOrdersYet')}</p>
            ) : (
              <Table>
                <Thead>
                  <tr>
                    <Th>{t('dashboard.tableDate')}</Th>
                    <Th>{t('dashboard.tableUser')}</Th>
                    <Th>{t('dashboard.tableAmount')}</Th>
                    <Th>{t('dashboard.tableStatus')}</Th>
                  </tr>
                </Thead>
                <Tbody>
                  {recentOrders.map((o) => (
                    <Tr key={o.id}>
                      <Td>{new Date(o.createdAt).toLocaleDateString()}</Td>
                      <Td><CopyableId value={o.userId} /></Td>
                      <Td className="font-semibold tabular-nums">{o.amount} {o.currency}</Td>
                      <Td><StatusBadge status={o.status} /></Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </Card>
        </div>

        {/* The all-time numbers keep their place, one step down: they describe
            the business, they do not ask for anything. */}
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">
            {t('dashboard.totals')}
          </h2>
          <dl className="space-y-3">
            {statItems.map((item) => {
              const Icon = item.icon
              return (
                <div key={item.label} className="flex items-center gap-3">
                  <Icon className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                  <dt className="text-sm text-slate-600 dark:text-slate-400">{item.label}</dt>
                  <dd className="ml-auto text-sm font-semibold tabular-nums text-slate-900 dark:text-white">
                    {item.value}
                  </dd>
                </div>
              )
            })}
          </dl>
        </Card>
      </div>
    </div>
  )
}
