'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import { Pagination } from '@/components/ui/Pagination'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import type { Payout, PaginatedResponse } from '@/lib/types'

export default function AdminPayoutsPage() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')

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
    if (!confirm(t('payouts.processConfirm'))) return
    await api.post(`/v1/admin/payouts/${id}/process`)
    toast.success(t('payouts.processed'))
    load()
  }

  const handleFail = async (id: string) => {
    const reason = prompt(t('payouts.failReason'))
    if (reason === null) return
    await api.post(`/v1/admin/payouts/${id}/fail`, { reason })
    toast.success(t('payouts.markedFailed'))
    load()
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">{t('payouts.title')}</h1>
      <Card>
        {loading ? <div className="text-gray-500 py-4">{tc('loading')}</div> : !data ? null : (
          <>
            <Table>
              <Thead>
                <tr><Th>{t('payouts.tableAffiliate')}</Th><Th>{t('payouts.tablePeriod')}</Th><Th>{t('payouts.tableAmount')}</Th><Th>{t('payouts.tableStatus')}</Th><Th>{t('payouts.tableActions')}</Th></tr>
              </Thead>
              <Tbody>
                {data.items.map((p) => (
                  <tr key={p.id}>
                    <Td className="font-mono">{(p as any).affiliate?.referralCode || tc('na')}</Td>
                    <Td>{new Date(p.periodStart).toLocaleDateString()} - {new Date(p.periodEnd).toLocaleDateString()}</Td>
                    <Td className="font-semibold">${p.totalAmount} {p.currency}</Td>
                    <Td><Badge>{p.status}</Badge></Td>
                    <Td>
                      {p.status === 'pending' && (
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => handleProcess(p.id)}>{tc('process')}</Button>
                          <Button size="sm" variant="danger" onClick={() => handleFail(p.id)}>{tc('fail')}</Button>
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
