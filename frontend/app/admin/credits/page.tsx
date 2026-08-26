'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import { Search, Loader2, Coins, ChevronDown, ChevronRight } from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import type { CreditBalance, CreditUsage, Service } from '@/lib/types'
import { ErrorState } from '@/components/ui/ErrorState'
import { TableSkeleton } from '@/components/ui/Skeleton'

type UsageBadgeType = CreditUsage['type']

const usageBadgeVariant: Record<UsageBadgeType, 'success' | 'error' | 'info' | 'warning' | 'default'> = {
  grant: 'success',
  consume: 'error',
  reset: 'info',
  refund: 'warning',
  admin_adjust: 'default',
}

export default function AdminCreditsPage() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')

  const [balances, setBalances] = useState<CreditBalance[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [userSearch, setUserSearch] = useState('')
  const [serviceFilter, setServiceFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Expanded row state
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [usageHistory, setUsageHistory] = useState<CreditUsage[]>([])
  const [usageLoading, setUsageLoading] = useState(false)

  // Adjust modal state
  const [adjustTarget, setAdjustTarget] = useState<CreditBalance | null>(null)
  const [adjustAmount, setAdjustAmount] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const [adjustSubmitting, setAdjustSubmitting] = useState(false)

  const loadBalances = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const params: Record<string, string> = {}
      if (userSearch.trim()) params.userId = userSearch.trim()
      if (serviceFilter) params.serviceId = serviceFilter
      const res = await api.get('/v1/admin/credits', { params })
      setBalances(Array.isArray(res.data) ? res.data : res.data.items || [])
    } catch (e: unknown) {
      // Was `setBalances([])`: an outage rendered as an authoritative empty
      // ledger, which is a different and worse claim than "this failed".
      const err = e as { response?: { data?: { message?: string } } }
      setLoadError(err.response?.data?.message || tc('loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [userSearch, serviceFilter])

  const loadServices = async () => {
    try {
      const res = await api.get('/v1/admin/services', { params: { limit: 100 } })
      setServices(res.data.items || res.data || [])
    } catch {
      setServices([])
    }
  }

  useEffect(() => {
    loadServices()
    loadBalances()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadBalances()
  }, [serviceFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = () => {
    loadBalances()
  }

  const toggleExpand = async (balance: CreditBalance) => {
    if (expandedId === balance.id) {
      setExpandedId(null)
      setUsageHistory([])
      return
    }
    setExpandedId(balance.id)
    setUsageLoading(true)
    try {
      const params: Record<string, string> = {}
      if (balance.serviceId) params.serviceId = balance.serviceId
      const res = await api.get(`/v1/admin/credits/${balance.userId}/usage`, { params })
      setUsageHistory(Array.isArray(res.data) ? res.data : res.data.items || [])
    } catch {
      setUsageHistory([])
    } finally {
      setUsageLoading(false)
    }
  }

  const handleAdjust = async () => {
    if (!adjustTarget || !adjustAmount) return
    setAdjustSubmitting(true)
    try {
      await api.post('/v1/admin/credits/adjust', {
        userId: adjustTarget.userId,
        serviceId: adjustTarget.serviceId,
        amount: Number(adjustAmount),
        // The API records this on the CreditUsage ledger row as `description`;
        // posting it as `reason` meant every manual adjustment stored nothing.
        description: adjustReason || undefined,
      })
      toast.success(t('credits.adjustSuccess'))
      setAdjustTarget(null)
      setAdjustAmount('')
      setAdjustReason('')
      loadBalances()
    } catch {
      toast.error(t('credits.adjustError'))
    } finally {
      setAdjustSubmitting(false)
    }
  }

  const usageTypeLabel = (type: UsageBadgeType) => {
    const map: Record<UsageBadgeType, string> = {
      grant: t('credits.typeGrant'),
      consume: t('credits.typeConsume'),
      reset: t('credits.typeReset'),
      refund: t('credits.typeRefund'),
      admin_adjust: t('credits.typeAdjust'),
    }
    return map[type] || type
  }

  const serviceOptions = [
    { value: '', label: t('credits.allServices') },
    ...services.map((s) => ({ value: s.id, label: s.name })),
  ]

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('credits.title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('credits.subtitle')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-4 mb-4">
        <div className="w-48">
          <Select
            options={serviceOptions}
            value={serviceFilter}
            onChange={(e) => setServiceFilter(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <div className="w-64">
            <Input
              placeholder={t('credits.searchUser')}
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <Button size="sm" variant="secondary" onClick={handleSearch} icon={<Search className="w-4 h-4" />}>
            {tc('search')}
          </Button>
        </div>
      </div>

      <Card>
        {loading ? (
          <TableSkeleton />
        ) : loadError ? (
          <ErrorState message={loadError} onRetry={loadBalances} />
        ) : balances.length === 0 ? (
          <div className="text-center py-8">
            <Coins className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
            <p className="text-slate-500">{t('credits.noBalances')}</p>
          </div>
        ) : (
          <Table>
            <Thead>
              <tr>
                <Th>{' '}</Th>
                <Th>{t('credits.userId')}</Th>
                <Th>{t('credits.service')}</Th>
                <Th>{t('credits.balance')}</Th>
                <Th>{t('credits.totalGranted')}</Th>
                <Th>{t('credits.totalUsed')}</Th>
                <Th>{t('credits.resetsAt')}</Th>
                <Th>{tc('actions')}</Th>
              </tr>
            </Thead>
            <Tbody>
              {balances.map((bal) => (
                <>
                  <tr
                    key={bal.id}
                    className="table-row-hover cursor-pointer"
                    onClick={() => toggleExpand(bal)}
                  >
                    <Td>
                      {expandedId === bal.id ? (
                        <ChevronDown className="w-4 h-4 text-slate-400" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-slate-400" />
                      )}
                    </Td>
                    <Td className="font-mono text-xs">{bal.userId.slice(0, 8)}...</Td>
                    <Td>{bal.service?.name || bal.serviceId || <span className="text-slate-400">{tc('na')}</span>}</Td>
                    <Td className="font-semibold">{bal.balance}</Td>
                    <Td>{bal.totalGranted}</Td>
                    <Td>{bal.totalUsed}</Td>
                    <Td>
                      {bal.resetsAt
                        ? new Date(bal.resetsAt).toLocaleDateString()
                        : <span className="text-slate-400">{tc('na')}</span>}
                    </Td>
                    <Td>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={(e) => {
                          e.stopPropagation()
                          setAdjustTarget(bal)
                        }}
                      >
                        {t('credits.adjust')}
                      </Button>
                    </Td>
                  </tr>
                  {expandedId === bal.id && (
                    <tr key={`${bal.id}-usage`}>
                      <td colSpan={8} className="px-4 py-3.5 text-sm text-slate-700 dark:text-slate-300">
                        <div className="py-2 px-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                          <h4 className="font-semibold text-sm text-slate-700 dark:text-slate-300 mb-3">
                            {t('credits.usageHistory')}
                          </h4>
                          {usageLoading ? (
                            <div className="flex items-center gap-2 text-slate-500 py-2">
                              <Loader2 className="w-4 h-4 animate-spin" /> {tc('loading')}
                            </div>
                          ) : usageHistory.length === 0 ? (
                            <p className="text-sm text-slate-500 py-2">{tc('noData')}</p>
                          ) : (
                            <Table>
                              <Thead>
                                <tr>
                                  <Th>{t('credits.type')}</Th>
                                  <Th>{t('credits.amount')}</Th>
                                  <Th>{t('credits.description')}</Th>
                                  <Th>{t('credits.date')}</Th>
                                </tr>
                              </Thead>
                              <Tbody>
                                {usageHistory.map((u) => (
                                  <tr key={u.id}>
                                    <Td>
                                      <Badge variant={usageBadgeVariant[u.type]}>
                                        {usageTypeLabel(u.type)}
                                      </Badge>
                                    </Td>
                                    <Td className="font-semibold">
                                      {u.type === 'consume' ? '-' : '+'}{Math.abs(u.amount)}
                                    </Td>
                                    <Td>{u.description || <span className="text-slate-400">{tc('na')}</span>}</Td>
                                    <Td>{new Date(u.createdAt).toLocaleString()}</Td>
                                  </tr>
                                ))}
                              </Tbody>
                            </Table>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </Tbody>
          </Table>
        )}
      </Card>

      <Modal
        isOpen={!!adjustTarget}
        onClose={() => {
          setAdjustTarget(null)
          setAdjustAmount('')
          setAdjustReason('')
        }}
        title={t('credits.adjust')}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1.5">
              {t('credits.adjustAmount')}
            </label>
            <Input
              type="number"
              value={adjustAmount}
              onChange={(e) => setAdjustAmount(e.target.value)}
              placeholder="e.g. 100 or -50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1.5">
              {t('credits.adjustReason')}
            </label>
            <textarea
              className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all"
              rows={3}
              value={adjustReason}
              onChange={(e) => setAdjustReason(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setAdjustTarget(null)
                setAdjustAmount('')
                setAdjustReason('')
              }}
            >
              {tc('cancel')}
            </Button>
            <Button
              onClick={handleAdjust}
              disabled={!adjustAmount || adjustSubmitting}
            >
              {adjustSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : tc('confirm')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
