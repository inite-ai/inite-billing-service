'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table'
import { Pagination } from '@/components/ui/Pagination'
import { Tabs } from '@/components/ui/Tabs'
import { CreditCard, Eye, Search } from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import type { Subscription, PaginatedResponse } from '@/lib/types'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/ui/ErrorState'
import { CopyableId } from '@/components/ui/CopyableId'
import { ExportButton } from '@/components/ui/ExportButton'
import { IconButton } from '@/components/ui/IconButton'
import { useTableState } from '@/hooks/useTableState'
import { useNow } from '@/hooks/useNow'

export default function AdminSubscriptionsPage() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')

  const statusTabs = [
    { key: '', label: t('subscriptions.tabAll') },
    { key: 'active', label: t('subscriptions.tabActive') },
    { key: 'trialing', label: t('subscriptions.tabTrialing') },
    { key: 'past_due', label: t('subscriptions.tabPastDue') },
    { key: 'canceled', label: t('subscriptions.tabCanceled') },
  ]

  const table = useTableState({ filters: { status: '', userId: '' }, defaultSort: 'createdAt' })

  const [data, setData] = useState<PaginatedResponse<Subscription> | null>(null)
  const [searchDraft, setSearchDraft] = useState(table.filters.userId)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Subscription | null>(null)
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean
    title: string
    message: string
    record?: string
    onConfirm: () => Promise<void>
    variant?: 'danger' | 'default'
  } | null>(null)

  const params = JSON.stringify(table.queryParams)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await api.get('/v1/admin/subscriptions', {
        params: { ...JSON.parse(params), limit: 20 },
      })
      setData(res.data)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      const message = err.response?.data?.message || 'Failed to load subscriptions'
      setLoadError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [params])

  useEffect(() => { load() }, [load])
  useEffect(() => { setSearchDraft(table.filters.userId) }, [table.filters.userId])

  const handleCancel = (id: string) => {
    setConfirmState({
      isOpen: true,
      title: t('subscriptions.forceCancelConfirm'),
      message: t('subscriptions.forceCancelConfirm'),
      variant: 'danger',
      onConfirm: async () => {
        try {
          await api.post(`/v1/admin/subscriptions/${id}/cancel`)
          toast.success(t('subscriptions.canceled'))
          setSelected(null)
          load()
        } catch (e: unknown) {
          const err = e as { response?: { data?: { message?: string } } }
          toast.error(err.response?.data?.message || t('subscriptions.cancelError'))
          throw e
        }
      },
    })
  }

  const now = useNow(60 * 60 * 1000)
  const daysUntil = (date: string) => Math.max(0, Math.ceil((new Date(date).getTime() - now) / 86400000))

  return (
    <div>
      <PageHeader
        title={t('subscriptions.title')}
        actions={<ExportButton resource="subscriptions" params={table.queryParams} />}
      />

      <div className="flex flex-wrap items-center gap-4 mb-4">
        <Tabs
          tabs={statusTabs}
          activeTab={table.filters.status}
          onChange={(status) => table.setFilters({ status })}
        />
        <form
          className="flex items-center gap-2 ml-auto"
          onSubmit={(e) => { e.preventDefault(); table.setFilters({ userId: searchDraft.trim() }) }}
        >
          <div className="w-64">
            <Input
              type="search"
              aria-label={t('subscriptions.searchPlaceholder')}
              placeholder={t('subscriptions.searchPlaceholder')}
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
            />
          </div>
          <Button size="sm" variant="secondary" type="submit" icon={<Search className="w-4 h-4" />}>{tc('search')}</Button>
        </form>
      </div>

      <Card>
        {loading ? (
          <TableSkeleton />
        ) : loadError ? (
          <ErrorState message={loadError} onRetry={load} />
        ) : !data || data.items.length === 0 ? (
          <div className="text-center py-8">
            <CreditCard className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
            <p className="text-slate-500">{t('subscriptions.noSubscriptions')}</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-slate-500 mb-3">{t('subscriptions.totalSubscriptions', { count: data.total })}</p>
            <Table>
              <Thead>
                <tr>
                  <Th sortKey="userId" sort={table.sort} onSort={table.toggleSort}>{t('subscriptions.tableUser')}</Th>
                  <Th>{t('subscriptions.tableProduct')}</Th>
                  <Th>{t('subscriptions.tablePrice')}</Th>
                  <Th sortKey="status" sort={table.sort} onSort={table.toggleSort}>{t('subscriptions.tableStatus')}</Th>
                  <Th sortKey="currentPeriodEnd" sort={table.sort} onSort={table.toggleSort}>{t('subscriptions.tablePeriodEnd')}</Th>
                  {/* Days left is period end read differently — one sortable
                      header for the two of them, not two that fight. */}
                  <Th>{t('subscriptions.tableDaysLeft')}</Th>
                  <Th>{t('subscriptions.tableActions')}</Th>
                </tr>
              </Thead>
              <Tbody>
                {data.items.map((sub) => (
                  <Tr key={sub.id} className="cursor-pointer" onClick={() => setSelected(sub)}>
                    <Td className="font-mono text-xs"><CopyableId value={sub.userId} /></Td>
                    <Td>{sub.productName || sub.productCode || '-'}</Td>
                    <Td>{sub.amount ? `${sub.amount} ${sub.currency}/${sub.interval || 'mo'}` : '-'}</Td>
                    <Td><StatusBadge status={sub.status} /></Td>
                    <Td>{new Date(sub.currentPeriodEnd).toLocaleDateString()}</Td>
                    <Td>{daysUntil(sub.currentPeriodEnd)}d</Td>
                    <Td>
                      {/* A `tr` click is unreachable from a keyboard; this is
                          the same detail, on a real control. */}
                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <IconButton
                          label={t('subscriptions.detailTitle')}
                          icon={<Eye className="w-4 h-4" />}
                          tone="primary"
                          onClick={() => setSelected(sub)}
                        />
                        {(sub.status === 'active' || sub.status === 'trialing') && (
                          <Button size="sm" variant="danger" onClick={() => handleCancel(sub.id)}>{tc('cancel')}</Button>
                        )}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
            <Pagination page={data.page} pages={data.pages} onPageChange={table.setPage} />
          </>
        )}
      </Card>

      <Modal isOpen={!!selected} onClose={() => setSelected(null)} title={t('subscriptions.detailTitle')}>
        {selected && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <StatusBadge status={selected.status} />
              {selected.cancelAtPeriodEnd && <Badge variant="warning">{tc('status.canceling')}</Badge>}
            </div>

            <div className="bg-slate-50 dark:bg-slate-900 rounded-xl p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">{t('subscriptions.detailSubscriptionId')}</span><span className="font-mono text-xs">{selected.id}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">{t('subscriptions.detailUserId')}</span><span className="font-mono text-xs">{selected.userId}</span></div>
              {selected.serviceName && <div className="flex justify-between"><span className="text-slate-500">{t('subscriptions.detailService') || 'Service'}</span><span className="font-semibold">{selected.serviceName}</span></div>}
              {selected.productName && <div className="flex justify-between"><span className="text-slate-500">{t('subscriptions.detailProduct')}</span><span className="font-semibold">{selected.productName}</span></div>}
              {selected.amount && (
                <div className="flex justify-between">
                  <span className="text-slate-500">{t('subscriptions.detailPrice')}</span>
                  <span className="font-semibold">{selected.amount} {selected.currency}/{selected.interval || 'month'}</span>
                </div>
              )}
              <div className="flex justify-between"><span className="text-slate-500">{t('subscriptions.detailPeriodStart')}</span><span>{new Date(selected.currentPeriodStart).toLocaleDateString()}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">{t('subscriptions.detailPeriodEnd')}</span><span>{new Date(selected.currentPeriodEnd).toLocaleDateString()} ({t('subscriptions.detailDaysLeft', { count: daysUntil(selected.currentPeriodEnd) })})</span></div>
              <div className="flex justify-between"><span className="text-slate-500">{t('subscriptions.detailAutoRenew')}</span><span>{selected.cancelAtPeriodEnd ? tc('no') : tc('yes')}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">{t('subscriptions.detailCreated')}</span><span>{new Date(selected.createdAt).toLocaleString()}</span></div>
            </div>

            {(selected.status === 'active' || selected.status === 'trialing') && !selected.cancelAtPeriodEnd && (
              <Button variant="danger" onClick={() => handleCancel(selected.id)} className="w-full">{t('subscriptions.forceCancel')}</Button>
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
          record={confirmState.record}
          variant={confirmState.variant}
        />
      )}
    </div>
  )
}
