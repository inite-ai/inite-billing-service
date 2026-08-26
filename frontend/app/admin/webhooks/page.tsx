'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import { Pagination } from '@/components/ui/Pagination'
import api from '@/lib/api'
import type { WebhookEvent, PaginatedResponse } from '@/lib/types'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { ErrorState } from '@/components/ui/ErrorState'
import { TableSkeleton } from '@/components/ui/Skeleton'

export default function AdminWebhooksPage() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')

  const [data, setData] = useState<PaginatedResponse<WebhookEvent> | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      setLoadError(null)
      try {
        const res = await api.get('/v1/admin/webhooks', { params: { page, limit: 20 } })
        setData(res.data)
      } catch (e: unknown) {
        const err = e as { response?: { data?: { message?: string } } }
        setLoadError(err.response?.data?.message || tc('loadFailed'))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [page])

  return (
    <div>
      <PageHeader title={t('webhooks.title')} />
      <Card>
        {loading ? (
          <TableSkeleton />
        ) : loadError ? (
          <ErrorState message={loadError} onRetry={() => setPage((p) => p)} />
        ) : !data ? null : (
          <>
            <Table>
              <Thead>
                <tr><Th>{t('webhooks.tableReceived')}</Th><Th>{t('webhooks.tableRail')}</Th><Th>{t('webhooks.tableType')}</Th><Th>{t('webhooks.tableEntity')}</Th><Th>{t('webhooks.tableStatus')}</Th><Th>{t('webhooks.tableAttempts')}</Th></tr>
              </Thead>
              <Tbody>
                {data.items.map((w) => (
                  <tr key={w.id}>
                    <Td>{new Date(w.receivedAt).toLocaleString()}</Td>
                    <Td>{w.rail}</Td>
                    <Td className="font-mono text-xs">{w.eventType}</Td>
                    <Td className="font-mono text-xs">{w.entityId.slice(0, 12)}...</Td>
                    <Td><StatusBadge status={w.status} /></Td>
                    <Td>{w.attempts}</Td>
                  </tr>
                ))}
              </Tbody>
            </Table>
            <Pagination page={data.page} pages={data.pages} onPageChange={setPage} />
          </>
        )}
      </Card>
    </div>
  )
}
