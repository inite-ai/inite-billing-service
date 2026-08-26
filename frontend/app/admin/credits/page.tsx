'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table'
import { Search, Loader2, Coins, ChevronDown, ChevronRight } from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import type { CreditBalance, CreditUsage, Service } from '@/lib/types'
import { ErrorState } from '@/components/ui/ErrorState'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { CopyableId } from '@/components/ui/CopyableId'
import { PageHeader } from '@/components/ui/PageHeader'
import { Pagination } from '@/components/ui/Pagination'
import { useTableState } from '@/hooks/useTableState'

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

  const table = useTableState({ filters: { userId: '', serviceId: '' }, defaultSort: 'updatedAt' })

  const [balances, setBalances] = useState<CreditBalance[]>([])
  const [pages, setPages] = useState(1)
  const [services, setServices] = useState<Service[]>([])
  const [searchDraft, setSearchDraft] = useState(table.filters.userId)
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

  const params = JSON.stringify(table.queryParams)

  const loadBalances = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await api.get('/v1/admin/credits', { params: JSON.parse(params) })
      const payload = res.data
      setBalances(Array.isArray(payload) ? payload : payload.items || [])
      // The API returns twenty balances at a time. Without paging the page
      // showed the first twenty as though they were the entire ledger.
      setPages(Array.isArray(payload) ? 1 : payload.pages || 1)
    } catch (e: unknown) {
      // Was `setBalances([])`: an outage rendered as an authoritative empty
      // ledger, which is a different and worse claim than "this failed".
      const err = e as { response?: { data?: { message?: string } } }
      setLoadError(err.response?.data?.message || tc('loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [params, tc])

  const loadServices = async () => {
    try {
      const res = await api.get('/v1/admin/services', { params: { limit: 100 } })
      setServices(res.data.items || res.data || [])
    } catch {
      setServices([])
    }
  }

  useEffect(() => { loadServices() }, [])
  useEffect(() => { loadBalances() }, [loadBalances])
  useEffect(() => { setSearchDraft(table.filters.userId) }, [table.filters.userId])

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
      <PageHeader title={t('credits.title')} subtitle={t('credits.subtitle')} />

      <div className="flex flex-wrap items-center gap-4 mb-4">
        <div className="w-48">
          <Select
            aria-label={t('credits.allServices')}
            options={serviceOptions}
            value={table.filters.serviceId}
            onChange={(e) => table.setFilters({ serviceId: e.target.value })}
          />
        </div>
        <form
          className="flex items-center gap-2 ml-auto"
          onSubmit={(e) => { e.preventDefault(); table.setFilters({ userId: searchDraft.trim() }) }}
        >
          <div className="w-64">
            <Input
              type="search"
              aria-label={t('credits.searchUser')}
              placeholder={t('credits.searchUser')}
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
            />
          </div>
          <Button size="sm" variant="secondary" type="submit" icon={<Search className="w-4 h-4" />}>
            {tc('search')}
          </Button>
        </form>
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
          <>
          <Table>
            <Thead>
              <tr>
                <Th>{' '}</Th>
                <Th sortKey="userId" sort={table.sort} onSort={table.toggleSort}>{t('credits.userId')}</Th>
                <Th>{t('credits.service')}</Th>
                <Th sortKey="balance" sort={table.sort} onSort={table.toggleSort}>{t('credits.balance')}</Th>
                <Th>{t('credits.totalGranted')}</Th>
                <Th>{t('credits.totalUsed')}</Th>
                <Th>{t('credits.resetsAt')}</Th>
                <Th>{tc('actions')}</Th>
              </tr>
            </Thead>
            <Tbody>
              {balances.map((bal) => (
                <Fragment key={bal.id}>
                  <Tr
                    className="cursor-pointer"
                    onClick={() => toggleExpand(bal)}
                    aria-expanded={expandedId === bal.id}
                  >
                    <Td>
                      {expandedId === bal.id ? (
                        <ChevronDown className="w-4 h-4 text-slate-400" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-slate-400" />
                      )}
                    </Td>
                    <Td className="font-mono text-xs"><CopyableId value={bal.userId} /></Td>
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
                  </Tr>
                  {expandedId === bal.id && (
                    <tr>
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
                </Fragment>
              ))}
            </Tbody>
          </Table>
          <Pagination page={table.page} pages={pages} onPageChange={table.setPage} />
          </>
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
          {/* The modal used to show an amount box and nothing else: no whose
              balance, no current value, no result. A wrong row click credited a
              stranger with no way to tell afterwards. */}
          {adjustTarget && (
            <div className="rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-800">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {t('credits.tableUser')}
                </span>
                <CopyableId value={adjustTarget.userId} chars={12} />
              </div>
              <div className="mt-1.5 flex items-baseline justify-between gap-3">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {t('credits.adjustNewBalance')}
                </span>
                <span className="font-mono text-sm text-slate-900 tabular-nums dark:text-slate-100">
                  {adjustTarget.balance}
                  {adjustAmount && !Number.isNaN(Number(adjustAmount)) && (
                    <>
                      {' → '}
                      <strong
                        className={
                          Number(adjustTarget.balance) + Number(adjustAmount) < 0
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-emerald-600 dark:text-emerald-400'
                        }
                      >
                        {Number(adjustTarget.balance) + Number(adjustAmount)}
                      </strong>
                    </>
                  )}
                </span>
              </div>
            </div>
          )}
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
              disabled={!adjustAmount || !adjustReason.trim() || adjustSubmitting}
            >
              {adjustSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : tc('confirm')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
