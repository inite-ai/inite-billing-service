'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import { Pagination } from '@/components/ui/Pagination'
import { Tabs } from '@/components/ui/Tabs'
import { Search, Loader2, CreditCard, Calendar, DollarSign } from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import type { Subscription, PaginatedResponse } from '@/lib/types'

export default function AdminSubscriptionsPage() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')

  const statusTabs = [
    { key: '', label: t('subscriptions.tabAll') },
    { key: 'active', label: t('subscriptions.tabActive') },
    { key: 'trialing', label: t('subscriptions.tabTrialing') },
    { key: 'past_due', label: t('subscriptions.tabPastDue') },
    { key: 'canceled', label: t('subscriptions.tabCanceled') },
  ]

  const [data, setData] = useState<PaginatedResponse<Subscription> | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [userSearch, setUserSearch] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Subscription | null>(null)
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
      const params: Record<string, string | number> = { page, limit: 20 }
      if (statusFilter) params.status = statusFilter
      if (userSearch.trim()) params.userId = userSearch.trim()
      const res = await api.get('/v1/admin/subscriptions', { params })
      setData(res.data)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      toast.error(err.response?.data?.message || 'Failed to load subscriptions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [statusFilter, page])

  const handleSearch = () => { setPage(1); load() }

  const handleCancel = (id: string) => {
    setConfirmState({
      isOpen: true,
      title: t('subscriptions.forceCancelConfirm'),
      message: t('subscriptions.forceCancelConfirm'),
      variant: 'danger',
      onConfirm: async () => {
        try {
          await api.post(`/v1/admin/subscriptions/${id}/cancel`)
          toast.success(t('subscriptions.canceled'))
          setSelected(null)
          load()
        } catch (e: unknown) {
          const err = e as { response?: { data?: { message?: string } } }
          toast.error(err.response?.data?.message || t('subscriptions.cancelError'))
          throw e
        }
      },
    })
  }

  const daysUntil = (date: string) => Math.max(0, Math.ceil((new Date(date).getTime() - Date.now()) / 86400000))

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">{t('subscriptions.title')}</h1>

      <div className="flex flex-wrap items-center gap-4 mb-4">
        <Tabs tabs={statusTabs} activeTab={statusFilter} onChange={(v) => { setStatusFilter(v); setPage(1) }} />
        <div className="flex items-center gap-2 ml-auto">
          <div className="w-64">
            <Input placeholder={t('subscriptions.searchPlaceholder')} value={userSearch} onChange={(e) => setUserSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
          </div>
          <Button size="sm" variant="secondary" onClick={handleSearch} icon={<Search className="w-4 h-4" />}>{tc('search')}</Button>
        </div>
      </div>

      <Card>
        {loading ? (
          <div className="flex items-center gap-2 text-gray-500 py-4"><Loader2 className="w-5 h-5 animate-spin" /> {tc('loading')}</div>
        ) : !data || data.items.length === 0 ? (
          <div className="text-center py-8">
            <CreditCard className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500">{t('subscriptions.noSubscriptions')}</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-500 mb-3">{t('subscriptions.totalSubscriptions', { count: data.total })}</p>
            <Table>
              <Thead>
                <tr><Th>{t('subscriptions.tableUser')}</Th><Th>{t('subscriptions.tableProduct')}</Th><Th>{t('subscriptions.tablePrice')}</Th><Th>{t('subscriptions.tableStatus')}</Th><Th>{t('subscriptions.tablePeriodEnd')}</Th><Th>{t('subscriptions.tableDaysLeft')}</Th><Th>{t('subscriptions.tableActions')}</Th></tr>
              </Thead>
              <Tbody>
                {data.items.map((sub) => (
                  <tr key={sub.id} className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50" onClick={() => setSelected(sub)}>
                    <Td className="font-mono text-xs">{sub.userId.slice(0, 8)}...</Td>
                    <Td>{sub.price?.product?.name || '-'}</Td>
                    <Td>{sub.price ? `${sub.price.amount} ${sub.price.currency}/${sub.price.interval || 'mo'}` : '-'}</Td>
                    <Td><Badge>{sub.status}</Badge></Td>
                    <Td>{new Date(sub.currentPeriodEnd).toLocaleDateString()}</Td>
                    <Td>{daysUntil(sub.currentPeriodEnd)}d</Td>
                    <Td>
                      <div onClick={(e) => e.stopPropagation()}>
                        {(sub.status === 'active' || sub.status === 'trialing') && (
                          <Button size="sm" variant="danger" onClick={() => handleCancel(sub.id)}>{tc('cancel')}</Button>
                        )}
                      </div>
                    </Td>
                  </tr>
                ))}
              </Tbody>
            </Table>
            <Pagination page={data.page} pages={data.pages} onPageChange={setPage} />
          </>
        )}
      </Card>

      <Modal isOpen={!!selected} onClose={() => setSelected(null)} title={t('subscriptions.detailTitle')}>
        {selected && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Badge>{selected.status}</Badge>
              {selected.cancelAtPeriodEnd && <Badge variant="warning">{tc('status.canceling')}</Badge>}
            </div>

            <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">{t('subscriptions.detailSubscriptionId')}</span><span className="font-mono text-xs">{selected.id}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">{t('subscriptions.detailUserId')}</span><span className="font-mono text-xs">{selected.userId}</span></div>
              {selected.price?.product?.name && <div className="flex justify-between"><span className="text-gray-500">{t('subscriptions.detailProduct')}</span><span className="font-semibold">{selected.price.product.name}</span></div>}
              {selected.price && (
                <div className="flex justify-between">
                  <span className="text-gray-500">{t('subscriptions.detailPrice')}</span>
                  <span className="font-semibold">{selected.price.amount} {selected.price.currency}/{selected.price.interval || 'month'}</span>
                </div>
              )}
              <div className="flex justify-between"><span className="text-gray-500">{t('subscriptions.detailPeriodStart')}</span><span>{new Date(selected.currentPeriodStart).toLocaleDateString()}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">{t('subscriptions.detailPeriodEnd')}</span><span>{new Date(selected.currentPeriodEnd).toLocaleDateString()} ({t('subscriptions.detailDaysLeft', { count: daysUntil(selected.currentPeriodEnd) })})</span></div>
              <div className="flex justify-between"><span className="text-gray-500">{t('subscriptions.detailAutoRenew')}</span><span>{selected.cancelAtPeriodEnd ? tc('no') : tc('yes')}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">{t('subscriptions.detailCreated')}</span><span>{new Date(selected.createdAt).toLocaleString()}</span></div>
            </div>

            {(selected.status === 'active' || selected.status === 'trialing') && !selected.cancelAtPeriodEnd && (
              <Button variant="danger" onClick={() => handleCancel(selected.id)} className="w-full">{t('subscriptions.forceCancel')}</Button>
            )}
          </div>
        )}
      </Modal>

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
