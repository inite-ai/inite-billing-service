'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import { Pagination } from '@/components/ui/Pagination'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import type { Payout, PaginatedResponse } from '@/lib/types'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusBadge } from '@/components/ui/StatusBadge'

export default function AdminPayoutsPage() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')

  const [data, setData] = useState<PaginatedResponse<Payout & { affiliate?: { referralCode: string } }> | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean
    title: string
    message: string
    onConfirm: () => Promise<void>
    variant?: 'danger' | 'default'
  } | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.get('/v1/admin/payouts', { params: { page, limit: 20 } })
      setData(res.data)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      toast.error(err.response?.data?.message || 'Failed to load payouts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [page])

  const handleProcess = (id: string) => {
    setConfirmState({
      isOpen: true,
      title: t('payouts.processConfirm'),
      message: t('payouts.processConfirm'),
      variant: 'default',
      onConfirm: async () => {
        try {
          await api.post(`/v1/admin/payouts/${id}/process`)
          toast.success(t('payouts.processed'))
          load()
        } catch (e: unknown) {
          const err = e as { response?: { data?: { message?: string } } }
          toast.error(err.response?.data?.message || 'Failed to process payout')
          throw e
        }
      },
    })
  }

  const handleFail = async (id: string) => {
    const reason = prompt(t('payouts.failReason'))
    if (reason === null) return
    try {
      await api.post(`/v1/admin/payouts/${id}/fail`, { reason })
      toast.success(t('payouts.markedFailed'))
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      toast.error(err.response?.data?.message || 'Failed to mark payout as failed')
    }
  }

  return (
    <div>
      <PageHeader title={t('payouts.title')} />
      <Card>
        {loading ? <div className="text-slate-500 py-4">{tc('loading')}</div> : !data ? null : (
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
                    <Td><StatusBadge status={p.status} /></Td>
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

      {confirmState && (
        <ConfirmDialog
          isOpen={confirmState.isOpen}
          onClose={() => setConfirmState(null)}
          onConfirm={confirmState.onConfirm}
          title={confirmState.title}
          message={confirmState.message}
          variant={confirmState.variant}
        />
      )}
    </div>
  )
}
