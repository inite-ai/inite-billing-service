'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { BulkBar } from '@/components/ui/BulkBar'
import { BulkResultDialog, type BulkResult } from '@/components/ui/BulkResult'
import { Checkbox } from '@/components/ui/Checkbox'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { CopyableId } from '@/components/ui/CopyableId'
import { ErrorState } from '@/components/ui/ErrorState'
import { IconButton } from '@/components/ui/IconButton'
import { PageHeader } from '@/components/ui/PageHeader'
import { Pagination } from '@/components/ui/Pagination'
import { Select } from '@/components/ui/Select'
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { useSelection } from '@/hooks/useSelection'
import { useTableState } from '@/hooks/useTableState'
import { ChevronDown, ChevronUp, ShieldAlert } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '@/lib/api'

interface RiskRow {
  id: string
  orderId: string
  userId: string
  ip: string | null
  score: number
  level: string
  status: string
  signals: Array<{ code: string; weight: number; detail: string }>
  reviewNote: string | null
  createdAt: string
  order?: {
    amount: string
    currency: string
    status: string
    price?: { product?: { name: string } }
  }
}

interface RiskStats {
  byLevel: Array<{ level: string; count: number }>
  byStatus: Array<{ status: string; count: number }>
  windowDays: number
}

const LEVEL_VARIANTS: Record<string, 'success' | 'warning' | 'error'> = {
  low: 'success',
  medium: 'warning',
  high: 'error',
}

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  reviewed_ok: 'success',
  reviewed_fraud: 'error',
  flagged: 'warning',
  blocked: 'warning',
}

const STATUS_OPTIONS = ['flagged', 'blocked', 'reviewed_ok', 'reviewed_fraud', 'none']

const errorMessage = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { message?: string } } }).response?.data?.message || fallback

export default function AdminRiskPage() {
  const t = useTranslations('admin.risk')
  const tc = useTranslations('common')

  const table = useTableState({ filters: { status: '' }, defaultSort: 'createdAt' })

  const [rows, setRows] = useState<RiskRow[]>([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [stats, setStats] = useState<RiskStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null)
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
      const [listRes, statsRes] = await Promise.all([
        api.get('/v1/admin/risk/flagged', { params: { ...JSON.parse(params), limit: 25 } }),
        api.get('/v1/admin/risk/stats'),
      ])
      setRows(listRes.data.items ?? [])
      setTotal(listRes.data.total ?? 0)
      setPages(listRes.data.totalPages ?? 1)
      setStats(statsRes.data)
    } catch (e: unknown) {
      // Without this the fraud queue answered "nothing flagged" whenever the
      // API was down — a false all-clear on the one screen that must not give
      // one.
      setLoadError(errorMessage(e, tc('loadFailed')))
    } finally {
      setLoading(false)
    }
  }, [params, tc])

  useEffect(() => { load() }, [load])

  // Only an open assessment can be reviewed; a decided one has nothing to apply.
  const open = rows.filter((r) => ['flagged', 'blocked'].includes(r.status))
  const selection = useSelection(open.map((r) => r.id))

  const review = async (row: RiskRow, resolution: 'ok' | 'fraud', refund = false) => {
    setReviewing(row.id)
    try {
      await api.post(`/v1/admin/risk/${row.id}/review`, { resolution, refund })
      toast.success(t('reviewed'))
      await load()
    } catch (e: unknown) {
      toast.error(errorMessage(e, tc('loadFailed')))
    } finally {
      setReviewing(null)
    }
  }

  /** Refunding is money leaving; it gets a confirmation naming the order. */
  const confirmFraudRefund = (row: RiskRow) => {
    setConfirmState({
      title: t('markFraudRefund'),
      record: `${row.order?.amount ?? ''} ${row.order?.currency ?? ''} · ${row.orderId}`,
      onConfirm: () => review(row, 'fraud', true),
    })
  }

  const runBulk = async (resolution: 'ok' | 'fraud') => {
    setBusy(true)
    try {
      const res = await api.post('/v1/admin/risk/bulk-review', {
        ids: selection.selected,
        resolution,
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
      toast.error(errorMessage(e, tc('loadFailed')))
    } finally {
      setBusy(false)
    }
  }

  const confirmBulk = (resolution: 'ok' | 'fraud') => {
    setConfirmState({
      title: resolution === 'ok' ? t('markOk') : t('markFraud'),
      record: tc('bulk.selected', { count: selection.selected.length }),
      onConfirm: () => runBulk(resolution),
    })
  }

  return (
    <div>
      <PageHeader title={t('title')} icon={<ShieldAlert className="h-6 w-6 text-violet-500" />} />

      {stats && (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {['high', 'medium', 'low'].map((level) => (
            <Card key={level}>
              <p className="text-xs uppercase tracking-wide text-slate-500">{t(`levels.${level}`)}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {stats.byLevel.find((r) => r.level === level)?.count ?? 0}
              </p>
            </Card>
          ))}
          <Card>
            <p className="text-xs uppercase tracking-wide text-slate-500">{t('flaggedOpen')}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {stats.byStatus.find((r) => r.status === 'flagged')?.count ?? 0}
            </p>
            <p className="mt-1 text-xs text-slate-500">{t('windowDays', { days: stats.windowDays })}</p>
          </Card>
        </div>
      )}

      <Card>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="w-64">
            <Select
              label={t('filterStatus')}
              value={table.filters.status}
              onChange={(e) => table.setFilters({ status: e.target.value })}
              options={[
                { value: '', label: t('openOnly') },
                // The raw enum was shown to the operator as-is; these are the
                // same words the rest of the admin uses for the same states.
                ...STATUS_OPTIONS.map((s) => ({ value: s, label: t(`statuses.${s}`) })),
              ]}
            />
          </div>
          {!loading && !loadError && (
            <p className="pb-2.5 text-sm text-slate-500">{t('totalCount', { count: total })}</p>
          )}
        </div>

        {loading ? (
          <TableSkeleton />
        ) : loadError ? (
          <ErrorState message={loadError} onRetry={load} />
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">{t('empty')}</p>
        ) : (
          <>
            <Table>
              <Thead>
                <tr>
                  <Th className="w-10">
                    {open.length > 0 && (
                      <Checkbox
                        checked={selection.allSelected}
                        indeterminate={selection.someSelected}
                        onChange={selection.toggleAll}
                        label={tc('bulk.selectAll')}
                      />
                    )}
                  </Th>
                  <Th sortKey="score" sort={table.sort} onSort={table.toggleSort}>
                    {t('columns.score')}
                  </Th>
                  <Th>{t('columns.order')}</Th>
                  <Th>{t('columns.user')}</Th>
                  <Th sortKey="status" sort={table.sort} onSort={table.toggleSort}>
                    {t('columns.status')}
                  </Th>
                  <Th sortKey="createdAt" sort={table.sort} onSort={table.toggleSort}>
                    {t('columns.date')}
                  </Th>
                  <Th>{''}</Th>
                </tr>
              </Thead>
              <Tbody>
                {rows.map((row) => {
                  const isOpen = ['flagged', 'blocked'].includes(row.status)
                  return (
                    <Fragment key={row.id}>
                      <Tr className={selection.has(row.id) ? 'bg-violet-50/60 dark:bg-violet-900/10' : ''}>
                        <Td>
                          {isOpen && (
                            <Checkbox
                              checked={selection.has(row.id)}
                              onChange={() => selection.toggle(row.id)}
                              label={tc('bulk.selectRow')}
                            />
                          )}
                        </Td>
                        <Td>
                          <Badge variant={LEVEL_VARIANTS[row.level] || 'default'}>
                            {row.score} · {t(`levels.${row.level}`)}
                          </Badge>
                        </Td>
                        <Td className="text-xs">
                          {row.order?.price?.product?.name ?? '—'}
                          <span className="text-slate-400">
                            {' '}
                            {row.order ? `${row.order.amount} ${row.order.currency}` : ''}
                          </span>
                        </Td>
                        <Td><CopyableId value={row.userId} chars={12} /></Td>
                        <Td>
                          <Badge variant={STATUS_VARIANTS[row.status] || 'default'}>
                            {t(`statuses.${row.status}`)}
                          </Badge>
                        </Td>
                        <Td className="text-xs text-slate-500">
                          {new Date(row.createdAt).toLocaleString()}
                        </Td>
                        <Td>
                          <IconButton
                            onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                            tone="primary"
                            label={expanded === row.id ? tc('collapse') : tc('expand')}
                            aria-expanded={expanded === row.id}
                            icon={
                              expanded === row.id ? (
                                <ChevronUp className="h-4 w-4" />
                              ) : (
                                <ChevronDown className="h-4 w-4" />
                              )
                            }
                          />
                        </Td>
                      </Tr>
                      {expanded === row.id && (
                        <tr>
                          <td colSpan={7} className="bg-slate-50 px-4 py-3 dark:bg-slate-800/50">
                            <ul className="mb-3 space-y-1 text-xs">
                              {(row.signals ?? []).map((signal, idx) => (
                                <li key={idx}>
                                  <span className="font-mono text-violet-500">{signal.code}</span>{' '}
                                  (+{signal.weight}) — {signal.detail}
                                </li>
                              ))}
                              {row.ip && <li className="text-slate-400">IP: {row.ip}</li>}
                              {row.reviewNote && (
                                <li className="text-slate-500">{row.reviewNote}</li>
                              )}
                            </ul>
                            {isOpen && (
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  disabled={reviewing === row.id}
                                  onClick={() => review(row, 'ok')}
                                >
                                  {t('markOk')}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="danger"
                                  disabled={reviewing === row.id}
                                  onClick={() => review(row, 'fraud')}
                                >
                                  {t('markFraud')}
                                </Button>
                                {row.order?.status === 'paid' && (
                                  <Button
                                    size="sm"
                                    variant="danger"
                                    disabled={reviewing === row.id}
                                    onClick={() => confirmFraudRefund(row)}
                                  >
                                    {t('markFraudRefund')}
                                  </Button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </Tbody>
            </Table>
            <Pagination page={table.page} pages={pages} onPageChange={table.setPage} />
          </>
        )}
      </Card>

      {/* Bulk stops at a verdict. Refunding a selection at once is money out
          the door on rows the operator has not opened — it stays per-order. */}
      <BulkBar count={selection.selected.length} onClear={selection.clear}>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => confirmBulk('ok')}>
          {t('markOk')}
        </Button>
        <Button size="sm" variant="danger" disabled={busy} onClick={() => confirmBulk('fraud')}>
          {t('markFraud')}
        </Button>
      </BulkBar>

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
