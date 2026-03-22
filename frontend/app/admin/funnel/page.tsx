'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { motion } from 'framer-motion'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Tabs } from '@/components/ui/Tabs'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import {
  TrendingUp, ArrowDown, Loader2, ShoppingCart,
  CreditCard, CheckCircle, Users, XCircle, BarChart3, Eye,
} from 'lucide-react'
import api from '@/lib/api'
import type { Service } from '@/lib/types'

/* ---------- types ---------- */
interface FunnelMetrics {
  checkoutStarted: number
  paymentPending: number
  paymentCompleted: number
  subscribed: number
  abandoned: number
  totalEvents: number
  overallConversion: number
  checkoutToPayment: number
  paymentToSubscription: number
}

interface TimeSeriesPoint {
  period: string
  checkoutStarted: number
  paymentCompleted: number
  subscriptionCreated: number
  abandoned: number
}

interface AbandonedCheckout {
  id: string
  userId: string
  productName?: string
  amount?: string
  currency?: string
  abandonedAt: string
}

interface JourneyEvent {
  id: string
  eventType: string
  stage: string
  createdAt: string
  metadata?: Record<string, unknown>
}

/* ---------- helpers ---------- */
function periodDates(period: string): { from?: string; to?: string } {
  if (period === 'all') return {}
  const now = new Date()
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90
  const from = new Date(now.getTime() - days * 86400000)
  return { from: from.toISOString(), to: now.toISOString() }
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

/* ========== component ========== */
export default function AdminFunnelPage() {
  const t = useTranslations('admin.funnel')
  const tc = useTranslations('common')

  // shared state
  const [activeTab, setActiveTab] = useState('metrics')
  const [period, setPeriod] = useState('30d')
  const [serviceId, setServiceId] = useState('')
  const [services, setServices] = useState<Service[]>([])

  // tab 1
  const [metrics, setMetrics] = useState<FunnelMetrics | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(false)

  // tab 2
  const [timeSeries, setTimeSeries] = useState<TimeSeriesPoint[]>([])
  const [tsLoading, setTsLoading] = useState(false)
  const [granularity, setGranularity] = useState('day')

  // tab 3
  const [abandoned, setAbandoned] = useState<AbandonedCheckout[]>([])
  const [abandonedLoading, setAbandonedLoading] = useState(false)

  // journey modal
  const [journeyUserId, setJourneyUserId] = useState<string | null>(null)
  const [journeyEvents, setJourneyEvents] = useState<JourneyEvent[]>([])
  const [journeyLoading, setJourneyLoading] = useState(false)

  /* load services */
  useEffect(() => {
    api.get('/v1/admin/services').then(r => setServices(r.data?.items || r.data || [])).catch(() => {})
  }, [])

  /* load metrics */
  const loadMetrics = useCallback(async () => {
    setMetricsLoading(true)
    try {
      const { from, to } = periodDates(period)
      const params: Record<string, string> = {}
      if (serviceId) params.serviceId = serviceId
      if (from) params.from = from
      if (to) params.to = to
      const res = await api.get('/v1/admin/funnel/metrics', { params })
      setMetrics(res.data)
    } catch {
      setMetrics(null)
    } finally {
      setMetricsLoading(false)
    }
  }, [period, serviceId])

  /* load time series */
  const loadTimeSeries = useCallback(async () => {
    setTsLoading(true)
    try {
      const { from, to } = periodDates(period)
      const params: Record<string, string> = { granularity }
      if (serviceId) params.serviceId = serviceId
      if (from) params.from = from
      if (to) params.to = to
      const res = await api.get('/v1/admin/funnel/timeseries', { params })
      setTimeSeries(res.data?.items || res.data || [])
    } catch {
      setTimeSeries([])
    } finally {
      setTsLoading(false)
    }
  }, [period, serviceId, granularity])

  /* load abandoned */
  const loadAbandoned = useCallback(async () => {
    setAbandonedLoading(true)
    try {
      const res = await api.get('/v1/admin/funnel/abandoned', { params: { page: 1, limit: 20 } })
      setAbandoned(res.data?.items || res.data || [])
    } catch {
      setAbandoned([])
    } finally {
      setAbandonedLoading(false)
    }
  }, [])

  /* fetch on tab / filter change */
  useEffect(() => {
    if (activeTab === 'metrics') loadMetrics()
    else if (activeTab === 'trends') loadTimeSeries()
    else if (activeTab === 'abandoned') loadAbandoned()
  }, [activeTab, loadMetrics, loadTimeSeries, loadAbandoned])

  /* journey modal */
  const openJourney = async (userId: string) => {
    setJourneyUserId(userId)
    setJourneyLoading(true)
    try {
      const res = await api.get(`/v1/admin/funnel/user/${userId}`)
      setJourneyEvents(res.data?.items || res.data || [])
    } catch {
      setJourneyEvents([])
    } finally {
      setJourneyLoading(false)
    }
  }

  /* ---------- period & service selectors ---------- */
  const periodOptions = [
    { value: '7d', label: t('last7days') },
    { value: '30d', label: t('last30days') },
    { value: '90d', label: t('last90days') },
    { value: 'all', label: t('allTime') },
  ]
  const serviceOptions = [
    { value: '', label: tc('all') },
    ...services.map(s => ({ value: s.id, label: s.name || s.code })),
  ]

  const tabItems = [
    { key: 'metrics', label: t('metrics') },
    { key: 'trends', label: t('timeSeries') },
    { key: 'abandoned', label: t('abandoned') },
  ]

  /* ---------- render ---------- */
  return (
    <div>
      {/* header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('subtitle')}</p>
      </div>

      {/* tabs + filters */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6">
        <Tabs tabs={tabItems} activeTab={activeTab} onChange={setActiveTab} />
        <div className="flex gap-3 ml-auto">
          {activeTab === 'trends' && (
            <Select
              value={granularity}
              onChange={e => setGranularity(e.target.value)}
              options={[
                { value: 'day', label: 'Day' },
                { value: 'week', label: 'Week' },
                { value: 'month', label: 'Month' },
              ]}
            />
          )}
          {activeTab !== 'abandoned' && (
            <>
              <Select value={period} onChange={e => setPeriod(e.target.value)} options={periodOptions} />
              <Select value={serviceId} onChange={e => setServiceId(e.target.value)} options={serviceOptions} />
            </>
          )}
        </div>
      </div>

      {/* Tab 1: Funnel Metrics */}
      {activeTab === 'metrics' && (
        <MetricsView metrics={metrics} loading={metricsLoading} />
      )}

      {/* Tab 2: Trends */}
      {activeTab === 'trends' && (
        <TrendsView data={timeSeries} loading={tsLoading} />
      )}

      {/* Tab 3: Abandoned */}
      {activeTab === 'abandoned' && (
        <AbandonedView items={abandoned} loading={abandonedLoading} onViewJourney={openJourney} />
      )}

      {/* Journey Modal */}
      <Modal
        isOpen={!!journeyUserId}
        onClose={() => setJourneyUserId(null)}
        title={journeyUserId ? t('journeyTitle', { userId: journeyUserId.slice(0, 12) + '...' }) : ''}
      >
        {journeyLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
          </div>
        ) : journeyEvents.length === 0 ? (
          <p className="text-sm text-gray-500 py-4">{t('noData')}</p>
        ) : (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {journeyEvents.map((ev, i) => (
              <div key={ev.id || i} className="flex items-start gap-3 relative">
                <div className="flex flex-col items-center">
                  <div className="w-3 h-3 rounded-full bg-violet-500 mt-1" />
                  {i < journeyEvents.length - 1 && <div className="w-0.5 flex-1 bg-violet-200 dark:bg-violet-800 mt-1" />}
                </div>
                <div className="flex-1 pb-4">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{ev.eventType}</p>
                  <p className="text-xs text-gray-500">{ev.stage}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{new Date(ev.createdAt).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  )
}

/* ====================================================================
   Tab 1 - Funnel Metrics
   ==================================================================== */
function MetricsView({ metrics, loading }: {
  metrics: FunnelMetrics | null
  loading: boolean
}) {
  const t = useTranslations('admin.funnel')

  if (loading) return <div className="flex items-center gap-2 text-gray-500"><Loader2 className="w-5 h-5 animate-spin" /></div>
  if (!metrics) return <p className="text-gray-500">{t('noData')}</p>

  const stages = [
    { key: 'checkout', label: t('stageCheckout'), count: metrics.checkoutStarted, color: 'bg-blue-500', icon: ShoppingCart },
    { key: 'payment', label: t('stagePayment'), count: metrics.paymentPending, color: 'bg-amber-500', icon: CreditCard },
    { key: 'completed', label: t('stageConversion'), count: metrics.paymentCompleted, color: 'bg-emerald-500', icon: CheckCircle },
    { key: 'subscribed', label: t('stageRetention'), count: metrics.subscribed, color: 'bg-violet-500', icon: Users },
  ]

  const conversions = [
    metrics.checkoutStarted > 0 ? Math.round((metrics.paymentPending / metrics.checkoutStarted) * 100) : 0,
    metrics.paymentPending > 0 ? Math.round((metrics.paymentCompleted / metrics.paymentPending) * 100) : 0,
    metrics.paymentCompleted > 0 ? Math.round((metrics.subscribed / metrics.paymentCompleted) * 100) : 0,
  ]

  const maxCount = Math.max(...stages.map(s => s.count), 1)

  const summaryCards = [
    { label: t('totalEvents'), value: metrics.totalEvents, icon: BarChart3, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-900/20' },
    { label: t('overallConversion'), value: `${metrics.overallConversion}%`, icon: TrendingUp, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
    { label: t('abandonedCount'), value: metrics.abandoned, icon: XCircle, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-900/20' },
  ]

  return (
    <>
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {summaryCards.map(c => {
          const Icon = c.icon
          return (
            <Card key={c.label}>
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl ${c.bg} flex items-center justify-center`}>
                  <Icon className={`w-6 h-6 ${c.color}`} />
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">{c.value}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{c.label}</p>
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      {/* Funnel visualization */}
      <Card>
        <div className="space-y-2">
          {stages.map((stage, i) => {
            const Icon = stage.icon
            const pct = maxCount > 0 ? Math.round((stage.count / maxCount) * 100) : 0
            return (
              <div key={stage.key}>
                <div className="flex items-center gap-4 py-3">
                  <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{stage.label}</span>
                      <span className="text-sm font-bold text-gray-900 dark:text-white">{stage.count}</span>
                    </div>
                    <div className="h-8 bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden">
                      <motion.div
                        className={`h-full ${stage.color} rounded-lg`}
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.8, ease: 'easeOut', delay: i * 0.15 }}
                      />
                    </div>
                  </div>
                </div>
                {i < stages.length - 1 && (
                  <div className="flex items-center gap-2 pl-12 py-1">
                    <ArrowDown className="w-4 h-4 text-gray-400" />
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                      {conversions[i]}% {t('conversionRate').toLowerCase()}
                    </span>
                  </div>
                )}
              </div>
            )
          })}

          {/* Abandoned / churned */}
          <div className="flex items-center gap-4 py-3 mt-2 border-t border-gray-100 dark:border-gray-800">
            <div className="w-8 h-8 rounded-lg bg-red-50 dark:bg-red-900/20 flex items-center justify-center shrink-0">
              <XCircle className="w-4 h-4 text-red-500" />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-red-600 dark:text-red-400">{t('stageChurned')}</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-red-600 dark:text-red-400">{metrics.abandoned}</span>
                  {metrics.checkoutStarted > 0 && (
                    <Badge variant="error">
                      {Math.round((metrics.abandoned / metrics.checkoutStarted) * 100)}% {t('dropOff').toLowerCase()}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Step conversion summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
        <Card>
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">{t('checkoutToPayment')}</p>
          <p className="text-3xl font-bold text-gray-900 dark:text-white">{metrics.checkoutToPayment}%</p>
        </Card>
        <Card>
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">{t('paymentToSubscription')}</p>
          <p className="text-3xl font-bold text-gray-900 dark:text-white">{metrics.paymentToSubscription}%</p>
        </Card>
      </div>
    </>
  )
}

/* ====================================================================
   Tab 2 - Trends (CSS bar chart)
   ==================================================================== */
function TrendsView({ data, loading }: {
  data: TimeSeriesPoint[]
  loading: boolean
}) {
  const t = useTranslations('admin.funnel')

  if (loading) return <div className="flex items-center gap-2 text-gray-500"><Loader2 className="w-5 h-5 animate-spin" /></div>
  if (data.length === 0) return <p className="text-gray-500">{t('noData')}</p>

  const max = Math.max(...data.flatMap(d => [d.checkoutStarted, d.paymentCompleted, d.subscriptionCreated, d.abandoned]), 1)

  const legend = [
    { label: t('checkoutStarted'), color: 'bg-blue-500' },
    { label: t('paymentCompleted'), color: 'bg-emerald-500' },
    { label: t('subscriptionCreated'), color: 'bg-violet-500' },
    { label: t('abandonedLabel'), color: 'bg-red-400' },
  ]

  return (
    <>
      {/* Legend */}
      <div className="flex flex-wrap gap-4 mb-4">
        {legend.map(l => (
          <div key={l.label} className="flex items-center gap-1.5">
            <span className={`w-3 h-3 rounded-sm ${l.color}`} />
            <span className="text-xs text-gray-600 dark:text-gray-400">{l.label}</span>
          </div>
        ))}
      </div>

      {/* CSS bar chart */}
      <Card>
        <div className="overflow-x-auto">
          <div className="flex items-end gap-3 min-h-[220px] pb-2" style={{ minWidth: data.length * 80 }}>
            {data.map((d, i) => {
              const bars = [
                { val: d.checkoutStarted, color: 'bg-blue-500' },
                { val: d.paymentCompleted, color: 'bg-emerald-500' },
                { val: d.subscriptionCreated, color: 'bg-violet-500' },
                { val: d.abandoned, color: 'bg-red-400' },
              ]
              return (
                <div key={i} className="flex flex-col items-center flex-1 min-w-[60px]">
                  <div className="flex items-end gap-0.5 h-44">
                    {bars.map((b, bi) => (
                      <motion.div
                        key={bi}
                        className={`w-3 rounded-t ${b.color}`}
                        initial={{ height: 0 }}
                        animate={{ height: `${max > 0 ? (b.val / max) * 160 : 0}px` }}
                        transition={{ duration: 0.6, delay: i * 0.05 + bi * 0.05 }}
                        title={String(b.val)}
                      />
                    ))}
                  </div>
                  <span className="text-[10px] text-gray-500 mt-2 text-center truncate w-full">{d.period}</span>
                </div>
              )
            })}
          </div>
        </div>
      </Card>

      {/* Data table */}
      <Card className="mt-6">
        <Table>
          <Thead>
            <tr>
              <Th>{t('period')}</Th>
              <Th>{t('checkoutStarted')}</Th>
              <Th>{t('paymentCompleted')}</Th>
              <Th>{t('subscriptionCreated')}</Th>
              <Th>{t('abandonedLabel')}</Th>
            </tr>
          </Thead>
          <Tbody>
            {data.map((d, i) => (
              <tr key={i}>
                <Td className="font-medium">{d.period}</Td>
                <Td>{d.checkoutStarted}</Td>
                <Td>{d.paymentCompleted}</Td>
                <Td>{d.subscriptionCreated}</Td>
                <Td className="text-red-600 dark:text-red-400">{d.abandoned}</Td>
              </tr>
            ))}
          </Tbody>
        </Table>
      </Card>
    </>
  )
}

/* ====================================================================
   Tab 3 - Abandoned Checkouts
   ==================================================================== */
function AbandonedView({ items, loading, onViewJourney }: {
  items: AbandonedCheckout[]
  loading: boolean
  onViewJourney: (userId: string) => void
}) {
  const t = useTranslations('admin.funnel')
  const tc = useTranslations('common')

  if (loading) return <div className="flex items-center gap-2 text-gray-500"><Loader2 className="w-5 h-5 animate-spin" /></div>
  if (items.length === 0) return <p className="text-gray-500">{t('noData')}</p>

  return (
    <Card>
      <Table>
        <Thead>
          <tr>
            <Th>{t('user')}</Th>
            <Th>{t('product')}</Th>
            <Th>{t('amount')}</Th>
            <Th>{t('abandonedAt')}</Th>
            <Th>{tc('actions')}</Th>
          </tr>
        </Thead>
        <Tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <Td className="font-mono text-xs">{item.userId.slice(0, 12)}...</Td>
              <Td>{item.productName || '-'}</Td>
              <Td className="font-semibold">{item.amount ? `${item.amount} ${item.currency || ''}` : '-'}</Td>
              <Td>{t('timeAgo', { time: timeAgo(item.abandonedAt) })}</Td>
              <Td>
                <Button size="sm" variant="ghost" onClick={() => onViewJourney(item.userId)} icon={<Eye className="w-4 h-4" />}>
                  {t('viewJourney')}
                </Button>
              </Td>
            </tr>
          ))}
        </Tbody>
      </Table>
    </Card>
  )
}
