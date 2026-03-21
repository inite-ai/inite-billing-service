'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Header } from '@/components/layout/Header'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Tabs } from '@/components/ui/Tabs'
import { useAuth } from '@/contexts/AuthContext'
import { CreditCard, Calendar, Clock, DollarSign, AlertTriangle, Loader2 } from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import type { Subscription } from '@/lib/types'

export default function SubscriptionsPage() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const t = useTranslations('subscriptions')
  const tc = useTranslations('common')

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

  useEffect(() => {
    if (authLoading) return
    if (!user) { router.push('/login'); return }

    async function load() {
      try {
        const res = await api.get('/v1/subscriptions')
        setSubscriptions(res.data)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [user, authLoading, router])

  if (authLoading || !user) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-violet-500" /></div>
  }

  const handleCancel = async (id: string) => {
    if (!confirm(t('confirmCancel'))) return
    try {
      await api.post(`/v1/subscriptions/${id}/cancel`)
      setSubscriptions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, status: 'canceled' as const, cancelAtPeriodEnd: true } : s))
      )
      setSelectedSub(null)
      toast.success(t('cancelSuccess'))
    } catch {
      toast.error(t('cancelError'))
    }
  }

  const filtered = statusFilter
    ? subscriptions.filter((s) => s.status === statusFilter)
    : subscriptions

  const activeSubs = subscriptions.filter((s) => s.status === 'active' || s.status === 'trialing')

  const daysUntil = (date: string) => {
    const diff = new Date(date).getTime() - Date.now()
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
  }

  return (
    <div className="min-h-screen">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{t('title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          {t('activeCount', { count: activeSubs.length })}
        </p>

        <div className="mb-4">
          <Tabs tabs={statusTabs} activeTab={statusFilter} onChange={setStatusFilter} />
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-gray-500"><Loader2 className="w-5 h-5 animate-spin" /> {tc('loading')}</div>
        ) : filtered.length === 0 ? (
          <Card>
            <div className="text-center py-8">
              <CreditCard className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <p className="text-gray-500 dark:text-gray-400 mb-1">
                {statusFilter ? t('noFilteredSubscriptions', { status: statusFilter }) : t('noSubscriptions')}
              </p>
              <p className="text-sm text-gray-400 dark:text-gray-500">{t('purchaseHint')}</p>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filtered.map((sub) => {
              const days = daysUntil(sub.currentPeriodEnd)
              const isExpiringSoon = days <= 3 && (sub.status === 'active' || sub.status === 'trialing')

              return (
                <Card key={sub.id} className="cursor-pointer hover:shadow-xl transition-shadow" onClick={() => setSelectedSub(sub)}>
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-white text-lg">
                        {sub.price?.product?.name || 'Subscription'}
                      </h3>
                      {sub.price?.product?.code && (
                        <p className="text-xs text-gray-400 font-mono">{sub.price.product.code}</p>
                      )}
                    </div>
                    <Badge>{sub.status}</Badge>
                  </div>

                  <div className="space-y-2 text-sm">
                    {sub.price && (
                      <div className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
                        <DollarSign className="w-4 h-4 text-green-500" />
                        <span className="font-semibold">{sub.price.amount} {sub.price.currency}</span>
                        <span className="text-gray-400">/ {sub.price.interval || 'month'}</span>
                      </div>
                    )}

                    <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                      <Calendar className="w-4 h-4" />
                      <span>{t('started', { date: new Date(sub.currentPeriodStart).toLocaleDateString() })}</span>
                    </div>

                    <div className={`flex items-center gap-2 ${isExpiringSoon ? 'text-orange-500' : 'text-gray-500 dark:text-gray-400'}`}>
                      <Clock className="w-4 h-4" />
                      <span>
                        {sub.cancelAtPeriodEnd ? t('cancels', { date: new Date(sub.currentPeriodEnd).toLocaleDateString() }) : t('renews', { date: new Date(sub.currentPeriodEnd).toLocaleDateString() })}
                        {' '}({t('daysLeft', { count: days })})
                      </span>
                    </div>

                    {sub.price?.trialDays && sub.status === 'trialing' && (
                      <div className="flex items-center gap-2 text-blue-500">
                        <AlertTriangle className="w-4 h-4" />
                        <span>{t('trialPeriod', { days: sub.price.trialDays })}</span>
                      </div>
                    )}
                  </div>

                  {sub.cancelAtPeriodEnd && (
                    <div className="mt-3 p-2 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg">
                      <p className="text-xs text-orange-700 dark:text-orange-400">
                        {t('cancelNotice', { date: new Date(sub.currentPeriodEnd).toLocaleDateString() })}
                      </p>
                    </div>
                  )}
                </Card>
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
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-gray-900 dark:text-white">
                  {selectedSub.price?.product?.name || 'Subscription'}
                </h4>
                <Badge>{selectedSub.status}</Badge>
              </div>

              <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-4 space-y-3 text-sm">
                {selectedSub.price && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">{t('detailPrice')}</span>
                    <span className="font-semibold">{selectedSub.price.amount} {selectedSub.price.currency}/{selectedSub.price.interval || 'month'}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-500">{t('detailPeriodStart')}</span>
                  <span>{new Date(selectedSub.currentPeriodStart).toLocaleDateString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">{t('detailPeriodEnd')}</span>
                  <span>{new Date(selectedSub.currentPeriodEnd).toLocaleDateString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">{t('detailAutoRenew')}</span>
                  <span>{selectedSub.cancelAtPeriodEnd ? t('detailAutoRenewNo') : t('detailAutoRenewYes')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">{t('detailCreated')}</span>
                  <span>{new Date(selectedSub.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">{t('detailId')}</span>
                  <span className="font-mono text-xs">{selectedSub.id}</span>
                </div>
              </div>

              {(selectedSub.status === 'active' || selectedSub.status === 'trialing') && !selectedSub.cancelAtPeriodEnd && (
                <Button variant="danger" onClick={() => handleCancel(selectedSub.id)} className="w-full">
                  {t('cancelSubscription')}
                </Button>
              )}
            </div>
          )}
        </Modal>
      </main>
    </div>
  )
}
