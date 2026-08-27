'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { Tabs } from '@/components/ui/Tabs'
import { Select } from '@/components/ui/Select'
import {
  Loader2, ShoppingCart, CreditCard, CheckCircle, Users,
  XCircle, TrendingDown, DollarSign, BarChart3, Clock,
  Bot, Send, Tag, Mail, AlertTriangle,
  X, Play, Eye, ChevronRight,
} from 'lucide-react'
import api from '@/lib/api'
import type { Service } from '@/lib/types'
import AiInsightsCard from '@/components/admin/AiInsightsCard'
import Link from 'next/link'

/* ---------- types ---------- */
interface PipelineItem {
  id: string
  userId: string
  orderId?: string
  productName?: string
  serviceName?: string
  amount?: number
  currency?: string
  eventType: string
  stage: string
  createdAt: string
  properties?: Record<string, unknown>
  hasFollowUp?: boolean
}

interface PipelineStage {
  stage: string
  items: PipelineItem[]
}

interface PipelineStats {
  total: number
  conversionRate: number
  abandonedCount: number
  activeSubscriptions: number
  churningCount: number
  totalValue: number
}

interface PipelineData {
  stages: PipelineStage[]
  stats: PipelineStats
}

interface JourneyEvent {
  id: string
  eventType: string
  stage: string
  createdAt: string
  properties?: Record<string, unknown>
  amount?: number
  currency?: string
}

/* ---------- stage config ---------- */
const STAGE_CONFIG: Record<string, {
  color: string
  borderColor: string
  bgColor: string
  darkBgColor: string
  dotColor: string
  icon: typeof ShoppingCart
  i18nKey: string
}> = {
  checkout: {
    color: 'text-blue-600 dark:text-blue-400',
    borderColor: 'border-t-blue-500',
    bgColor: 'bg-blue-50',
    darkBgColor: 'dark:bg-blue-900/20',
    dotColor: 'bg-blue-500',
    icon: ShoppingCart,
    i18nKey: 'stageCheckoutStarted',
  },
  payment: {
    color: 'text-amber-600 dark:text-amber-400',
    borderColor: 'border-t-amber-500',
    bgColor: 'bg-amber-50',
    darkBgColor: 'dark:bg-amber-900/20',
    dotColor: 'bg-amber-500',
    icon: CreditCard,
    i18nKey: 'stagePaymentPending',
  },
  conversion: {
    color: 'text-emerald-600 dark:text-emerald-400',
    borderColor: 'border-t-emerald-500',
    bgColor: 'bg-emerald-50',
    darkBgColor: 'dark:bg-emerald-900/20',
    dotColor: 'bg-emerald-500',
    icon: CheckCircle,
    i18nKey: 'stagePaid',
  },
  retention: {
    color: 'text-violet-600 dark:text-violet-400',
    borderColor: 'border-t-violet-500',
    bgColor: 'bg-violet-50',
    darkBgColor: 'dark:bg-violet-900/20',
    dotColor: 'bg-violet-500',
    icon: Users,
    i18nKey: 'stageActiveSubscription',
  },
  churning: {
    color: 'text-orange-600 dark:text-orange-400',
    borderColor: 'border-t-orange-500',
    bgColor: 'bg-orange-50',
    darkBgColor: 'dark:bg-orange-900/20',
    dotColor: 'bg-orange-500',
    icon: TrendingDown,
    i18nKey: 'stageChurning',
  },
  churned: {
    color: 'text-red-600 dark:text-red-400',
    borderColor: 'border-t-red-500',
    bgColor: 'bg-red-50',
    darkBgColor: 'dark:bg-red-900/20',
    dotColor: 'bg-red-500',
    icon: XCircle,
    i18nKey: 'stageChurned',
  },
}

const STAGE_ORDER = ['checkout', 'payment', 'conversion', 'retention', 'churning', 'churned']

/* ---------- helpers ---------- */
function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

function timeDuration(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hours`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} days`
  const months = Math.floor(days / 30)
  return `${months} months`
}

function formatCurrency(amount: number | undefined, currency: string | undefined): string {
  if (amount === undefined || amount === null) return '-'
  const sym = currency === 'USD' ? '$' : currency === 'EUR' ? '\u20AC' : currency === 'RUB' ? '\u20BD' : (currency || '')
  return `${sym}${amount.toFixed(2)}`
}

/* ========== Main Component ========== */
export default function AdminFunnelPage() {
  const t = useTranslations('admin.funnel')
  const tc = useTranslations('common')

  const [serviceId, setServiceId] = useState('')
  const [services, setServices] = useState<Service[]>([])
  const [pipeline, setPipeline] = useState<PipelineData | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedItem, setSelectedItem] = useState<PipelineItem | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  /* load services */
  useEffect(() => {
    api.get('/v1/admin/services').then(r => setServices(r.data?.items || r.data || [])).catch(() => {})
  }, [])

  /* load pipeline */
  const loadPipeline = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (serviceId) params.serviceId = serviceId
      const res = await api.get('/v1/admin/funnel/pipeline', { params })
      setPipeline(res.data)
    } catch {
      setPipeline(null)
    } finally {
      setLoading(false)
    }
  }, [serviceId])

  useEffect(() => {
    loadPipeline()
  }, [loadPipeline])

  /* toast */
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [toastMessage])

  const serviceOptions = [
    { value: '', label: tc('all') },
    ...services.map(s => ({ value: s.id, label: s.name || s.code })),
  ]

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('pipeline')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('subtitle')}</p>
        </div>
        <div className="ml-auto">
          <Select value={serviceId} onChange={e => setServiceId(e.target.value)} options={serviceOptions} />
        </div>
      </div>

      {/* AI insights */}
      <AiInsightsCard serviceId={serviceId || undefined} />

      {/* Stats bar */}
      {pipeline && <StatsBar stats={pipeline.stats} />}

      {/* Main content: Kanban + Detail */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
        </div>
      ) : !pipeline ? (
        <p className="text-slate-500 py-8">{t('noData')}</p>
      ) : (
        <div className="flex gap-0 flex-1 min-h-0 mt-4">
          {/* Left: Kanban (70%) */}
          <div className={`${selectedItem ? 'w-[70%]' : 'w-full'} transition-all duration-300 overflow-x-auto`}>
            <div className="flex gap-3 min-w-max h-full pb-4">
              {pipeline.stages.map(stage => (
                <KanbanColumn
                  key={stage.stage}
                  stage={stage}
                  selectedItemId={selectedItem?.id}
                  onSelectItem={setSelectedItem}
                />
              ))}
            </div>
          </div>

          {/* Right: Detail Panel (30%) */}
          {selectedItem && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: '30%', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="border-l border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 min-w-[340px] overflow-y-auto rounded-r-2xl"
            >
              <DetailPanel
                item={selectedItem}
                onClose={() => setSelectedItem(null)}
              />
            </motion.div>
          )}
        </div>
      )}

      {/* Toast */}
      {toastMessage && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="fixed bottom-6 right-6 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-4 py-3 rounded-xl shadow-lg text-sm font-medium z-50"
        >
          {toastMessage}
        </motion.div>
      )}
    </div>
  )
}

/* ====================================================================
   Stats Bar
   ==================================================================== */
function StatsBar({ stats }: { stats: PipelineStats }) {
  const t = useTranslations('admin.funnel')

  const items = [
    { label: t('totalInPipeline'), value: stats.total, icon: BarChart3, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-900/20' },
    { label: t('conversionRate'), value: `${stats.conversionRate}%`, icon: TrendingDown, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
    { label: t('abandonedCount'), value: stats.abandonedCount, icon: XCircle, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-900/20' },
    { label: t('activeCount'), value: stats.activeSubscriptions, icon: Users, color: 'text-violet-500', bg: 'bg-violet-50 dark:bg-violet-900/20' },
    { label: t('churningCount'), value: stats.churningCount, icon: AlertTriangle, color: 'text-orange-500', bg: 'bg-orange-50 dark:bg-orange-900/20' },
    { label: t('pipelineValue'), value: `$${stats.totalValue.toLocaleString()}`, icon: DollarSign, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {items.map(item => {
        const Icon = item.icon
        return (
          <div key={item.label} className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl p-3 flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg ${item.bg} flex items-center justify-center shrink-0`}>
              <Icon className={`w-4 h-4 ${item.color}`} />
            </div>
            <div className="min-w-0">
              <p className="text-lg font-bold text-slate-900 dark:text-white leading-tight truncate">{item.value}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{item.label}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ====================================================================
   Kanban Column
   ==================================================================== */
function KanbanColumn({ stage, selectedItemId, onSelectItem }: {
  stage: PipelineStage
  selectedItemId?: string
  onSelectItem: (item: PipelineItem) => void
}) {
  const t = useTranslations('admin.funnel')
  const config = STAGE_CONFIG[stage.stage] || STAGE_CONFIG.checkout
  const Icon = config.icon

  return (
    <div className="w-64 shrink-0 flex flex-col">
      {/* Column header */}
      <div className={`border-t-[3px] ${config.borderColor} bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-t-xl px-3 py-2.5`}>
        <div className="flex items-center gap-2">
          <div className={`w-6 h-6 rounded-md ${config.bgColor} ${config.darkBgColor} flex items-center justify-center`}>
            <Icon className={`w-3.5 h-3.5 ${config.color}`} />
          </div>
          <span className="text-sm font-semibold text-slate-900 dark:text-white truncate">{t(config.i18nKey)}</span>
          <span className="ml-auto text-xs font-medium text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded-md">
            {stage.items.length}
          </span>
        </div>
      </div>

      {/* Cards container */}
      <div className="flex-1 overflow-y-auto space-y-2 pt-2 pb-2 max-h-[calc(100vh-340px)]">
        {stage.items.length === 0 ? (
          <div className="text-center py-6 text-xs text-slate-400">{t('noData')}</div>
        ) : (
          stage.items.map(item => (
            <PipelineCard
              key={item.id}
              item={item}
              isSelected={selectedItemId === item.id}
              onClick={() => onSelectItem(item)}
            />
          ))
        )}
      </div>
    </div>
  )
}

/* ====================================================================
   Pipeline Card
   ==================================================================== */
function PipelineCard({ item, isSelected, onClick }: {
  item: PipelineItem
  isSelected: boolean
  onClick: () => void
}) {
  const t = useTranslations('admin.funnel')
  const config = STAGE_CONFIG[item.stage] || STAGE_CONFIG.checkout

  return (
    <motion.div
      whileHover={{ scale: 1.02, y: -1 }}
      transition={{ duration: 0.15 }}
      onClick={onClick}
      className={`
        bg-white dark:bg-slate-800 border rounded-xl p-3 cursor-pointer transition-all duration-150
        ${isSelected
          ? 'border-violet-400 dark:border-violet-500 ring-2 ring-violet-200 dark:ring-violet-800/50 shadow-md'
          : 'border-slate-200 dark:border-slate-700 hover:shadow-md hover:border-slate-300 dark:hover:border-slate-600'}
      `}
    >
      {/* User ID */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-mono text-slate-600 dark:text-slate-300 truncate max-w-[140px]">
          {item.userId.length > 16 ? item.userId.slice(0, 16) + '...' : item.userId}
        </span>
        {item.hasFollowUp && (
          <span title={t('followUpSent')} className="text-violet-500">
            <Bot className="w-3.5 h-3.5" />
          </span>
        )}
      </div>

      {/* Product name */}
      {item.productName && (
        <p className="text-sm font-medium text-slate-900 dark:text-white truncate mb-1">
          {item.productName}
        </p>
      )}

      {/* Amount + time */}
      <div className="flex items-center justify-between mt-2">
        <span className="text-sm font-semibold text-slate-900 dark:text-white">
          {formatCurrency(item.amount, item.currency)}
        </span>
        <span className="text-xs text-slate-400 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {t('cardTimeAgo', { time: timeAgo(item.createdAt) })}
        </span>
      </div>

      {/* Stage badge */}
      <div className="mt-2">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${config.bgColor} ${config.darkBgColor} ${config.color}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${config.dotColor}`} />
          {t(config.i18nKey)}
        </span>
      </div>
    </motion.div>
  )
}

/* ====================================================================
   Detail Panel
   ==================================================================== */
function DetailPanel({ item, onClose }: {
  item: PipelineItem
  onClose: () => void
}) {
  const t = useTranslations('admin.funnel')
  const [activeTab, setActiveTab] = useState('overview')
  const [journeyEvents, setJourneyEvents] = useState<JourneyEvent[]>([])
  const [journeyLoading, setJourneyLoading] = useState(false)

  const tabItems = [
    { key: 'overview', label: t('detailOverview') },
    { key: 'timeline', label: t('detailTimeline') },
    { key: 'actions', label: t('detailActions') },
  ]

  /* Load journey when timeline tab is selected */
  useEffect(() => {
    if (activeTab === 'timeline' && item.userId) {
      setJourneyLoading(true)
      api.get(`/v1/admin/funnel/user/${item.userId}`)
        .then(r => setJourneyEvents(r.data?.items || r.data || []))
        .catch(() => setJourneyEvents([]))
        .finally(() => setJourneyLoading(false))
    }
  }, [activeTab, item.userId])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-sm font-mono text-slate-500 truncate">{item.userId}</p>
          {item.productName && (
            <p className="text-base font-semibold text-slate-900 dark:text-white truncate">{item.productName}</p>
          )}
        </div>
        <button onClick={onClose} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">
          <X className="w-4 h-4 text-slate-400" />
        </button>
      </div>

      {/* Tabs */}
      <div className="px-4 pt-3">
        <Tabs tabs={tabItems} activeTab={activeTab} onChange={setActiveTab} />
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'overview' && <OverviewTab item={item} />}
        {activeTab === 'timeline' && <TimelineTab events={journeyEvents} loading={journeyLoading} />}
        {activeTab === 'actions' && <ActionsTab item={item} />}
      </div>
    </div>
  )
}

/* ====================================================================
   Overview Tab
   ==================================================================== */
function OverviewTab({ item }: { item: PipelineItem }) {
  const t = useTranslations('admin.funnel')
  const config = STAGE_CONFIG[item.stage] || STAGE_CONFIG.checkout
  const stageIndex = STAGE_ORDER.indexOf(item.stage)

  return (
    <div className="space-y-5">
      {/* Progress bar */}
      <div>
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-3 uppercase tracking-wider">{t('progressBar')}</p>
        <div className="flex items-center gap-0">
          {STAGE_ORDER.map((stage, i) => {
            const sc = STAGE_CONFIG[stage]
            const isCurrent = stage === item.stage
            const isCompleted = i <= stageIndex && item.stage !== 'churned'
            const isChurned = item.stage === 'churned' && stage === 'churned'

            return (
              <div key={stage} className="flex items-center">
                {i > 0 && (
                  <div className={`w-6 h-0.5 ${isCompleted ? sc.dotColor : 'bg-slate-200 dark:bg-slate-700'}`} />
                )}
                <div
                  title={t(sc.i18nKey)}
                  className={`
                    w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-all
                    ${isCurrent || isChurned
                      ? `${sc.dotColor} ring-4 ring-opacity-20 ${sc.bgColor}`
                      : isCompleted
                        ? sc.dotColor
                        : 'bg-slate-200 dark:bg-slate-700'}
                  `}
                >
                  {(isCurrent || isChurned) && (
                    <div className="w-2 h-2 rounded-full bg-white" />
                  )}
                </div>
              </div>
            )
          })}
        </div>
        <div className="flex justify-between mt-1.5">
          {STAGE_ORDER.map(stage => {
            const sc = STAGE_CONFIG[stage]
            return (
              <span key={stage} className={`text-[9px] ${stage === item.stage ? sc.color + ' font-semibold' : 'text-slate-400'}`}>
                {t(sc.i18nKey).split(' ')[0]}
              </span>
            )
          })}
        </div>
      </div>

      {/* Info rows */}
      <div className="space-y-3">
        <InfoRow label={t('currentStage')} value={
          <span className={`inline-flex items-center gap-1.5 ${config.color} font-medium`}>
            <span className={`w-2 h-2 rounded-full ${config.dotColor}`} />
            {t(config.i18nKey)}
          </span>
        } />
        <InfoRow label={t('user')} value={
          <span className="font-mono text-xs">{item.userId}</span>
        } />
        {item.productName && (
          <InfoRow label={t('product')} value={item.productName} />
        )}
        {item.serviceName && (
          <InfoRow label="Service" value={item.serviceName} />
        )}
        {item.amount !== undefined && (
          <InfoRow label={t('amount')} value={
            <span className="font-semibold">{formatCurrency(item.amount, item.currency)}</span>
          } />
        )}
        <InfoRow label={t('timeInFunnel')} value={timeDuration(item.createdAt)} />
        {item.orderId && (
          <InfoRow label={t('orderId')} value={
            <span className="font-mono text-xs">{item.orderId.slice(0, 12)}...</span>
          } />
        )}
      </div>

      {/* AI Management placeholder */}
      <div className="mt-4 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-dashed border-slate-300 dark:border-slate-600">
        <div className="flex items-center gap-2 mb-1">
          <Bot className="w-4 h-4 text-violet-500" />
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('aiManagement')}</span>
        </div>
        <p className="text-xs text-slate-500">{t('aiManagementPlaceholder')}</p>
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">{label}</span>
      <span className="text-sm text-slate-900 dark:text-white text-right">{value}</span>
    </div>
  )
}

/* ====================================================================
   Timeline Tab
   ==================================================================== */
function TimelineTab({ events, loading }: { events: JourneyEvent[]; loading: boolean }) {
  const t = useTranslations('admin.funnel')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current && events.length > 0) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [events])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-violet-500" />
      </div>
    )
  }

  if (events.length === 0) {
    return <p className="text-sm text-slate-500 py-4">{t('noData')}</p>
  }

  return (
    <div ref={scrollRef} className="space-y-0 max-h-[500px] overflow-y-auto">
      {events.map((event, i) => {
        const config = STAGE_CONFIG[event.stage] || STAGE_CONFIG.checkout
        return (
          <div key={event.id || i} className="flex gap-3 relative">
            {/* Vertical line + dot */}
            <div className="flex flex-col items-center">
              <div className={`w-3 h-3 rounded-full ${config.dotColor} mt-1 shrink-0 z-10`} />
              {i < events.length - 1 && (
                <div className="w-0.5 flex-1 bg-slate-200 dark:bg-slate-700 mt-1" />
              )}
            </div>

            {/* Content */}
            <div className="flex-1 pb-5 min-w-0">
              <div className="flex items-center gap-2">
                <span className={`text-sm font-medium ${config.color}`}>{event.eventType}</span>
              </div>
              <span className="text-xs text-slate-400">
                {event.stage}
              </span>
              <p className="text-xs text-slate-500 mt-0.5">
                {new Date(event.createdAt).toLocaleString()}
              </p>
              {event.properties && Object.keys(event.properties).length > 0 && (
                <div className="mt-1.5 p-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                  <p className="text-[10px] text-slate-400 uppercase mb-1">{t('eventProperties')}</p>
                  {Object.entries(event.properties).map(([key, val]) => (
                    <p key={key} className="text-xs text-slate-600 dark:text-slate-400">
                      <span className="font-medium">{key}:</span> {String(val)}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ====================================================================
   Actions Tab
   ==================================================================== */
function ActionsTab({ item }: { item: PipelineItem }) {
  const t = useTranslations('admin.funnel')

  // These buttons used to call `triggerAction`, which showed a success toast
  // and made no request at all — an operator clicked "Send reminder", was told
  // it worked, and the customer heard nothing. There is no on-demand outreach
  // endpoint: `OutreachTriggersScheduler` enqueues abandoned-checkout, dunning,
  // trial-ending and win-back messages on a schedule. So the tab now says what
  // is actually true and links to the places where an operator can act.
  const destinations: Record<string, Array<{ labelKey: string; descKey: string; href: string; icon: typeof Send }>> = {
    checkout: [
      { labelKey: 'openOutreach', descKey: 'openOutreachDesc', href: '/admin/outreach', icon: Send },
      { labelKey: 'openOrder', descKey: 'openOrderDesc', href: '/admin/orders', icon: Eye },
    ],
    payment: [{ labelKey: 'openOrder', descKey: 'openOrderDesc', href: '/admin/orders', icon: Eye }],
    conversion: [],
    retention: [],
    churning: [
      { labelKey: 'openOutreach', descKey: 'openOutreachDesc', href: '/admin/outreach', icon: Send },
      { labelKey: 'openPromoCodes', descKey: 'openPromoCodesDesc', href: '/admin/promo-codes', icon: Tag },
    ],
    churned: [{ labelKey: 'openOutreach', descKey: 'openOutreachDesc', href: '/admin/outreach', icon: Send }],
  }

  const links = destinations[item.stage] || []

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
        <p className="text-sm font-medium text-slate-900 dark:text-white">{t('automatedTitle')}</p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('automatedBody')}</p>
      </div>

      {links.length === 0 ? (
        <div className="py-6 text-center">
          <CheckCircle className="mx-auto mb-2 h-8 w-8 text-emerald-400" />
          <p className="text-sm text-slate-500">{t('noActions')}</p>
        </div>
      ) : (
        links.map((link) => {
          const Icon = link.icon
          return (
            <Link
              key={link.labelKey}
              href={link.href}
              className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-violet-300 hover:bg-violet-50/40 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-violet-700 dark:hover:bg-violet-900/10"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-700">
                <Icon className="h-4 w-4 text-slate-600 dark:text-slate-300" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900 dark:text-white">{t(link.labelKey)}</p>
                <p className="mt-0.5 text-xs text-slate-500">{t(link.descKey)}</p>
              </div>
              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            </Link>
          )
        })
      )}
    </div>
  )
}
