'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { motion } from 'framer-motion'
import { ClientLayout } from '@/components/layout/ClientLayout'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ReferralTree } from '@/components/referrals/ReferralTree'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import { Tabs } from '@/components/ui/Tabs'
import { Select } from '@/components/ui/Select'
import { useAuth } from '@/contexts/AuthContext'
import {
  Copy, Check, Users, DollarSign, Clock, Wallet, TrendingUp,
  GitBranch, Loader2, Link as LinkIcon, BarChart3,
} from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import { getErrorMessage } from '@/lib/api-error'
import type {
  Affiliate, AffiliateStats, AffiliateTreeNode,
  Referral, Commission, Payout, Service,
} from '@/lib/types'

export default function ReferralsPage() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const t = useTranslations('referrals')
  const tc = useTranslations('common')

  const tabs = [
    { key: 'overview', label: t('tabOverview') },
    { key: 'referrals', label: t('tabReferrals') },
    { key: 'commissions', label: t('tabCommissions') },
    { key: 'payouts', label: t('tabPayouts') },
    { key: 'tree', label: t('tabTree') },
  ]
  const [activeTab, setActiveTab] = useState('overview')
  const [affiliate, setAffiliate] = useState<Affiliate | null>(null)
  const [stats, setStats] = useState<AffiliateStats | null>(null)
  const [referrals, setReferrals] = useState<Referral[]>([])
  const [commissions, setCommissions] = useState<Commission[]>([])
  const [payouts, setPayouts] = useState<Payout[]>([])
  const [tree, setTree] = useState<AffiliateTreeNode | null>(null)
  const [services, setServices] = useState<Service[]>([])
  const [selectedService, setSelectedService] = useState('')
  const [balance, setBalance] = useState<{ available: string; canWithdraw: boolean; minWithdrawalAmount: string; totalEarned: string; totalPaid: string } | null>(null)
  const [withdrawing, setWithdrawing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (authLoading) return
    if (!user) { router.push('/login'); return }

    async function load() {
      try {
        const svcRes = await api.get('/v1/admin/services').catch(() => ({ data: [] }))
        setServices(svcRes.data)
      } catch {}

      const params: Record<string, string> = {}
      if (selectedService) params.serviceId = selectedService

      try {
        const affRes = await api.get('/v1/affiliates/me', { params })
        setAffiliate(affRes.data)

        const [statsRes, refsRes, comsRes, payRes, treeRes, balRes] = await Promise.all([
          api.get('/v1/affiliates/me/stats', { params }),
          api.get('/v1/affiliates/me/referrals', { params }),
          api.get('/v1/affiliates/me/commissions', { params }),
          api.get('/v1/affiliates/me/payouts', { params }),
          api.get('/v1/affiliates/me/tree', { params }).catch(() => ({ data: null })),
          api.get('/v1/affiliates/me/balance', { params }).catch(() => ({ data: null })),
        ])
        setStats(statsRes.data)
        setReferrals(refsRes.data)
        setCommissions(comsRes.data)
        setPayouts(payRes.data)
        setTree(treeRes.data)
        setBalance(balRes.data)
      } catch {
        // User may not have an affiliate account
      } finally {
        setLoading(false)
      }
    }
    setLoading(true)
    load()
  }, [selectedService, user, authLoading, router])

  const handleCreateAffiliate = async () => {
    try {
      const params: Record<string, string> = {}
      if (selectedService) params.serviceId = selectedService
      const res = await api.post('/v1/affiliates', {}, { params })
      setAffiliate(res.data)
      toast.success(t('affiliateCreated'))
    } catch {
      toast.error(t('affiliateCreateError'))
    }
  }

  const handleWithdraw = async () => {
    if (!balance?.canWithdraw) return
    setWithdrawing(true)
    try {
      await api.post('/v1/affiliates/me/withdraw', {
        currency: 'USD',
      })
      toast.success(t('withdrawalRequested'))
      // Reload balance
      const balRes = await api.get('/v1/affiliates/me/balance').catch(() => ({ data: null }))
      setBalance(balRes.data)
      const payRes = await api.get('/v1/affiliates/me/payouts')
      setPayouts(payRes.data)
    } catch (e) {
      toast.error(getErrorMessage(e, t('withdrawalError')))
    } finally {
      setWithdrawing(false)
    }
  }

  const handleCopyCode = () => {
    if (affiliate?.referralUrl) {
      navigator.clipboard.writeText(affiliate.referralUrl)
      setCopied(true)
      toast.success(tc('toast.linkCopied'))
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const commissionsByLevel = useMemo(() => {
    const map = new Map<number, { count: number; total: number; rate: number }>()
    for (const c of commissions) {
      const existing = map.get(c.level) || { count: 0, total: 0, rate: 0 }
      existing.count++
      existing.total += Number(c.amount)
      existing.rate = Number(c.commissionRate)
      map.set(c.level, existing)
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0])
  }, [commissions])

  const totalCommissionAmount = commissions.reduce((s, c) => s + Number(c.amount), 0)
  const earnedCount = commissions.filter((c) => c.status === 'earned' || c.status === 'paid').length

  if (authLoading || !user) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-violet-500" /></div>
  }

  const statGradients = ['stat-gradient-violet', 'stat-gradient-green', 'stat-gradient-amber', 'stat-gradient-blue', 'stat-gradient-emerald']

  return (
    <ClientLayout>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">{t('title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
        </div>
        {services.length > 0 && (
          <div className="w-48">
            <Select
              value={selectedService}
              onChange={(e) => setSelectedService(e.target.value)}
              options={[
                { value: '', label: t('allServices') },
                ...services.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500"><Loader2 className="w-5 h-5 animate-spin" /> {tc('loading')}</div>
      ) : !affiliate ? (
        <Card>
          <div className="text-center py-16">
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-violet-100 to-purple-100 dark:from-violet-900/20 dark:to-purple-900/20 flex items-center justify-center mx-auto mb-5">
              <GitBranch className="w-9 h-9 text-violet-500" />
            </div>
            <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">{t('joinTitle')}</h3>
            <p className="text-slate-500 mb-6 max-w-sm mx-auto text-sm">
              {t('joinDescription')}
            </p>
            <Button onClick={handleCreateAffiliate} size="lg">{t('createAffiliate')}</Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Referral Link */}
          <Card>
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <LinkIcon className="w-4 h-4 text-violet-500 shrink-0" />
                  <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">{t('yourReferralLink')}</p>
                </div>
                <p className="text-sm font-mono text-slate-700 dark:text-slate-200 break-all bg-slate-50 dark:bg-slate-800/50 rounded-lg px-3 py-2 border border-slate-100 dark:border-slate-800">
                  {affiliate.referralUrl}
                </p>
                <p className="text-xs text-slate-400 mt-1.5">{t('code', { code: affiliate.referralCode })}</p>
              </div>
              <Button size="sm" variant="secondary" onClick={handleCopyCode} icon={copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}>
                {copied ? tc('copied') : tc('copyLink')}
              </Button>
            </div>
          </Card>

          {/* Balance & Withdrawal */}
          {balance && (
            <Card className={balance.canWithdraw ? 'border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/50 dark:bg-emerald-900/10' : ''}>
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-4">
                  <div className="p-2.5 rounded-xl bg-emerald-100 dark:bg-emerald-900/30">
                    <Wallet className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 uppercase tracking-wide">{t('availableBalance')}</p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white">${Number(balance.available).toFixed(2)}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {t('minWithdrawal', { amount: Number(balance.minWithdrawalAmount).toFixed(0) })}
                    </p>
                  </div>
                </div>
                <Button
                  onClick={handleWithdraw}
                  disabled={!balance.canWithdraw || withdrawing}
                  loading={withdrawing}
                  icon={<DollarSign className="w-4 h-4" />}
                >
                  {t('requestWithdrawal')}
                </Button>
              </div>
            </Card>
          )}

          <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                {[
                  { label: t('statTotalReferrals'), value: stats?.totalReferrals || 0, icon: Users, color: 'text-violet-500' },
                  { label: t('statTotalEarned'), value: `$${stats?.totalCommissions || '0'}`, icon: DollarSign, color: 'text-emerald-500' },
                  { label: t('statPending'), value: `$${stats?.pendingCommissions || '0'}`, icon: Clock, color: 'text-amber-500' },
                  { label: t('statPaidOut'), value: `$${stats?.paidCommissions || '0'}`, icon: Wallet, color: 'text-blue-500' },
                  { label: t('statCommissions'), value: earnedCount, icon: TrendingUp, color: 'text-emerald-500' },
                ].map((item, i) => {
                  const Icon = item.icon
                  return (
                    <motion.div
                      key={item.label}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.06, duration: 0.3 }}
                      className={`rounded-2xl border p-4 ${statGradients[i]}`}
                    >
                      <div className={`p-1.5 rounded-lg ${item.color} bg-white/80 dark:bg-slate-900/50 w-fit mb-2`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <p className="text-xl font-bold text-slate-900 dark:text-white">{item.value}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{item.label}</p>
                    </motion.div>
                  )
                })}
              </div>

              {commissionsByLevel.length > 0 && (
                <Card>
                  <div className="flex items-center gap-2 mb-4">
                    <BarChart3 className="w-5 h-5 text-violet-500" />
                    <h3 className="font-semibold text-slate-900 dark:text-white">{t('earningsByLevel')}</h3>
                  </div>
                  <Table>
                    <Thead>
                      <tr><Th>{t('tableLevel')}</Th><Th>{t('tableRate')}</Th><Th>{t('tableCommissions')}</Th><Th>{t('tableTotalEarned')}</Th></tr>
                    </Thead>
                    <Tbody>
                      {commissionsByLevel.map(([level, data]) => (
                        <tr key={level} className="table-row-hover">
                          <Td>
                            <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-300 text-sm font-semibold">
                              {level}
                            </span>
                          </Td>
                          <Td>{(data.rate * 100).toFixed(1)}%</Td>
                          <Td>{data.count}</Td>
                          <Td className="font-semibold">${data.total.toFixed(2)}</Td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-slate-200 dark:border-slate-700">
                        <Td className="font-bold text-slate-900 dark:text-white">{tc('total')}</Td>
                        <Td>{' '}</Td>
                        <Td className="font-bold">{commissions.length}</Td>
                        <Td className="font-bold text-emerald-600 dark:text-emerald-400">${totalCommissionAmount.toFixed(2)}</Td>
                      </tr>
                    </Tbody>
                  </Table>
                </Card>
              )}

              {stats?.upcomingPayout && (
                <Card variant="info">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-blue-100 dark:bg-blue-900/30">
                      <Wallet className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-slate-900 dark:text-white text-sm">{t('upcomingPayout')}</p>
                      <p className="text-xs text-slate-500">
                        ${stats.upcomingPayout.totalAmount} {stats.upcomingPayout.currency} -
                        {t('payoutPeriod', { start: new Date(stats.upcomingPayout.periodStart).toLocaleDateString(), end: new Date(stats.upcomingPayout.periodEnd).toLocaleDateString() })}
                      </p>
                    </div>
                    <Badge>{stats.upcomingPayout.status}</Badge>
                  </div>
                </Card>
              )}
            </div>
          )}

          {/* Referrals Tab */}
          {activeTab === 'referrals' && (
            <Card>
              <h3 className="font-semibold text-slate-900 dark:text-white mb-4">
                {t('yourReferrals', { count: referrals.length })}
              </h3>
              {referrals.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-3">
                    <Users className="w-6 h-6 text-slate-400" />
                  </div>
                  <p className="text-slate-500 text-sm">{t('noReferrals')}</p>
                </div>
              ) : (
                <Table>
                  <Thead>
                    <tr><Th>{t('tableDate')}</Th><Th>{t('tableReferredUser')}</Th><Th>{t('tableFirstOrder')}</Th><Th>{t('tableStatus')}</Th></tr>
                  </Thead>
                  <Tbody>
                    {referrals.map((ref) => (
                      <tr key={ref.id} className="table-row-hover">
                        <Td>{new Date(ref.createdAt).toLocaleDateString()}</Td>
                        <Td className="font-mono text-xs">{ref.referredUserId.slice(0, 12)}...</Td>
                        <Td>{ref.firstOrderId ? <span className="font-mono text-xs">{ref.firstOrderId.slice(0, 8)}...</span> : '-'}</Td>
                        <Td><Badge>{ref.firstOrderPaid ? tc('status.converted') : tc('status.pending')}</Badge></Td>
                      </tr>
                    ))}
                  </Tbody>
                </Table>
              )}
            </Card>
          )}

          {/* Commissions Tab */}
          {activeTab === 'commissions' && (
            <Card>
              <h3 className="font-semibold text-slate-900 dark:text-white mb-4">
                {t('commissionHistory', { count: commissions.length })}
              </h3>
              {commissions.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-3">
                    <DollarSign className="w-6 h-6 text-slate-400" />
                  </div>
                  <p className="text-slate-500 text-sm">{t('noCommissions')}</p>
                </div>
              ) : (
                <Table>
                  <Thead>
                    <tr><Th>{t('tableDate')}</Th><Th>{t('tableLevel')}</Th><Th>{t('tableAmount')}</Th><Th>{t('tableRate')}</Th><Th>{t('tableOrder')}</Th><Th>{t('tableStatus')}</Th></tr>
                  </Thead>
                  <Tbody>
                    {commissions.map((com) => (
                      <tr key={com.id} className="table-row-hover">
                        <Td>{new Date(com.createdAt).toLocaleDateString()}</Td>
                        <Td>
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-300 text-xs font-bold">
                            L{com.level}
                          </span>
                        </Td>
                        <Td className="font-semibold text-emerald-600 dark:text-emerald-400">${com.amount} {com.currency}</Td>
                        <Td>{(Number(com.commissionRate) * 100).toFixed(1)}%</Td>
                        <Td className="font-mono text-xs">{com.orderId.slice(0, 8)}...</Td>
                        <Td><Badge>{com.status}</Badge></Td>
                      </tr>
                    ))}
                  </Tbody>
                </Table>
              )}
            </Card>
          )}

          {/* Payouts Tab */}
          {activeTab === 'payouts' && (
            <Card>
              <h3 className="font-semibold text-slate-900 dark:text-white mb-4">
                {t('payoutHistory', { count: payouts.length })}
              </h3>
              {payouts.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-3">
                    <Wallet className="w-6 h-6 text-slate-400" />
                  </div>
                  <p className="text-slate-500 text-sm">{t('noPayouts')}</p>
                </div>
              ) : (
                <Table>
                  <Thead>
                    <tr><Th>{t('tablePeriod')}</Th><Th>{t('tableAmount')}</Th><Th>{t('tablePayoutDate')}</Th><Th>{t('tableStatus')}</Th></tr>
                  </Thead>
                  <Tbody>
                    {payouts.map((p) => (
                      <tr key={p.id} className="table-row-hover">
                        <Td>{new Date(p.periodStart).toLocaleDateString()} - {new Date(p.periodEnd).toLocaleDateString()}</Td>
                        <Td className="font-semibold">${p.totalAmount} {p.currency}</Td>
                        <Td>{p.payoutDate ? new Date(p.payoutDate).toLocaleDateString() : '-'}</Td>
                        <Td><Badge>{p.status}</Badge></Td>
                      </tr>
                    ))}
                  </Tbody>
                </Table>
              )}
            </Card>
          )}

          {/* Tree Tab */}
          {activeTab === 'tree' && (
            <Card>
              <div className="flex items-center gap-2 mb-4">
                <GitBranch className="w-5 h-5 text-violet-500" />
                <h3 className="font-semibold text-slate-900 dark:text-white">{t('referralTree')}</h3>
              </div>
              <p className="text-sm text-slate-500 mb-4">
                {t('treeDescription')}
              </p>
              <ReferralTree tree={tree} />
            </Card>
          )}
        </div>
      )}
    </ClientLayout>
  )
}
