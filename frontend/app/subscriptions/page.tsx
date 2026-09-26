'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { motion } from 'framer-motion'
import { ClientLayout } from '@/components/layout/ClientLayout'
import { Card } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useFormat } from '@/lib/useFormat'
import { useFeatureLabel } from '@/components/catalog/useFeatureLabel'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Tabs } from '@/components/ui/Tabs'
import { useAuth } from '@/contexts/AuthContext'
import { CreditCard, Calendar, Clock, DollarSign, AlertTriangle, Loader2, Package, Zap, Check, RotateCcw } from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import type { Subscription } from '@/lib/types'
import { useNow } from '@/hooks/useNow'
import { getErrorMessage } from '@/lib/api-error'

export default function SubscriptionsPage() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const t = useTranslations('subscriptions')
  const tc = useTranslations('common')
  const ts = useTranslations('common.status')
  const f = useFormat()
  const featureLabel = useFeatureLabel()
  const [resuming, setResuming] = useState<string | null>(null)

  const statusTabs = [
    { key: '', label: t('tabAll') },
    { key: 'active', label: t('tabActive') },
    { key: 'trialing', label: t('tabTrial') },
    { key: 'past_due', label: t('tabPastDue') },
    { key: 'canceled', label: t('tabCanceled') },
  ]
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [statusFilter, setStatusFilter] = useState('')
  const [selectedSub, setSelectedSub] = useState<Subscription | null>(null)
  const [loading, setLoading] = useState(true)
  // Every hook before the early returns below, so the order never changes.
  const now = useNow(60 * 60 * 1000)
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean
    title: string
    message: string
    onConfirm: () => Promise<void>
    variant?: 'danger' | 'default'
  } | null>(null)

  useEffect(() => {
    if (authLoading) return
    if (!user) { router.push('/login'); return }

    async function load() {
      try {
        const res = await api.get('/v1/subscriptions/me')
        setSubscriptions(res.data)
      } catch (e: unknown) {
        const err = e as { response?: { data?: { message?: string } } }
        toast.error(err.response?.data?.message || t('loadError'))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [user, authLoading, router, t])

  if (authLoading || !user) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-violet-500" /></div>
  }

  const handleCancel = (sub: Subscription) => {
    const id = sub.id
    setConfirmState({
      isOpen: true,
      title: t('cancelTitle'),
      message: t('cancelMessage', { date: f.date(sub.currentPeriodEnd) }),
      variant: 'danger',
      onConfirm: async () => {
        try {
          await api.post('/v1/subscriptions/cancel', { subscriptionId: id })
          setSubscriptions((prev) =>
            // Cancelling stops the renewal; the plan runs to the end of the
            // period it was paid for. It used to be shown as cancelled at once.
            prev.map((s) => (s.id === id ? { ...s, cancelAtPeriodEnd: true } : s))
          )
          setSelectedSub((cur) => (cur && cur.id === id ? { ...cur, cancelAtPeriodEnd: true } : cur))
          toast.success(t('cancelSuccess'))
        } catch (e) {
          toast.error(getErrorMessage(e, t('cancelError')))
          throw e
        }
      },
    })
  }

  const handleResume = async (id: string) => {
    setResuming(id)
    try {
      await api.post('/v1/subscriptions/resume', { subscriptionId: id })
      setSubscriptions((prev) => prev.map((s) => (s.id === id ? { ...s, cancelAtPeriodEnd: false } : s)))
      setSelectedSub((cur) => (cur && cur.id === id ? { ...cur, cancelAtPeriodEnd: false } : cur))
      toast.success(t('resumeSuccess'))
    } catch (e) {
      toast.error(getErrorMessage(e, t('resumeError')))
    } finally {
      setResuming(null)
    }
  }

  const filtered = statusFilter
    ? subscriptions.filter((s) => s.status === statusFilter)
    : subscriptions

  const activeSubs = subscriptions.filter((s) => s.status === 'active' || s.status === 'trialing')

  const daysUntil = (date: string) => {
    const diff = new Date(date).getTime() - now
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
  }

  const periodProgress = (start: string, end: string) => {
    const total = new Date(end).getTime() - new Date(start).getTime()
    const elapsed = now - new Date(start).getTime()
    return Math.min(100, Math.max(0, (elapsed / total) * 100))
  }

  return (
    <ClientLayout>
      <div className="mb-2">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-1">
          {t('activeCount', { count: activeSubs.length })}
        </p>
      </div>

      <div className="mb-5 mt-5">
        <Tabs tabs={statusTabs} activeTab={statusFilter} onChange={setStatusFilter} />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500"><Loader2 className="w-5 h-5 animate-spin" /> {tc('loading')}</div>
      ) : filtered.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-4">
              <CreditCard className="w-7 h-7 text-slate-400" />
            </div>
            <p className="text-slate-500 font-medium mb-1">
              {statusFilter ? t('noFilteredSubscriptions', { status: ts.has((statusFilter === 'past_due' ? 'pastDue' : statusFilter) as never) ? ts((statusFilter === 'past_due' ? 'pastDue' : statusFilter) as never) : statusFilter }) : t('noSubscriptions')}
            </p>
            <p className="text-sm text-slate-400">{t('purchaseHint')}</p>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((sub, index) => {
            const days = daysUntil(sub.currentPeriodEnd)
            const progress = periodProgress(sub.currentPeriodStart, sub.currentPeriodEnd)
            const isExpiringSoon = days <= 3 && (sub.status === 'active' || sub.status === 'trialing')

            return (
              <motion.div
                key={sub.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.06, duration: 0.3 }}
              >
                <Card hover onClick={() => setSelectedSub(sub)}>
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Package className="w-5 h-5 text-violet-500 shrink-0" />
                        <h3 className="font-semibold text-slate-900 dark:text-white truncate">
                          {sub.productName || sub.productCode || t('untitled')}
                        </h3>
                      </div>
                      <div className="flex items-center gap-2 mt-1 ml-7">
                        {sub.serviceName && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 font-medium">
                            {sub.serviceDisplayName || sub.serviceName}
                          </span>
                        )}
                      </div>
                    </div>
                    <StatusBadge status={sub.cancelAtPeriodEnd && sub.status !== 'canceled' ? 'canceling' : sub.status} />
                  </div>

                  {sub.productDescription && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-3 line-clamp-2">{sub.productDescription}</p>
                  )}

                  <div className="space-y-2.5 text-sm">
                    {sub.amount && (
                      <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                        <DollarSign className="w-4 h-4 text-emerald-500 shrink-0" />
                        <span className="font-mono font-semibold">{f.price(sub.amount, sub.currency, sub.interval)}</span>
                      </div>
                    )}

                    {sub.creditsPerPeriod && (
                      <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                        <Zap className="w-4 h-4 text-amber-500 shrink-0" />
                        <span>{t('creditsPerPeriodCount', { count: f.num(sub.creditsPerPeriod) })}</span>
                      </div>
                    )}

                    {sub.productFeatures.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {sub.productFeatures.slice(0, 3).map((feat: string, fi: number) => (
                          <span key={fi} className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                            <Check className="w-3 h-3 text-[#ccff00]" />{featureLabel(feat)}
                          </span>
                        ))}
                        {sub.productFeatures.length > 3 && (
                          <span className="text-xs text-slate-400">+{sub.productFeatures.length - 3}</span>
                        )}
                      </div>
                    )}

                    <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                      <Calendar className="w-4 h-4 shrink-0" />
                      <span>{t('started', { date: f.date(sub.currentPeriodStart) })}</span>
                    </div>

                    <div className={`flex items-center gap-2 ${isExpiringSoon ? 'text-orange-500' : 'text-slate-500 dark:text-slate-400'}`}>
                      <Clock className="w-4 h-4 shrink-0" />
                      <span>
                        {sub.cancelAtPeriodEnd ? t('cancels', { date: f.date(sub.currentPeriodEnd) }) : t('renews', { date: f.date(sub.currentPeriodEnd) })}
                        {' '}({t('daysLeft', { count: days })})
                      </span>
                    </div>

                    {(sub.status === 'active' || sub.status === 'trialing') && (
                      <div className="pt-1">
                        <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${isExpiringSoon ? 'bg-orange-500' : 'progress-bar'}`}
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {sub.trialDays && sub.status === 'trialing' && (
                      <div className="flex items-center gap-2 text-blue-500">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>{t('trialPeriod', { days: sub.trialDays })}</span>
                      </div>
                    )}
                  </div>

                  {sub.cancelAtPeriodEnd && (
                    <div className="mt-3 p-2.5 bg-orange-50 dark:bg-orange-900/10 border border-orange-200 dark:border-orange-800/50 rounded-xl">
                      <p className="text-xs text-orange-600 dark:text-orange-400">
                        {t('cancelNotice', { date: f.date(sub.currentPeriodEnd) })}
                      </p>
                    </div>
                  )}
                </Card>
              </motion.div>
            )
          })}
        </div>
      )}

      {/* Subscription Detail Modal */}
      <Modal
        isOpen={!!selectedSub}
        onClose={() => setSelectedSub(null)}
        title={t('detailTitle')}
      >
        {selectedSub && (
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h4 className="text-lg font-semibold text-slate-900 dark:text-white">
                  {selectedSub.productName || selectedSub.productCode || t('untitled')}
                </h4>
                <div className="flex items-center gap-2 mt-1">
                  {selectedSub.serviceName && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 font-medium">
                      {selectedSub.serviceDisplayName || selectedSub.serviceName}
                    </span>
                  )}
                  {selectedSub.productCode && (
                    <span className="text-xs font-mono text-slate-400">{selectedSub.productCode}</span>
                  )}
                </div>
                {selectedSub.productDescription && (
                  <p className="text-sm text-slate-500 mt-2">{selectedSub.productDescription}</p>
                )}
              </div>
              <StatusBadge status={selectedSub.cancelAtPeriodEnd && selectedSub.status !== 'canceled' ? 'canceling' : selectedSub.status} />
            </div>

            {/* What's included */}
            {(selectedSub.productFeatures.length > 0 || selectedSub.creditsPerPeriod) && (
              <div className="bg-violet-50 dark:bg-violet-900/10 border border-violet-200 dark:border-violet-800/30 rounded-xl p-4">
                <h5 className="text-xs font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-wide mb-2">
                  {t('detailIncludes')}
                </h5>
                <div className="space-y-1.5">
                  {selectedSub.creditsPerPeriod && (
                    <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                      <Zap className="w-4 h-4 text-amber-500 shrink-0" />
                      <span className="font-medium">{t('creditsPerPeriodCount', { count: f.num(selectedSub.creditsPerPeriod) })}</span>
                    </div>
                  )}
                  {selectedSub.productFeatures.map((feat: string, fi: number) => (
                    <div key={fi} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                      <Check className="w-4 h-4 text-[#ccff00] shrink-0" />
                      <span>{featureLabel(feat)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 space-y-3 text-sm">
              {selectedSub.serviceName && (
                <div className="flex justify-between">
                  <span className="text-slate-500">{t('detailService')}</span>
                  <span className="font-semibold text-slate-900 dark:text-white">{selectedSub.serviceDisplayName || selectedSub.serviceName}</span>
                </div>
              )}
              {selectedSub.productName && (
                <div className="flex justify-between">
                  <span className="text-slate-500">{t('detailProduct')}</span>
                  <span className="font-semibold text-slate-900 dark:text-white">{selectedSub.productName}</span>
                </div>
              )}
              {selectedSub.amount && (
                <div className="flex justify-between">
                  <span className="text-slate-500">{t('detailPrice')}</span>
                  <span className="font-mono font-semibold text-slate-900 dark:text-white">{f.price(selectedSub.amount, selectedSub.currency, selectedSub.interval)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500">{t('detailPeriodStart')}</span>
                <span className="text-slate-700 dark:text-slate-300">{f.date(selectedSub.currentPeriodStart)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{t('detailPeriodEnd')}</span>
                <span className="text-slate-700 dark:text-slate-300">{f.date(selectedSub.currentPeriodEnd)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{t('detailAutoRenew')}</span>
                <span className="text-slate-700 dark:text-slate-300">{selectedSub.cancelAtPeriodEnd ? t('detailAutoRenewNo') : t('detailAutoRenewYes')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{t('detailCreated')}</span>
                <span className="text-slate-700 dark:text-slate-300">{f.date(selectedSub.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{t('detailId')}</span>
                <span className="font-mono text-xs text-slate-500">{selectedSub.id}</span>
              </div>
            </div>

            {(selectedSub.status === 'active' || selectedSub.status === 'trialing') && !selectedSub.cancelAtPeriodEnd && (
              <Button variant="danger" onClick={() => handleCancel(selectedSub)} className="w-full">
                {t('cancelSubscription')}
              </Button>
            )}
            {/* Cancelled but still inside the paid period: the change of mind
                the API has always allowed and the page never offered. */}
            {selectedSub.cancelAtPeriodEnd && ['active', 'trialing', 'past_due'].includes(selectedSub.status) && (
              <Button
                onClick={() => void handleResume(selectedSub.id)}
                loading={resuming === selectedSub.id}
                icon={<RotateCcw className="h-4 w-4" />}
                className="w-full"
              >
                {t('resume')}
              </Button>
            )}
          </div>
        )}
      </Modal>

      {confirmState && (
        <ConfirmDialog
          isOpen={confirmState.isOpen}
          onClose={() => setConfirmState(null)}
          onConfirm={confirmState.onConfirm}
          title={confirmState.title}
          message={confirmState.message}
          variant={confirmState.variant}
        />
      )}
    </ClientLayout>
  )
}
