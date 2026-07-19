'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import { Pagination } from '@/components/ui/Pagination'
import { Loader2, Users, DollarSign, GitBranch, Copy } from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import type { PaginatedResponse } from '@/lib/types'

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

  const [data, setData] = useState<PaginatedResponse<AffiliateWithCount> | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<AffiliateWithCount | null>(null)
  const [, setDetailLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    const res = await api.get('/v1/admin/affiliates', { params: { page, limit: 20 } })
    setData(res.data)
    setLoading(false)
  }

  useEffect(() => { load() }, [page])

  const handleStatusChange = async (id: string, status: string) => {
    await api.put(`/v1/admin/affiliates/${id}`, { status })
    toast.success(t('affiliates.updated'))
    load()
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
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">{t('affiliates.title')}</h1>

      <Card>
        {loading ? (
          <div className="flex items-center gap-2 text-gray-500 py-4"><Loader2 className="w-5 h-5 animate-spin" /> {tc('loading')}</div>
        ) : !data || data.items.length === 0 ? (
          <div className="text-center py-8">
            <Users className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500">{t('affiliates.noAffiliates')}</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-500 mb-3">{t('affiliates.totalAffiliates', { count: data.total })}</p>
            <Table>
              <Thead>
                <tr><Th>{t('affiliates.tableUser')}</Th><Th>{t('affiliates.tableCode')}</Th><Th>{t('affiliates.tableReferrals')}</Th><Th>{t('affiliates.tableCommissions')}</Th><Th>{t('affiliates.tableEarned')}</Th><Th>{t('affiliates.tablePaid')}</Th><Th>{t('affiliates.tableRate')}</Th><Th>{t('affiliates.tableStatus')}</Th></tr>
              </Thead>
              <Tbody>
                {data.items.map((a) => (
                  <tr key={a.id} className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50" onClick={() => handleDetail(a)}>
                    <Td className="font-mono text-xs">{a.userId.slice(0, 8)}...</Td>
                    <Td>
                      <span className="font-mono text-sm font-semibold text-violet-600 dark:text-violet-400">{a.referralCode}</span>
                    </Td>
                    <Td>{a._count.referrals}</Td>
                    <Td>{a._count.commissions}</Td>
                    <Td className="font-semibold text-green-600 dark:text-green-400">${a.totalEarned}</Td>
                    <Td>${a.totalPaid}</Td>
                    <Td>{(Number(a.commissionRate) * 100).toFixed(0)}%</Td>
                    <Td>
                      <div className="w-28" onClick={(e) => e.stopPropagation()}>
                        <Select
                          value={a.status}
                          onChange={(e) => handleStatusChange(a.id, e.target.value)}
                          options={[
                            { value: 'active', label: t('affiliates.statusActive') },
                            { value: 'inactive', label: t('affiliates.statusInactive') },
                            { value: 'suspended', label: t('affiliates.statusSuspended') },
                          ]}
                        />
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

      {/* Affiliate Detail Modal */}
      <Modal isOpen={!!selected} onClose={() => setSelected(null)} title={t('affiliates.detailTitle')}>
        {selected && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-lg font-bold text-violet-600 dark:text-violet-400">{selected.referralCode}</span>
              <Badge>{selected.status}</Badge>
            </div>

            <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">{t('affiliates.detailAffiliateId')}</span><span className="font-mono text-xs">{selected.id}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">{t('affiliates.detailUserId')}</span><span className="font-mono text-xs">{selected.userId}</span></div>
              {selected.parentAffiliateId && (
                <div className="flex justify-between"><span className="text-gray-500">{t('affiliates.detailParentAffiliate')}</span><span className="font-mono text-xs">{selected.parentAffiliateId.slice(0, 8)}...</span></div>
              )}
              <div className="flex justify-between"><span className="text-gray-500">{t('affiliates.detailCommissionRate')}</span><span className="font-semibold">{(Number(selected.commissionRate) * 100).toFixed(1)}%</span></div>
              <div className="flex justify-between"><span className="text-gray-500">{t('affiliates.detailCreated')}</span><span>{new Date(selected.createdAt).toLocaleString()}</span></div>
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
