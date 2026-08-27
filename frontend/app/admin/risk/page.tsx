'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import { ShieldAlert, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '@/lib/api'
import { IconButton } from '@/components/ui/IconButton'

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

export default function AdminRiskPage() {
  const t = useTranslations('admin.risk')
  const tc = useTranslations('common')
  const [rows, setRows] = useState<RiskRow[]>([])
  const [stats, setStats] = useState<RiskStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [listRes, statsRes] = await Promise.all([
        api.get('/v1/admin/risk/flagged', {
          params: { status: statusFilter || undefined, limit: 50 },
        }),
        api.get('/v1/admin/risk/stats'),
      ])
      setRows(listRes.data.items ?? [])
      setStats(statsRes.data)
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => {
    load()
  }, [load])

  const review = async (
    row: RiskRow,
    resolution: 'ok' | 'fraud',
    refund = false,
  ) => {
    setReviewing(row.id)
    try {
      await api.post(`/v1/admin/risk/${row.id}/review`, { resolution, refund })
      toast.success(t('reviewed'))
      load()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Error')
    } finally {
      setReviewing(null)
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <ShieldAlert className="w-6 h-6 text-violet-500" />
        {t('title')}
      </h1>

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {['high', 'medium', 'low'].map((level) => (
            <Card key={level}>
              <p className="text-xs text-slate-500 uppercase tracking-wide">
                {t(`levels.${level}`)}
              </p>
              <p className="text-2xl font-bold mt-1">
                {stats.byLevel.find((r) => r.level === level)?.count ?? 0}
              </p>
            </Card>
          ))}
          <Card>
            <p className="text-xs text-slate-500 uppercase tracking-wide">
              {t('flaggedOpen')}
            </p>
            <p className="text-2xl font-bold mt-1">
              {stats.byStatus.find((r) => r.status === 'flagged')?.count ?? 0}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {t('windowDays', { days: stats.windowDays })}
            </p>
          </Card>
        </div>
      )}

      <Card>
        <div className="flex items-center gap-2 mb-4">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
          >
            <option value="">{t('openOnly')}</option>
            {['flagged', 'blocked', 'reviewed_ok', 'reviewed_fraud', 'none'].map(
              (s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ),
            )}
          </select>
        </div>

        {loading ? (
          <div className="py-12 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
          </div>
        ) : (
          <Table>
            <Thead>
              <tr>
                <Th>{t('columns.score')}</Th>
                <Th>{t('columns.order')}</Th>
                <Th>{t('columns.user')}</Th>
                <Th>{t('columns.status')}</Th>
                <Th>{t('columns.date')}</Th>
                <Th>{''}</Th>
              </tr>
            </Thead>
            <Tbody>
              {rows.map((row) => (
                <>
                  <tr key={row.id}>
                    <Td>
                      <Badge variant={LEVEL_VARIANTS[row.level] || 'default'}>
                        {row.score} · {row.level}
                      </Badge>
                    </Td>
                    <Td className="text-xs">
                      {row.order?.price?.product?.name ?? '—'}
                      <span className="text-slate-400">
                        {' '}
                        {row.order ? `${row.order.amount} ${row.order.currency}` : ''}
                      </span>
                    </Td>
                    <Td className="font-mono text-xs">{row.userId.slice(0, 12)}…</Td>
                    <Td>
                      <Badge
                        variant={
                          row.status === 'reviewed_fraud'
                            ? 'error'
                            : row.status === 'reviewed_ok'
                              ? 'success'
                              : row.status === 'flagged' || row.status === 'blocked'
                                ? 'warning'
                                : 'default'
                        }
                      >
                        {row.status}
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
                            <ChevronUp className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )
                        }
                      />
                    </Td>
                  </tr>
                  {expanded === row.id && (
                    <tr key={`${row.id}-details`}>
                      <td
                        colSpan={6}
                        className="px-4 py-3 bg-slate-50 dark:bg-slate-800/50"
                      >
                        <ul className="text-xs space-y-1 mb-3">
                          {(row.signals ?? []).map((signal, idx) => (
                            <li key={idx}>
                              <span className="font-mono text-violet-500">
                                {signal.code}
                              </span>{' '}
                              (+{signal.weight}) — {signal.detail}
                            </li>
                          ))}
                          {row.ip && (
                            <li className="text-slate-400">IP: {row.ip}</li>
                          )}
                        </ul>
                        {['flagged', 'blocked'].includes(row.status) && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => review(row, 'ok')}
                              disabled={reviewing === row.id}
                              className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50"
                            >
                              {t('markOk')}
                            </button>
                            <button
                              onClick={() => review(row, 'fraud')}
                              disabled={reviewing === row.id}
                              className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50"
                            >
                              {t('markFraud')}
                            </button>
                            {row.order?.status === 'paid' && (
                              <button
                                onClick={() => review(row, 'fraud', true)}
                                disabled={reviewing === row.id}
                                className="px-3 py-1.5 rounded-lg border border-red-500 text-red-500 text-xs font-semibold hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                              >
                                {t('markFraudRefund')}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-sm text-center text-slate-500"
                  >
                    {t('empty')}
                  </td>
                </tr>
              )}
            </Tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}
