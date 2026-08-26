'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { BulkBar } from '@/components/ui/BulkBar'
import { BulkResultDialog, type BulkResult } from '@/components/ui/BulkResult'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { ErrorState } from '@/components/ui/ErrorState'
import { ExportButton } from '@/components/ui/ExportButton'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { Tabs } from '@/components/ui/Tabs'
import { Pagination } from '@/components/ui/Pagination'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { CopyableId } from '@/components/ui/CopyableId'
import { useTableState } from '@/hooks/useTableState'
import { useSelection } from '@/hooks/useSelection'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import type { Payout, PaginatedResponse } from '@/lib/types'
import { Wallet } from 'lucide-react'

type PayoutRow = Payout & { affiliate?: { referralCode: string; userId: string } }

const errorMessage = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { message?: string } } }).response?.data?.message || fallback

export default function AdminPayoutsPage() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')

  // Filter, page and sort live in the URL: a payout run is worked over
  // several sittings, and "the pending queue by amount" has to survive a
  // refresh and be sendable to whoever picks it up next.
  const table = useTableState({ filters: { status: 'pending' }, defaultSort: 'createdAt' })

  const [data, setData] = useState<PaginatedResponse<PayoutRow> | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null)
  const [failTarget, setFailTarget] = useState<{ ids: string[]; single?: PayoutRow } | null>(null)
  const [failReason, setFailReason] = useState('')
  const [confirmState, setConfirmState] = useState<{
    title: string
    record: string
    onConfirm: () => Promise<void>
  } | null>(null)

  const params = JSON.stringify(table.queryParams)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await api.get('/v1/admin/payouts', { params: JSON.parse(params) })
      setData(res.data)
    } catch (e: unknown) {
      const message = errorMessage(e, 'Failed to load payouts')
      setLoadError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [params])

  useEffect(() => { load() }, [load])

  // Only pending payouts can be acted on, so only those are selectable —
  // a checkbox on a paid row would offer an action that always fails.
  const actionable = (data?.items ?? []).filter((p) => p.status === 'pending')
  const selection = useSelection(actionable.map((p) => p.id))

  const selectedRows = actionable.filter((p) => selection.has(p.id))
  const selectedTotal = selectedRows.reduce((sum, p) => sum + Number(p.totalAmount), 0)
  const selectedCurrency = selectedRows[0]?.currency ?? ''
  const mixedCurrencies = new Set(selectedRows.map((p) => p.currency)).size > 1

  const runBulk = async (action: 'process' | 'fail', reason?: string) => {
    setBusy(true)
    try {
      const res = await api.post('/v1/admin/payouts/bulk', {
        ids: selection.selected,
        action,
        reason,
      })
      const result: BulkResult = res.data
      if (result.failed > 0) {
        setBulkResult(result)
        toast(tc('bulk.partial', { done: result.succeeded, failed: result.failed }))
      } else {
        toast.success(tc('bulk.allDone', { count: result.succeeded }))
      }
      selection.clear()
      await load()
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'Bulk action failed'))
    } finally {
      setBusy(false)
    }
  }

  const confirmBulkProcess = () => {
    setConfirmState({
      title: t('payouts.processConfirm'),
      record: mixedCurrencies
        ? t('payouts.bulkRecordMixed', { count: selectedRows.length })
        : `${selectedRows.length} × · ${selectedTotal.toFixed(2)} ${selectedCurrency}`,
      onConfirm: () => runBulk('process'),
    })
  }

  const handleProcess = (payout: PayoutRow) => {
    // Marking a payout processed sends money out: it names the affiliate and
    // the amount, and it is a destructive-red confirmation, not a routine one.
    setConfirmState({
      title: t('payouts.processConfirm'),
      record: `${payout.affiliate?.referralCode ?? tc('na')} · ${payout.totalAmount} ${payout.currency}`,
      onConfirm: async () => {
        try {
          await api.post(`/v1/admin/payouts/${payout.id}/process`)
          toast.success(t('payouts.processed'))
          await load()
        } catch (e: unknown) {
          toast.error(errorMessage(e, 'Failed to process payout'))
          throw e
        }
      },
    })
  }

  const submitFail = async () => {
    if (!failTarget) return
    const { ids, single } = failTarget
    const reason = failReason.trim()

    if (single) {
      setBusy(true)
      try {
        await api.post(`/v1/admin/payouts/${single.id}/fail`, { reason })
        toast.success(t('payouts.markedFailed'))
        await load()
      } catch (e: unknown) {
        toast.error(errorMessage(e, 'Failed to mark payout as failed'))
      } finally {
        setBusy(false)
      }
    } else if (ids.length > 0) {
      await runBulk('fail', reason)
    }

    setFailTarget(null)
    setFailReason('')
  }

  const statusTabs = [
    { key: 'pending', label: t('payouts.tabPending') },
    { key: 'paid', label: t('payouts.tabPaid') },
    { key: 'failed', label: t('payouts.tabFailed') },
    { key: '', label: t('payouts.tabAll') },
  ]

  return (
    <div>
      <PageHeader
        title={t('payouts.title')}
        actions={<ExportButton resource="payouts" params={table.queryParams} />}
      />

      <div className="mb-4">
        <Tabs
          tabs={statusTabs}
          activeTab={table.filters.status}
          onChange={(status) => table.setFilters({ status })}
        />
      </div>

      <Card>
        {loading ? (
          <TableSkeleton />
        ) : loadError ? (
          <ErrorState message={loadError} onRetry={load} />
        ) : !data || data.items.length === 0 ? (
          <div className="py-8 text-center">
            <Wallet className="mx-auto mb-3 h-12 w-12 text-slate-300 dark:text-slate-600" />
            <p className="text-slate-500">{t('payouts.empty')}</p>
          </div>
        ) : (
          <>
            <Table>
              <Thead>
                <tr>
                  <Th className="w-10">
                    {actionable.length > 0 && (
                      <Checkbox
                        checked={selection.allSelected}
                        indeterminate={selection.someSelected}
                        onChange={selection.toggleAll}
                        label={tc('bulk.selectAll')}
                      />
                    )}
                  </Th>
                  <Th sortKey="affiliate" sort={table.sort} onSort={table.toggleSort}>
                    {t('payouts.tableAffiliate')}
                  </Th>
                  <Th sortKey="periodStart" sort={table.sort} onSort={table.toggleSort}>
                    {t('payouts.tablePeriod')}
                  </Th>
                  <Th sortKey="totalAmount" sort={table.sort} onSort={table.toggleSort}>
                    {t('payouts.tableAmount')}
                  </Th>
                  <Th sortKey="status" sort={table.sort} onSort={table.toggleSort}>
                    {t('payouts.tableStatus')}
                  </Th>
                  <Th>{t('payouts.tableActions')}</Th>
                </tr>
              </Thead>
              <Tbody>
                {data.items.map((p) => {
                  const selectable = p.status === 'pending'
                  return (
                    <Tr key={p.id} className={selection.has(p.id) ? 'bg-violet-50/60 dark:bg-violet-900/10' : ''}>
                      <Td>
                        {selectable && (
                          <Checkbox
                            checked={selection.has(p.id)}
                            onChange={() => selection.toggle(p.id)}
                            label={tc('bulk.selectRow')}
                          />
                        )}
                      </Td>
                      <Td className="font-mono">
                        {p.affiliate?.referralCode ?? tc('na')}
                        {p.affiliate?.userId && (
                          <span className="ml-2"><CopyableId value={p.affiliate.userId} /></span>
                        )}
                      </Td>
                      <Td>
                        {new Date(p.periodStart).toLocaleDateString()} —{' '}
                        {new Date(p.periodEnd).toLocaleDateString()}
                      </Td>
                      <Td className="font-semibold tabular-nums">
                        {p.totalAmount} {p.currency}
                      </Td>
                      <Td><StatusBadge status={p.status} /></Td>
                      <Td>
                        {p.status === 'pending' && (
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => handleProcess(p)}>{tc('process')}</Button>
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => { setFailTarget({ ids: [p.id], single: p }); setFailReason('') }}
                            >
                              {tc('fail')}
                            </Button>
                          </div>
                        )}
                      </Td>
                    </Tr>
                  )
                })}
              </Tbody>
            </Table>
            <Pagination page={data.page} pages={data.pages} onPageChange={table.setPage} />
          </>
        )}
      </Card>

      <BulkBar
        count={selection.selected.length}
        onClear={selection.clear}
        summary={
          mixedCurrencies
            ? t('payouts.bulkMixedCurrencies')
            : `${selectedTotal.toFixed(2)} ${selectedCurrency}`
        }
      >
        <Button size="sm" loading={busy} onClick={confirmBulkProcess}>{tc('process')}</Button>
        <Button
          size="sm"
          variant="danger"
          disabled={busy}
          onClick={() => { setFailTarget({ ids: selection.selected }); setFailReason('') }}
        >
          {tc('fail')}
        </Button>
      </BulkBar>

      {/* A failure reason is stored on the payout and read later by whoever
          picks the queue up. It was collected with window.prompt(), which
          cannot be styled, cannot be cancelled cleanly and is invisible to a
          screen reader. */}
      <Modal
        isOpen={!!failTarget}
        onClose={() => { setFailTarget(null); setFailReason('') }}
        title={t('payouts.failTitle')}
      >
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          {failTarget?.single
            ? `${failTarget.single.affiliate?.referralCode ?? tc('na')} · ${failTarget.single.totalAmount} ${failTarget.single.currency}`
            : tc('bulk.selected', { count: failTarget?.ids.length ?? 0 })}
        </p>
        <Input
          label={t('payouts.failReason')}
          value={failReason}
          onChange={(e) => setFailReason(e.target.value)}
          placeholder={t('payouts.failReasonPlaceholder')}
          autoFocus
        />
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="ghost" onClick={() => { setFailTarget(null); setFailReason('') }}>
            {tc('cancel')}
          </Button>
          <Button variant="danger" loading={busy} onClick={submitFail}>{tc('fail')}</Button>
        </div>
      </Modal>

      {confirmState && (
        <ConfirmDialog
          isOpen
          onClose={() => setConfirmState(null)}
          onConfirm={confirmState.onConfirm}
          title={confirmState.title}
          message={confirmState.title}
          record={confirmState.record}
          variant="danger"
        />
      )}

      <BulkResultDialog result={bulkResult} onClose={() => setBulkResult(null)} />
    </div>
  )
}
