'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table'
import { Bot, Eye, FileText, Send } from 'lucide-react'
import api from '@/lib/api'
import { CopyableId } from '@/components/ui/CopyableId'
import { Select } from '@/components/ui/Select'
import { ErrorState } from '@/components/ui/ErrorState'
import { IconButton } from '@/components/ui/IconButton'
import { PageHeader } from '@/components/ui/PageHeader'
import { Pagination } from '@/components/ui/Pagination'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { useTableState } from '@/hooks/useTableState'

interface OutreachRow {
  id: string
  userId: string
  trigger: string
  step: number
  locale: string
  subject: string | null
  body: string | null
  source: string | null
  status: string
  skipReason: string | null
  outcome: string | null
  sentAt: string | null
  createdAt: string
}

interface Stats {
  byTrigger: Array<{
    trigger: string
    sent: number
    skipped: number
    converted: number
    conversionRate: number
  }>
  llmFallbackRate: number
  windowDays: number
}

const STATUS_VARIANTS: Record<string, "default" | "success" | "warning" | "error" | "info"> = {
  sent: "success",
  pending: "warning",
  skipped: "default",
  failed: "error",
}

export default function AdminOutreachPage() {
  const t = useTranslations('admin.outreach')
  const table = useTableState({ filters: { trigger: '', status: '' }, defaultSort: 'createdAt' })

  const [rows, setRows] = useState<OutreachRow[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [totalPages, setTotalPages] = useState(1)
  const [selected, setSelected] = useState<OutreachRow | null>(null)

  const params = JSON.stringify(table.queryParams)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [listRes, statsRes] = await Promise.all([
        api.get('/v1/admin/outreach', { params: { ...JSON.parse(params), limit: 20 } }),
        api.get('/v1/admin/outreach/stats'),
      ])
      setRows(listRes.data.items ?? [])
      setTotalPages(listRes.data.totalPages || 1)
      setStats(statsRes.data)
    } catch (e: unknown) {
      // There was no catch: a failed load rendered the empty state, so an
      // outage read as "nothing was ever sent".
      const err = e as { response?: { data?: { message?: string } } }
      setLoadError(err.response?.data?.message || t('loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [params, t])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} icon={<Send className="w-6 h-6 text-violet-500" />} />

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.byTrigger.map((s) => (
            <Card key={s.trigger}>
              <p className="text-xs text-slate-500 uppercase tracking-wide">
                {t(`triggers.${s.trigger}`)}
              </p>
              <p className="text-2xl font-bold mt-1">{s.sent}</p>
              <p className="text-xs text-slate-500 mt-1">
                {t('converted')}: {s.converted} (
                {(s.conversionRate * 100).toFixed(1)}%)
                {s.skipped > 0 && ` · ${t('skipped')}: ${s.skipped}`}
              </p>
            </Card>
          ))}
          <Card>
            <p className="text-xs text-slate-500 uppercase tracking-wide">
              {t('fallbackRate')}
            </p>
            <p className="text-2xl font-bold mt-1">
              {(stats.llmFallbackRate * 100).toFixed(1)}%
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {t('windowDays', { days: stats.windowDays })}
            </p>
          </Card>
        </div>
      )}

      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="w-56">
            <Select
              aria-label={t('allTriggers')}
              value={table.filters.trigger}
              onChange={(e) => table.setFilters({ trigger: e.target.value })}
              options={[
                { value: '', label: t('allTriggers') },
                ...['abandoned_checkout', 'dunning', 'winback', 'trial_ending'].map((tr) => ({
                  value: tr,
                  label: t(`triggers.${tr}`),
                })),
              ]}
            />
          </div>
          <div className="w-44">
            <Select
              aria-label={t('allStatuses')}
              value={table.filters.status}
              onChange={(e) => table.setFilters({ status: e.target.value })}
              options={[
                { value: '', label: t('allStatuses') },
                ...['sent', 'pending', 'skipped', 'failed'].map((v) => ({
                  value: v,
                  label: t(`statuses.${v}`),
                })),
              ]}
            />
          </div>
        </div>

        {loading ? (
          <TableSkeleton />
        ) : loadError ? (
          <ErrorState message={loadError} onRetry={load} />
        ) : (
          <Table>
            <Thead>
              <tr>
                <Th>{t('columns.trigger')}</Th>
                <Th>{t('columns.user')}</Th>
                <Th>{t('columns.subject')}</Th>
                <Th>{t('columns.source')}</Th>
                <Th>{t('columns.status')}</Th>
                <Th>{t('columns.outcome')}</Th>
                <Th>{t('columns.sentAt')}</Th>
                <Th>{''}</Th>
              </tr>
            </Thead>
            <Tbody>
              {rows.map((row) => (
                <Tr key={row.id} onClick={() => setSelected(row)} className="cursor-pointer">
                  <Td>
                    {t(`triggers.${row.trigger}`)}
                    {row.trigger === 'dunning' && ` (d${row.step})`}
                  </Td>
                  <Td><CopyableId value={row.userId} chars={12} /></Td>
                  <Td className="max-w-[240px] truncate">{row.subject || '—'}</Td>
                  <Td>
                    {row.source === 'llm' ? (
                      <span className="inline-flex items-center gap-1 text-violet-500">
                        <Bot className="w-3.5 h-3.5" /> LLM
                      </span>
                    ) : row.source === 'template' ? (
                      <span className="inline-flex items-center gap-1 text-slate-500">
                        <FileText className="w-3.5 h-3.5" /> {t('template')}
                      </span>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td>
                    <Badge variant={STATUS_VARIANTS[row.status] || 'default'}>
                      {row.status}
                      {row.skipReason ? `: ${row.skipReason}` : ''}
                    </Badge>
                  </Td>
                  <Td>{row.outcome || '—'}</Td>
                  <Td className="text-xs text-slate-500">
                    {row.sentAt ? new Date(row.sentAt).toLocaleString() : '—'}
                  </Td>
                  <Td>
                    {/* The row opens the message; a keyboard needs a control. */}
                    <div onClick={(e) => e.stopPropagation()}>
                      <IconButton
                        label={t('detailTitle')}
                        icon={<Eye className="w-4 h-4" />}
                        tone="primary"
                        onClick={() => setSelected(row)}
                      />
                    </div>
                  </Td>
                </Tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-sm text-center text-slate-500">
                    {t('empty')}
                  </td>
                </tr>
              )}
            </Tbody>
          </Table>
        )}

        {/* Was a hand-rolled pair of unlabelled arrows; the shared control is
            labelled and announces the page count. */}
        <Pagination page={table.page} pages={totalPages} onPageChange={table.setPage} />
      </Card>

      <Modal
        isOpen={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.subject || t('title')}
      >
        {selected && (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge variant="info">{t(`triggers.${selected.trigger}`)}</Badge>
              <Badge variant={STATUS_VARIANTS[selected.status] || 'default'}>
                {selected.status}
              </Badge>
              {selected.outcome && <Badge variant="info">{selected.outcome}</Badge>}
              <Badge variant="default">{selected.locale}</Badge>
              {selected.source && <Badge variant="default">{selected.source}</Badge>}
            </div>
            <p className="text-xs text-slate-500 font-mono">
              {t('columns.user')}: {selected.userId}
            </p>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-4 whitespace-pre-wrap">
              {selected.body || '—'}
            </div>
            {selected.sentAt && (
              <p className="text-xs text-slate-400">
                {t('columns.sentAt')}: {new Date(selected.sentAt).toLocaleString()}
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
