'use client'

import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import { Pagination } from '@/components/ui/Pagination'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import type { Payout, PaginatedResponse } from '@/lib/types'

export default function AdminPayoutsPage() {
  const [data, setData] = useState<PaginatedResponse<Payout & { affiliate?: { referralCode: string } }> | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const res = await api.get('/v1/admin/payouts', { params: { page, limit: 20 } })
    setData(res.data)
    setLoading(false)
  }

  useEffect(() => { load() }, [page])

  const handleProcess = async (id: string) => {
    if (!confirm('Mark this payout as processed?')) return
    await api.post(`/v1/admin/payouts/${id}/process`)
    toast.success('Payout processed')
    load()
  }

  const handleFail = async (id: string) => {
    const reason = prompt('Failure reason:')
    if (reason === null) return
    await api.post(`/v1/admin/payouts/${id}/fail`, { reason })
    toast.success('Payout marked as failed')
    load()
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Payouts</h1>
      <Card>
        {loading ? <div className="text-gray-500 py-4">Loading...</div> : !data ? null : (
          <>
            <Table>
              <Thead>
                <tr><Th>Affiliate</Th><Th>Period</Th><Th>Amount</Th><Th>Status</Th><Th>Actions</Th></tr>
              </Thead>
              <Tbody>
                {data.items.map((p) => (
                  <tr key={p.id}>
                    <Td className="font-mono">{(p as any).affiliate?.referralCode || 'N/A'}</Td>
                    <Td>{new Date(p.periodStart).toLocaleDateString()} - {new Date(p.periodEnd).toLocaleDateString()}</Td>
                    <Td className="font-semibold">${p.totalAmount} {p.currency}</Td>
                    <Td><Badge>{p.status}</Badge></Td>
                    <Td>
                      {p.status === 'pending' && (
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => handleProcess(p.id)}>Process</Button>
                          <Button size="sm" variant="danger" onClick={() => handleFail(p.id)}>Fail</Button>
                        </div>
                      )}
                    </Td>
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
