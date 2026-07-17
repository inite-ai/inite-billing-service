'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import { Send, Loader2, Bot, FileText } from 'lucide-react'
import api from '@/lib/api'

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
  const [rows, setRows] = useState<OutreachRow[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [triggerFilter, setTriggerFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selected, setSelected] = useState<OutreachRow | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [listRes, statsRes] = await Promise.all([
        api.get('/v1/admin/outreach', {
          params: {
            page,
            limit: 20,
            trigger: triggerFilter || undefined,
            status: statusFilter || undefined,
          },
        }),
        api.get('/v1/admin/outreach/stats'),
      ])
      setRows(listRes.data.items ?? [])
      setTotalPages(listRes.data.totalPages || 1)
      setStats(statsRes.data)
    } finally {
      setLoading(false)
    }
  }, [page, triggerFilter, statusFilter])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <Send className="w-6 h-6 text-violet-500" />
        {t('title')}
      </h1>

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
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <select
            value={triggerFilter}
            onChange={(e) => {
              setPage(1)
              setTriggerFilter(e.target.value)
            }}
            className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
          >
            <option value="">{t('allTriggers')}</option>
            {['abandoned_checkout', 'dunning', 'winback', 'trial_ending'].map(
              (tr) => (
                <option key={tr} value={tr}>
                  {t(`triggers.${tr}`)}
                </option>
              ),
            )}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => {
              setPage(1)
              setStatusFilter(e.target.value)
            }}
            className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
          >
            <option value="">{t('allStatuses')}</option>
            {['sent', 'pending', 'skipped', 'failed'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
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
                <Th>{t('columns.trigger')}</Th>
                <Th>{t('columns.user')}</Th>
                <Th>{t('columns.subject')}</Th>
                <Th>{t('columns.source')}</Th>
                <Th>{t('columns.status')}</Th>
                <Th>{t('columns.outcome')}</Th>
                <Th>{t('columns.sentAt')}</Th>
              </tr>
            </Thead>
            <Tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => setSelected(row)}
                  className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
                >
                  <Td>
                    {t(`triggers.${row.trigger}`)}
                    {row.trigger === 'dunning' && ` (d${row.step})`}
                  </Td>
                  <Td className="font-mono text-xs">{row.userId.slice(0, 12)}…</Td>
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
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-sm text-center text-slate-500">
                    {t('empty')}
                  </td>
                </tr>
              )}
            </Tbody>
          </Table>
        )}

        {totalPages > 1 && (
          <div className="pt-4 flex items-center justify-center gap-3 text-sm">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-700 disabled:opacity-40"
            >
              ←
            </button>
            <span>
              {page} / {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-700 disabled:opacity-40"
            >
              →
            </button>
          </div>
        )}
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
