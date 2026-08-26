'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table'
import { Pagination } from '@/components/ui/Pagination'
import { Users, DollarSign, GitBranch, Copy, Eye } from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import type { PaginatedResponse } from '@/lib/types'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/ui/ErrorState'
import { CopyableId } from '@/components/ui/CopyableId'
import { ExportButton } from '@/components/ui/ExportButton'
import { IconButton } from '@/components/ui/IconButton'
import { Tabs } from '@/components/ui/Tabs'
import { useTableState } from '@/hooks/useTableState'

/** The states the API accepts. `inactive` was offered here and rejected there. */
const AFFILIATE_STATUSES = ['pending', 'active', 'suspended', 'terminated'] as const

interface AffiliateWithCount {
  id: string
  userId: string
  serviceId?: string
  parentAffiliateId?: string
  referralCode: string
  status: string
  commissionRate: string
  totalEarned: string
  totalPaid: string
  createdAt: string
  _count: { referrals: number; commissions: number }
}

export default function AdminAffiliatesPage() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')

  const table = useTableState({ filters: { status: '' }, defaultSort: 'createdAt' })

  const [data, setData] = useState<PaginatedResponse<AffiliateWithCount> | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<AffiliateWithCount | null>(null)
  const [, setDetailLoading] = useState(false)

  const params = JSON.stringify(table.queryParams)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await api.get('/v1/admin/affiliates', {
        params: { ...JSON.parse(params), limit: 20 },
      })
      setData(res.data)
    } catch (e: unknown) {
      // A rejected request used to leave `loading` true forever: the operator
      // watched a skeleton that would never resolve.
      const err = e as { response?: { data?: { message?: string } } }
      setLoadError(err.response?.data?.message || tc('loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [params, tc])

  useEffect(() => { load() }, [load])

  const handleStatusChange = async (id: string, status: string) => {
    // Unhandled before: a rejected PUT left the select showing the new status
    // with nothing changed and nothing said. Reloading puts the row back to
    // what the server actually holds.
    try {
      await api.put(`/v1/admin/affiliates/${id}`, { status })
      toast.success(t('affiliates.updated'))
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      toast.error(err.response?.data?.message || tc('loadFailed'))
    } finally {
      load()
    }
  }

  const handleDetail = async (aff: AffiliateWithCount) => {
    setSelected(aff)
    setDetailLoading(true)
    // We don't have a direct endpoint for affiliate commissions by affiliateId in admin,
    // but we can show what we have from the list data
    setDetailLoading(false)
  }

  return (
    <div>
      <PageHeader
        title={t('affiliates.title')}
        actions={<ExportButton resource="affiliates" params={table.queryParams} />}
      />

      <div className="mb-4">
        <Tabs
          tabs={[
            { key: '', label: tc('all') },
            ...AFFILIATE_STATUSES.map((s) => ({ key: s, label: t(`affiliates.status.${s}`) })),
          ]}
          activeTab={table.filters.status}
          onChange={(status) => table.setFilters({ status })}
        />
      </div>

      <Card>
        {loading ? (
          <TableSkeleton />
        ) : loadError ? (
          <ErrorState message={loadError} onRetry={load} />
        ) : !data || data.items.length === 0 ? (
          <div className="text-center py-8">
            <Users className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
            <p className="text-slate-500">{t('affiliates.noAffiliates')}</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-slate-500 mb-3">{t('affiliates.totalAffiliates', { count: data.total })}</p>
            <Table>
              <Thead>
                <tr>
                  <Th>{t('affiliates.tableUser')}</Th>
                  <Th sortKey="referralCode" sort={table.sort} onSort={table.toggleSort}>{t('affiliates.tableCode')}</Th>
                  <Th sortKey="referrals" sort={table.sort} onSort={table.toggleSort}>{t('affiliates.tableReferrals')}</Th>
                  <Th>{t('affiliates.tableCommissions')}</Th>
                  <Th sortKey="totalEarned" sort={table.sort} onSort={table.toggleSort}>{t('affiliates.tableEarned')}</Th>
                  <Th sortKey="totalPaid" sort={table.sort} onSort={table.toggleSort}>{t('affiliates.tablePaid')}</Th>
                  <Th>{t('affiliates.tableRate')}</Th>
                  <Th sortKey="status" sort={table.sort} onSort={table.toggleSort}>{t('affiliates.tableStatus')}</Th>
                  <Th>{tc('actions')}</Th>
                </tr>
              </Thead>
              <Tbody>
                {data.items.map((a) => (
                  <Tr key={a.id} className="cursor-pointer" onClick={() => handleDetail(a)}>
                    <Td className="font-mono text-xs"><CopyableId value={a.userId} /></Td>
                    <Td>
                      <span className="font-mono text-sm font-semibold text-violet-600 dark:text-violet-400">{a.referralCode}</span>
                    </Td>
                    <Td>{a._count.referrals}</Td>
                    <Td>{a._count.commissions}</Td>
                    <Td className="font-semibold text-green-600 dark:text-green-400">${a.totalEarned}</Td>
                    <Td>${a.totalPaid}</Td>
                    <Td>{(Number(a.commissionRate) * 100).toFixed(0)}%</Td>
                    <Td>
                      <div className="w-32" onClick={(e) => e.stopPropagation()}>
                        <Select
                          aria-label={t('affiliates.tableStatus')}
                          value={a.status}
                          onChange={(e) => handleStatusChange(a.id, e.target.value)}
                          options={AFFILIATE_STATUSES.map((s) => ({
                            value: s,
                            label: t(`affiliates.status.${s}`),
                          }))}
                        />
                      </div>
                    </Td>
                    <Td>
                      <div onClick={(e) => e.stopPropagation()}>
                        <IconButton
                          label={t('affiliates.detailTitle')}
                          icon={<Eye className="w-4 h-4" />}
                          tone="primary"
                          onClick={() => handleDetail(a)}
                        />
                      </div>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
            <Pagination page={data.page} pages={data.pages} onPageChange={table.setPage} />
          </>
        )}
      </Card>

      {/* Affiliate Detail Modal */}
      <Modal isOpen={!!selected} onClose={() => setSelected(null)} title={t('affiliates.detailTitle')}>
        {selected && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-lg font-bold text-violet-600 dark:text-violet-400">{selected.referralCode}</span>
              <StatusBadge status={selected.status} />
            </div>

            <div className="bg-slate-50 dark:bg-slate-900 rounded-xl p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">{t('affiliates.detailAffiliateId')}</span><span className="font-mono text-xs">{selected.id}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">{t('affiliates.detailUserId')}</span><span className="font-mono text-xs">{selected.userId}</span></div>
              {selected.parentAffiliateId && (
                <div className="flex justify-between"><span className="text-slate-500">{t('affiliates.detailParentAffiliate')}</span><span className="font-mono text-xs"><CopyableId value={selected.parentAffiliateId} /></span></div>
              )}
              <div className="flex justify-between"><span className="text-slate-500">{t('affiliates.detailCommissionRate')}</span><span className="font-semibold">{(Number(selected.commissionRate) * 100).toFixed(1)}%</span></div>
              <div className="flex justify-between"><span className="text-slate-500">{t('affiliates.detailCreated')}</span><span>{new Date(selected.createdAt).toLocaleString()}</span></div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-3 text-center">
                <DollarSign className="w-5 h-5 text-green-500 mx-auto mb-1" />
                <p className="text-lg font-bold text-green-700 dark:text-green-300">${selected.totalEarned}</p>
                <p className="text-xs text-green-600 dark:text-green-400">{t('affiliates.statTotalEarned')}</p>
              </div>
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3 text-center">
                <DollarSign className="w-5 h-5 text-blue-500 mx-auto mb-1" />
                <p className="text-lg font-bold text-blue-700 dark:text-blue-300">${selected.totalPaid}</p>
                <p className="text-xs text-blue-600 dark:text-blue-400">{t('affiliates.statTotalPaid')}</p>
              </div>
              <div className="bg-violet-50 dark:bg-violet-900/20 rounded-xl p-3 text-center">
                <Users className="w-5 h-5 text-violet-500 mx-auto mb-1" />
                <p className="text-lg font-bold text-violet-700 dark:text-violet-300">{selected._count.referrals}</p>
                <p className="text-xs text-violet-600 dark:text-violet-400">{t('affiliates.statReferrals')}</p>
              </div>
              <div className="bg-orange-50 dark:bg-orange-900/20 rounded-xl p-3 text-center">
                <GitBranch className="w-5 h-5 text-orange-500 mx-auto mb-1" />
                <p className="text-lg font-bold text-orange-700 dark:text-orange-300">{selected._count.commissions}</p>
                <p className="text-xs text-orange-600 dark:text-orange-400">{t('affiliates.statCommissions')}</p>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex gap-2">
              <Button
                size="sm" variant="secondary" className="flex-1"
                onClick={() => {
                  navigator.clipboard.writeText(selected.referralCode)
                  toast.success(tc('toast.codeCopied'))
                }}
                icon={<Copy className="w-4 h-4" />}
              >
                {tc('copyCode')}
              </Button>
              {selected.status === 'active' && (
                <Button size="sm" variant="danger" className="flex-1" onClick={() => { handleStatusChange(selected.id, 'suspended'); setSelected(null) }}>
                  {tc('suspend')}
                </Button>
              )}
              {selected.status !== 'active' && (
                <Button size="sm" className="flex-1" onClick={() => { handleStatusChange(selected.id, 'active'); setSelected(null) }}>
                  {tc('activate')}
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
