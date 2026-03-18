'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Header } from '@/components/layout/Header'
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
import type {
  Affiliate, AffiliateStats, AffiliateTreeNode,
  Referral, Commission, Payout, Service,
} from '@/lib/types'

const tabs = [
  { key: 'overview', label: 'Overview' },
  { key: 'referrals', label: 'Referrals' },
  { key: 'commissions', label: 'Commissions' },
  { key: 'payouts', label: 'Payouts' },
  { key: 'tree', label: 'Tree' },
]

export default function ReferralsPage() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState('overview')
  const [affiliate, setAffiliate] = useState<Affiliate | null>(null)
  const [stats, setStats] = useState<AffiliateStats | null>(null)
  const [referrals, setReferrals] = useState<Referral[]>([])
  const [commissions, setCommissions] = useState<Commission[]>([])
  const [payouts, setPayouts] = useState<Payout[]>([])
  const [tree, setTree] = useState<AffiliateTreeNode | null>(null)
  const [services, setServices] = useState<Service[]>([])
  const [selectedService, setSelectedService] = useState('')
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

        const [statsRes, refsRes, comsRes, payRes, treeRes] = await Promise.all([
          api.get('/v1/affiliates/me/stats', { params }),
          api.get('/v1/affiliates/me/referrals', { params }),
          api.get('/v1/affiliates/me/commissions', { params }),
          api.get('/v1/affiliates/me/payouts', { params }),
          api.get('/v1/affiliates/me/tree', { params }).catch(() => ({ data: null })),
        ])
        setStats(statsRes.data)
        setReferrals(refsRes.data)
        setCommissions(comsRes.data)
        setPayouts(payRes.data)
        setTree(treeRes.data)
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
      toast.success('Affiliate account created!')
    } catch {
      toast.error('Failed to create affiliate account')
    }
  }

  const handleCopyCode = () => {
    if (affiliate?.referralUrl) {
      navigator.clipboard.writeText(affiliate.referralUrl)
      setCopied(true)
      toast.success('Referral link copied!')
      setTimeout(() => setCopied(false), 2000)
    }
  }

  // Commission breakdown by level
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

  // Total stats
  const totalCommissionAmount = commissions.reduce((s, c) => s + Number(c.amount), 0)
  const earnedCount = commissions.filter((c) => c.status === 'earned' || c.status === 'paid').length

  if (authLoading || !user) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-violet-500" /></div>
  }

  return (
    <div className="min-h-screen">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Referral Program</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Earn commissions by referring new users</p>
          </div>
          {services.length > 0 && (
            <div className="w-48">
              <Select
                value={selectedService}
                onChange={(e) => setSelectedService(e.target.value)}
                options={[
                  { value: '', label: 'All Services' },
                  ...services.map((s) => ({ value: s.id, label: s.name })),
                ]}
              />
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-gray-500"><Loader2 className="w-5 h-5 animate-spin" /> Loading...</div>
        ) : !affiliate ? (
          <Card>
            <div className="text-center py-12">
              <GitBranch className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Join the Referral Program</h3>
              <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-md mx-auto">
                Get your unique referral link and earn up to 30% commission on every sale from your referral network across 7 levels.
              </p>
              <Button onClick={handleCreateAffiliate}>Create Affiliate Account</Button>
            </div>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Referral Link */}
            <Card>
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <LinkIcon className="w-4 h-4 text-violet-500" />
                    <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Your referral link</p>
                  </div>
                  <p className="text-lg font-mono text-gray-900 dark:text-white break-all">{affiliate.referralUrl}</p>
                  <p className="text-xs text-gray-400 mt-1">Code: <span className="font-semibold">{affiliate.referralCode}</span></p>
                </div>
                <Button size="sm" variant="secondary" onClick={handleCopyCode} icon={copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}>
                  {copied ? 'Copied' : 'Copy Link'}
                </Button>
              </div>
            </Card>

            <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

            {/* Overview Tab */}
            {activeTab === 'overview' && (
              <div className="space-y-6">
                {/* Stats Grid */}
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                  {[
                    { label: 'Total Referrals', value: stats?.totalReferrals || 0, icon: Users, color: 'text-violet-500' },
                    { label: 'Total Earned', value: `$${stats?.totalCommissions || '0'}`, icon: DollarSign, color: 'text-green-500' },
                    { label: 'Pending', value: `$${stats?.pendingCommissions || '0'}`, icon: Clock, color: 'text-yellow-500' },
                    { label: 'Paid Out', value: `$${stats?.paidCommissions || '0'}`, icon: Wallet, color: 'text-blue-500' },
                    { label: 'Commissions', value: earnedCount, icon: TrendingUp, color: 'text-emerald-500' },
                  ].map((item) => {
                    const Icon = item.icon
                    return (
                      <Card key={item.label}>
                        <div className="flex items-center gap-3">
                          <Icon className={`w-6 h-6 ${item.color}`} />
                          <div>
                            <p className="text-xl font-bold text-gray-900 dark:text-white">{item.value}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">{item.label}</p>
                          </div>
                        </div>
                      </Card>
                    )
                  })}
                </div>

                {/* Commission Breakdown by Level */}
                {commissionsByLevel.length > 0 && (
                  <Card>
                    <div className="flex items-center gap-2 mb-4">
                      <BarChart3 className="w-5 h-5 text-violet-500" />
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Earnings by Level</h3>
                    </div>
                    <Table>
                      <Thead>
                        <tr><Th>Level</Th><Th>Rate</Th><Th>Commissions</Th><Th>Total Earned</Th></tr>
                      </Thead>
                      <Tbody>
                        {commissionsByLevel.map(([level, data]) => (
                          <tr key={level}>
                            <Td>
                              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-sm font-semibold">
                                {level}
                              </span>
                            </Td>
                            <Td>{(data.rate * 100).toFixed(1)}%</Td>
                            <Td>{data.count}</Td>
                            <Td className="font-semibold">${data.total.toFixed(2)}</Td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-gray-300 dark:border-gray-600">
                          <Td className="font-bold">Total</Td>
                          <Td>{' '}</Td>
                          <Td className="font-bold">{commissions.length}</Td>
                          <Td className="font-bold text-green-600 dark:text-green-400">${totalCommissionAmount.toFixed(2)}</Td>
                        </tr>
                      </Tbody>
                    </Table>
                  </Card>
                )}

                {/* Upcoming Payout */}
                {stats?.upcomingPayout && (
                  <Card variant="info">
                    <div className="flex items-center gap-3">
                      <Wallet className="w-6 h-6 text-blue-500" />
                      <div>
                        <p className="font-semibold text-gray-900 dark:text-white">Upcoming Payout</p>
                        <p className="text-sm text-gray-500">
                          ${stats.upcomingPayout.totalAmount} {stats.upcomingPayout.currency} -
                          Period: {new Date(stats.upcomingPayout.periodStart).toLocaleDateString()} - {new Date(stats.upcomingPayout.periodEnd).toLocaleDateString()}
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
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  Your Referrals ({referrals.length})
                </h3>
                {referrals.length === 0 ? (
                  <div className="text-center py-8">
                    <Users className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                    <p className="text-gray-500 text-sm">No referrals yet. Share your link to get started!</p>
                  </div>
                ) : (
                  <Table>
                    <Thead>
                      <tr><Th>Date</Th><Th>Referred User</Th><Th>First Order</Th><Th>Status</Th></tr>
                    </Thead>
                    <Tbody>
                      {referrals.map((ref) => (
                        <tr key={ref.id}>
                          <Td>{new Date(ref.createdAt).toLocaleDateString()}</Td>
                          <Td className="font-mono text-xs">{ref.referredUserId.slice(0, 12)}...</Td>
                          <Td>{ref.firstOrderId ? <span className="font-mono text-xs">{ref.firstOrderId.slice(0, 8)}...</span> : '-'}</Td>
                          <Td><Badge>{ref.firstOrderPaid ? 'Converted' : 'Pending'}</Badge></Td>
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
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  Commission History ({commissions.length})
                </h3>
                {commissions.length === 0 ? (
                  <div className="text-center py-8">
                    <DollarSign className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                    <p className="text-gray-500 text-sm">No commissions yet</p>
                  </div>
                ) : (
                  <Table>
                    <Thead>
                      <tr><Th>Date</Th><Th>Level</Th><Th>Amount</Th><Th>Rate</Th><Th>Order</Th><Th>Status</Th></tr>
                    </Thead>
                    <Tbody>
                      {commissions.map((com) => (
                        <tr key={com.id}>
                          <Td>{new Date(com.createdAt).toLocaleDateString()}</Td>
                          <Td>
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-xs font-bold">
                              L{com.level}
                            </span>
                          </Td>
                          <Td className="font-semibold text-green-600 dark:text-green-400">${com.amount} {com.currency}</Td>
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
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  Payout History ({payouts.length})
                </h3>
                {payouts.length === 0 ? (
                  <div className="text-center py-8">
                    <Wallet className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                    <p className="text-gray-500 text-sm">No payouts yet. Commissions are paid monthly (NET-15).</p>
                  </div>
                ) : (
                  <Table>
                    <Thead>
                      <tr><Th>Period</Th><Th>Amount</Th><Th>Payout Date</Th><Th>Status</Th></tr>
                    </Thead>
                    <Tbody>
                      {payouts.map((p) => (
                        <tr key={p.id}>
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
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Referral Tree</h3>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  Your downline network. Each level earns a commission when someone in the chain makes a purchase.
                </p>
                <ReferralTree tree={tree} />
              </Card>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
