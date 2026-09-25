'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Plus, Pencil, Trash2, Power, PowerOff, Waypoints, Activity, X } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '@/lib/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import { getErrorMessage } from '@/lib/api-error'
import type { McpCallOutcome, McpServer, McpServerUsage, Service } from '@/lib/types'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { Badge, type BadgeVariant } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { IconButton } from '@/components/ui/IconButton'
import { PageHeader } from '@/components/ui/PageHeader'
import { ActiveBadge } from '@/components/ui/StatusBadge'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import { McpServerForm, type McpServerPayload } from '@/components/admin/McpServerForm'

interface Overview {
  since: string
  servers: McpServer[]
}

const OUTCOME_VARIANT: Record<McpCallOutcome, BadgeVariant> = {
  ok: 'success',
  free: 'default',
  denied: 'warning',
  upstream_error: 'error',
  unpaid: 'error',
}

const count = (calls: McpServer['calls'], outcome: McpCallOutcome) => calls?.[outcome] ?? 0

/**
 * The MCP gateway, seen from the platform: every operator's proxied servers,
 * what their callers did, and what was charged.
 *
 * The number that matters most is the one nobody is paid for. `unpaid` is a
 * call the upstream answered and the charge then failed — work given away —
 * and `denied` is a caller turned away at the door. Both are shown next to the
 * revenue, not hidden behind it, because a pricing mistake looks exactly like
 * a quiet week until you can see them.
 */
export default function AdminMcpPage() {
  const t = useTranslations('admin.mcp')
  const tc = useTranslations('common')
  const { confirm, DialogElement } = useConfirmDialog()
  const [days, setDays] = useState('30')
  const [editing, setEditing] = useState<McpServer | undefined>()
  const [showForm, setShowForm] = useState(false)
  const [inspecting, setInspecting] = useState<McpServer | null>(null)

  const { data, loading, error, refetch } = useApiQuery<Overview>(`/v1/admin/mcp/servers?days=${days}`)
  const { data: services } = useApiQuery<Service[]>('/v1/admin/services')
  const { data: usage, loading: usageLoading } = useApiQuery<McpServerUsage>(
    inspecting ? `/v1/admin/mcp/servers/${inspecting.id}/usage?days=${days}` : null,
  )

  const servers = useMemo(() => data?.servers ?? [], [data])
  const totals = useMemo(() => {
    const sum = (o: McpCallOutcome) => servers.reduce((n, s) => n + count(s.calls, o), 0)
    return {
      active: servers.filter((s) => s.isActive).length,
      paid: sum('ok'),
      credits: servers.reduce((n, s) => n + (s.creditsCharged ?? 0), 0),
      denied: sum('denied'),
      unpaid: sum('unpaid'),
      errors: sum('upstream_error'),
    }
  }, [servers])

  const closeForm = () => {
    setShowForm(false)
    setEditing(undefined)
  }

  const handleSubmit = async (payload: McpServerPayload) => {
    if (editing) {
      await api.patch(`/v1/admin/mcp/servers/${editing.id}`, payload)
      toast.success(t('updated'))
    } else {
      await api.post('/v1/admin/mcp/servers', payload)
      toast.success(t('created'))
    }
    closeForm()
    refetch()
  }

  const handleToggle = async (server: McpServer) => {
    try {
      await api.patch(`/v1/admin/mcp/servers/${server.id}`, { isActive: !server.isActive })
      toast.success(server.isActive ? t('deactivated') : t('activated'))
      refetch()
    } catch (e) {
      toast.error(getErrorMessage(e, t('saveFailed')))
    }
  }

  const handleDelete = async (server: McpServer) => {
    const ok = await confirm({
      title: t('deleteTitle'),
      message: t('deleteMessage'),
      record: `${server.name} · /mcp/s/${server.slug}`,
      variant: 'danger',
    })
    if (!ok) return
    try {
      await api.delete(`/v1/admin/mcp/servers/${server.id}`)
      toast.success(t('deleted'))
      if (inspecting?.id === server.id) setInspecting(null)
      refetch()
    } catch (e) {
      toast.error(getErrorMessage(e, t('saveFailed')))
    }
  }

  const pricing = (s: McpServer) => {
    if (s.pricingMode === 'free') return t('pricing.free')
    if (s.pricingMode === 'entitlement')
      return t('pricingEntitlement', { key: s.requiredEntitlement ?? '—' })
    if (s.featureCode) return t('pricingFeature', { code: s.featureCode })
    return t('pricingFlat', { credits: s.creditsPerCall ?? 0 })
  }

  return (
    <div>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <>
            <div className="w-36">
              <Select
                aria-label={t('window')}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                options={[
                  { value: '7', label: t('lastDays', { days: 7 }) },
                  { value: '30', label: t('lastDays', { days: 30 }) },
                  { value: '90', label: t('lastDays', { days: 90 }) },
                ]}
              />
            </div>
            <Button
              size="sm"
              icon={<Plus className="h-4 w-4" />}
              onClick={() => {
                setEditing(undefined)
                setShowForm(true)
              }}
              disabled={!services || services.length === 0}
            >
              {t('add')}
            </Button>
          </>
        }
      />

      {servers.length > 0 && (
        <dl className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-3 lg:grid-cols-6 dark:border-slate-800 dark:bg-slate-800">
          <Figure label={t('stats.servers')} value={`${totals.active} / ${servers.length}`} hint={t('stats.serversHint')} />
          <Figure label={t('stats.paidCalls')} value={totals.paid} />
          <Figure label={t('stats.credits')} value={totals.credits} />
          <Figure label={t('stats.denied')} value={totals.denied} hint={t('stats.deniedHint')} tone={totals.denied ? 'warn' : undefined} />
          <Figure label={t('stats.unpaid')} value={totals.unpaid} hint={t('stats.unpaidHint')} tone={totals.unpaid ? 'bad' : undefined} />
          <Figure label={t('stats.errors')} value={totals.errors} hint={t('stats.errorsHint')} tone={totals.errors ? 'bad' : undefined} />
        </dl>
      )}

      <Card>
        {loading && !data ? (
          <TableSkeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : servers.length === 0 ? (
          <EmptyState icon={Waypoints} title={t('empty')} subtitle={t('emptyHint')} />
        ) : (
          <Table>
            <Thead>
              <tr>
                <Th>{t('columns.server')}</Th>
                <Th>{t('columns.operator')}</Th>
                <Th>{t('columns.pricing')}</Th>
                <Th className="text-right">{t('columns.calls')}</Th>
                <Th className="text-right">{t('columns.credits')}</Th>
                <Th>{t('columns.status')}</Th>
                <Th>{t('columns.actions')}</Th>
              </tr>
            </Thead>
            <Tbody>
              {servers.map((s) => {
                const leaks = count(s.calls, 'denied') + count(s.calls, 'unpaid') + count(s.calls, 'upstream_error')
                return (
                  <tr key={s.id} className={inspecting?.id === s.id ? 'bg-violet-50/60 dark:bg-violet-900/10' : undefined}>
                    <Td>
                      <div className="font-medium text-slate-900 dark:text-white">{s.name}</div>
                      <div className="font-mono text-xs text-slate-500 dark:text-slate-400">/mcp/s/{s.slug}</div>
                    </Td>
                    <Td>
                      <span className="font-mono text-xs">{s.service?.code ?? '—'}</span>
                    </Td>
                    <Td className="text-sm">{pricing(s)}</Td>
                    <Td className="text-right tabular-nums">
                      <span className="font-medium">{count(s.calls, 'ok') + count(s.calls, 'free')}</span>
                      {leaks > 0 && (
                        <span className="ml-1.5 text-xs text-amber-600 dark:text-amber-400" title={t('leaksTitle')}>
                          +{leaks}
                        </span>
                      )}
                    </Td>
                    <Td className="text-right font-medium tabular-nums">{s.creditsCharged ?? 0}</Td>
                    <Td>
                      <ActiveBadge active={s.isActive} />
                    </Td>
                    <Td>
                      <div className="flex gap-2">
                        <IconButton
                          onClick={() => setInspecting(inspecting?.id === s.id ? null : s)}
                          tone="primary"
                          label={t('inspect')}
                          icon={<Activity className="h-4 w-4" />}
                        />
                        <IconButton
                          onClick={() => {
                            setEditing(s)
                            setShowForm(true)
                          }}
                          tone="primary"
                          label={tc('edit')}
                          icon={<Pencil className="h-4 w-4" />}
                        />
                        <IconButton
                          onClick={() => handleToggle(s)}
                          tone={s.isActive ? 'warning' : 'success'}
                          label={s.isActive ? tc('deactivate') : tc('activate')}
                          icon={s.isActive ? <Power className="h-4 w-4" /> : <PowerOff className="h-4 w-4" />}
                        />
                        <IconButton
                          onClick={() => handleDelete(s)}
                          tone="danger"
                          label={tc('delete')}
                          icon={<Trash2 className="h-4 w-4" />}
                        />
                      </div>
                    </Td>
                  </tr>
                )
              })}
            </Tbody>
          </Table>
        )}
      </Card>

      {inspecting && (
        <Card className="mt-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                {t('recentTitle', { name: inspecting.name })}
              </h2>
              <p className="mt-0.5 break-all font-mono text-xs text-slate-500 dark:text-slate-400">
                {inspecting.upstreamUrl}
              </p>
            </div>
            <IconButton onClick={() => setInspecting(null)} label={tc('close')} icon={<X className="h-4 w-4" />} />
          </div>

          {usageLoading && !usage ? (
            <TableSkeleton />
          ) : !usage || usage.recent.length === 0 ? (
            <EmptyState icon={Activity} title={t('noCalls')} subtitle={t('noCallsHint')} />
          ) : (
            <Table>
              <Thead>
                <tr>
                  <Th>{t('columns.when')}</Th>
                  <Th>{t('columns.caller')}</Th>
                  <Th>{t('columns.call')}</Th>
                  <Th>{t('columns.outcome')}</Th>
                  <Th className="text-right">{t('columns.credits')}</Th>
                  <Th className="text-right">{t('columns.latency')}</Th>
                </tr>
              </Thead>
              <Tbody>
                {usage.recent.map((call) => (
                  <tr key={call.id}>
                    <Td className="whitespace-nowrap text-xs tabular-nums text-slate-500 dark:text-slate-400">
                      {new Date(call.createdAt).toLocaleString()}
                    </Td>
                    <Td className="font-mono text-xs">{call.userId}</Td>
                    <Td>
                      <span className="font-mono text-xs">{call.toolName ?? call.method}</span>
                      {call.detail && (
                        <p className="mt-0.5 max-w-xs truncate text-xs text-slate-500 dark:text-slate-400" title={call.detail}>
                          {call.detail}
                        </p>
                      )}
                    </Td>
                    <Td>
                      <Badge variant={OUTCOME_VARIANT[call.outcome] ?? 'default'}>{t(`outcome.${call.outcome}`)}</Badge>
                    </Td>
                    <Td className="text-right tabular-nums">{call.creditsCharged}</Td>
                    <Td className="text-right text-xs tabular-nums text-slate-500 dark:text-slate-400">
                      {call.latencyMs != null ? `${call.latencyMs} ms` : '—'}
                    </Td>
                  </tr>
                ))}
              </Tbody>
            </Table>
          )}
        </Card>
      )}

      <Modal isOpen={showForm} onClose={closeForm} title={editing ? t('editTitle') : t('createTitle')}>
        {showForm && (
          <McpServerForm
            key={editing?.id ?? 'new'}
            initial={editing}
            services={services ?? []}
            onSubmit={handleSubmit}
            onCancel={closeForm}
          />
        )}
      </Modal>

      {DialogElement}
    </div>
  )
}

function Figure({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string | number
  hint?: string
  tone?: 'warn' | 'bad'
}) {
  const color =
    tone === 'bad'
      ? 'text-red-600 dark:text-red-400'
      : tone === 'warn'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-slate-900 dark:text-white'
  return (
    <div className="bg-white px-4 py-3 dark:bg-slate-900" title={hint}>
      <dt className="truncate text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className={`mt-0.5 text-xl font-semibold tabular-nums ${color}`}>{value}</dd>
    </div>
  )
}
