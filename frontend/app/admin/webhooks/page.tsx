'use client'

import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import { Pagination } from '@/components/ui/Pagination'
import api from '@/lib/api'
import type { WebhookEvent, PaginatedResponse } from '@/lib/types'

export default function AdminWebhooksPage() {
  const [data, setData] = useState<PaginatedResponse<WebhookEvent> | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const res = await api.get('/v1/admin/webhooks', { params: { page, limit: 20 } })
      setData(res.data)
      setLoading(false)
    }
    load()
  }, [page])

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Webhook Events</h1>
      <Card>
        {loading ? <div className="text-gray-500 py-4">Loading...</div> : !data ? null : (
          <>
            <Table>
              <Thead>
                <tr><Th>Received</Th><Th>Rail</Th><Th>Type</Th><Th>Entity</Th><Th>Status</Th><Th>Attempts</Th></tr>
              </Thead>
              <Tbody>
                {data.items.map((w) => (
                  <tr key={w.id}>
                    <Td>{new Date(w.receivedAt).toLocaleString()}</Td>
                    <Td>{w.rail}</Td>
                    <Td className="font-mono text-xs">{w.eventType}</Td>
                    <Td className="font-mono text-xs">{w.entityId.slice(0, 12)}...</Td>
                    <Td><Badge>{w.status}</Badge></Td>
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
