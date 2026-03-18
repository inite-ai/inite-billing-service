'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
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

const statusTabs = [
  { key: '', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'trialing', label: 'Trial' },
  { key: 'past_due', label: 'Past Due' },
  { key: 'canceled', label: 'Canceled' },
]

export default function SubscriptionsPage() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
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
    if (!confirm('Are you sure you want to cancel this subscription? It will remain active until the end of the current billing period.')) return
    try {
      await api.post(`/v1/subscriptions/${id}/cancel`)
      setSubscriptions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, status: 'canceled' as const, cancelAtPeriodEnd: true } : s))
      )
      setSelectedSub(null)
      toast.success('Subscription will cancel at period end')
    } catch {
      toast.error('Failed to cancel subscription')
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
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">My Subscriptions</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          {activeSubs.length} active subscription{activeSubs.length !== 1 ? 's' : ''}
        </p>

        <div className="mb-4">
          <Tabs tabs={statusTabs} activeTab={statusFilter} onChange={setStatusFilter} />
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-gray-500"><Loader2 className="w-5 h-5 animate-spin" /> Loading...</div>
        ) : filtered.length === 0 ? (
          <Card>
            <div className="text-center py-8">
              <CreditCard className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <p className="text-gray-500 dark:text-gray-400 mb-1">
                {statusFilter ? `No ${statusFilter} subscriptions` : 'No subscriptions yet'}
              </p>
              <p className="text-sm text-gray-400 dark:text-gray-500">Purchase a subscription from the catalog to get started</p>
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
                      <span>Started {new Date(sub.currentPeriodStart).toLocaleDateString()}</span>
                    </div>

                    <div className={`flex items-center gap-2 ${isExpiringSoon ? 'text-orange-500' : 'text-gray-500 dark:text-gray-400'}`}>
                      <Clock className="w-4 h-4" />
                      <span>
                        {sub.cancelAtPeriodEnd ? 'Cancels' : 'Renews'} {new Date(sub.currentPeriodEnd).toLocaleDateString()}
                        {' '}({days} day{days !== 1 ? 's' : ''})
                      </span>
                    </div>

                    {sub.price?.trialDays && sub.status === 'trialing' && (
                      <div className="flex items-center gap-2 text-blue-500">
                        <AlertTriangle className="w-4 h-4" />
                        <span>Trial period ({sub.price.trialDays} days)</span>
                      </div>
                    )}
                  </div>

                  {sub.cancelAtPeriodEnd && (
                    <div className="mt-3 p-2 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg">
                      <p className="text-xs text-orange-700 dark:text-orange-400">
                        This subscription will not renew. Access continues until {new Date(sub.currentPeriodEnd).toLocaleDateString()}.
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
          title="Subscription Details"
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
                    <span className="text-gray-500">Price</span>
                    <span className="font-semibold">{selectedSub.price.amount} {selectedSub.price.currency}/{selectedSub.price.interval || 'month'}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-500">Period Start</span>
                  <span>{new Date(selectedSub.currentPeriodStart).toLocaleDateString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Period End</span>
                  <span>{new Date(selectedSub.currentPeriodEnd).toLocaleDateString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Auto-Renew</span>
                  <span>{selectedSub.cancelAtPeriodEnd ? 'No (canceling)' : 'Yes'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Created</span>
                  <span>{new Date(selectedSub.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">ID</span>
                  <span className="font-mono text-xs">{selectedSub.id}</span>
                </div>
              </div>

              {(selectedSub.status === 'active' || selectedSub.status === 'trialing') && !selectedSub.cancelAtPeriodEnd && (
                <Button variant="danger" onClick={() => handleCancel(selectedSub.id)} className="w-full">
                  Cancel Subscription
                </Button>
              )}
            </div>
          )}
        </Modal>
      </main>
    </div>
  )
}
