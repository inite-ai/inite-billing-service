'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table'
import { Pagination } from '@/components/ui/Pagination'
import api from '@/lib/api'
import type { WebhookEvent, PaginatedResponse } from '@/lib/types'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { ErrorState } from '@/components/ui/ErrorState'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { CopyableId } from '@/components/ui/CopyableId'
import { Tabs } from '@/components/ui/Tabs'
import { useTableState } from '@/hooks/useTableState'

export default function AdminWebhooksPage() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')

  const table = useTableState({ filters: { status: '' }, defaultSort: 'receivedAt' })

  const [data, setData] = useState<PaginatedResponse<WebhookEvent> | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const params = JSON.stringify(table.queryParams)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await api.get('/v1/admin/webhooks', {
        params: { ...JSON.parse(params), limit: 20 },
      })
      setData(res.data)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      setLoadError(err.response?.data?.message || tc('loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [params, tc])

  useEffect(() => { load() }, [load])

  // A failed delivery is the only reason anyone opens this page in a hurry,
  // and it was previously findable only by paging through everything.
  const statusTabs = [
    { key: '', label: t('webhooks.tabAll') },
    { key: 'failed', label: t('webhooks.tabFailed') },
    { key: 'received', label: t('webhooks.tabReceived') },
    { key: 'processed', label: t('webhooks.tabProcessed') },
  ]

  return (
    <div>
      <PageHeader title={t('webhooks.title')} />

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
        ) : !data ? null : (
          <>
            <Table>
              <Thead>
                <tr>
                  <Th sortKey="receivedAt" sort={table.sort} onSort={table.toggleSort}>{t('webhooks.tableReceived')}</Th>
                  <Th sortKey="rail" sort={table.sort} onSort={table.toggleSort}>{t('webhooks.tableRail')}</Th>
                  <Th sortKey="eventType" sort={table.sort} onSort={table.toggleSort}>{t('webhooks.tableType')}</Th>
                  <Th>{t('webhooks.tableEntity')}</Th>
                  <Th sortKey="status" sort={table.sort} onSort={table.toggleSort}>{t('webhooks.tableStatus')}</Th>
                  <Th sortKey="attempts" sort={table.sort} onSort={table.toggleSort}>{t('webhooks.tableAttempts')}</Th>
                </tr>
              </Thead>
              <Tbody>
                {data.items.map((w) => (
                  <Tr key={w.id}>
                    <Td>{new Date(w.receivedAt).toLocaleString()}</Td>
                    <Td>{w.rail}</Td>
                    <Td className="font-mono text-xs">{w.eventType}</Td>
                    <Td><CopyableId value={w.entityId} chars={12} /></Td>
                    <Td><StatusBadge status={w.status} /></Td>
                    <Td className="tabular-nums">{w.attempts}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
            <Pagination page={data.page} pages={data.pages} onPageChange={table.setPage} />
          </>
        )}
      </Card>
    </div>
  )
}
