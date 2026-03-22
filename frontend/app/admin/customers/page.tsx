'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import { Pagination } from '@/components/ui/Pagination'
import { Tabs } from '@/components/ui/Tabs'
import { Search, Loader2, Users } from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'

interface CustomerItem {
  userId: string
  totalOrders: number
  totalSpent: string
  lastOrderAt: string | null
  activeSubscriptions: number
  activeEntitlements: number
  creditBalance: number
  affiliate: { userId: string; status: string; referralCode: string } | null
}

interface CustomerDetail {
  userId: string
  totalOrders: number
  totalSpent: number
  orders: Array<{
    id: string
    status: string
    amount: string
    currency: string
    createdAt: string
    price?: { product?: { name: string } }
  }>
  subscriptions: Array<{
    id: string
    status: string
    currentPeriodEnd: string
    price?: { product?: { name: string }; amount: string; currency: string }
  }>
  entitlements: Array<{
    id: string
    key: string
    status: string
    expiresAt: string | null
  }>
  credits: Array<{
    id: string
    balance: number
    service?: { name: string }
  }>
  affiliate: {
    referralCode: string
    status: string
    totalEarned: string
  } | null
  funnelEvents: Array<{
    id: string
    event: string
    stage: string
    createdAt: string
    metadata?: Record<string, unknown>
  }>
}

interface PaginatedCustomers {
  items: CustomerItem[]
  total: number
  page: number
  limit: number
  pages: number
}

export default function AdminCustomersPage() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')

  const [data, setData] = useState<PaginatedCustomers | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<CustomerDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('summary')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string | number> = { page, limit: 20 }
      if (search.trim()) params.search = search.trim()
      const res = await api.get('/v1/admin/customers', { params })
      setData(res.data)
    } catch {
      toast.error(tc('errors.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [page, search, tc])

  useEffect(() => { load() }, [page]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = () => { setPage(1); load() }

  const handleDetail = async (userId: string) => {
    setDetailLoading(true)
    setSelected(null)
    setActiveTab('summary')
    try {
      const res = await api.get(`/v1/admin/customers/${userId}`)
      setSelected(res.data)
    } catch {
      toast.error(tc('errors.loadFailed'))
    } finally {
      setDetailLoading(false)
    }
  }

  const detailTabs = [
    { key: 'summary', label: t('customers.summary') },
    { key: 'orders', label: t('customers.recentOrders') },
    { key: 'subscriptions', label: t('subscriptions.title') },
    { key: 'timeline', label: t('customers.timeline') },
  ]

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('customers.title')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('customers.subtitle')}</p>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <div className="w-72">
          <Input
            placeholder={t('customers.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
        </div>
        <Button size="sm" variant="secondary" onClick={handleSearch} icon={<Search className="w-4 h-4" />}>
          {tc('search')}
        </Button>
      </div>

      <Card>
        {loading ? (
          <div className="flex items-center gap-2 text-gray-500 py-4">
            <Loader2 className="w-5 h-5 animate-spin" /> {tc('loading')}
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="text-center py-8">
            <Users className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500">{t('customers.noCustomers')}</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-500 mb-3">
              {t('customers.totalCount', { count: data.total })}
            </p>
            <Table>
              <Thead>
                <tr>
                  <Th>{t('customers.userId')}</Th>
                  <Th>{t('customers.totalOrders')}</Th>
                  <Th>{t('customers.totalSpent')}</Th>
                  <Th>{t('customers.activeSubscriptions')}</Th>
                  <Th>{t('customers.creditBalance')}</Th>
                  <Th>{t('customers.lastOrder')}</Th>
                  <Th>{t('customers.affiliate')}</Th>
                </tr>
              </Thead>
              <Tbody>
                {data.items.map((customer) => (
                  <tr
                    key={customer.userId}
                    className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50"
                    onClick={() => handleDetail(customer.userId)}
                  >
                    <Td className="font-mono text-xs">{customer.userId.slice(0, 12)}...</Td>
                    <Td>{customer.totalOrders}</Td>
                    <Td className="font-semibold">{Number(customer.totalSpent).toFixed(2)}</Td>
                    <Td>{customer.activeSubscriptions}</Td>
                    <Td>{customer.creditBalance}</Td>
                    <Td>
                      {customer.lastOrderAt
                        ? new Date(customer.lastOrderAt).toLocaleDateString()
                        : t('customers.never')}
                    </Td>
                    <Td>
                      {customer.affiliate ? (
                        <Badge variant="info">{customer.affiliate.status}</Badge>
                      ) : (
                        <span className="text-gray-400">-</span>
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

      {/* Customer Detail Modal */}
      <Modal
        isOpen={detailLoading || !!selected}
        onClose={() => { setSelected(null); setDetailLoading(false) }}
        title={t('customers.customerDetail')}
      >
        {detailLoading ? (
          <div className="flex items-center gap-2 text-gray-500 py-4">
            <Loader2 className="w-5 h-5 animate-spin" /> {tc('loading')}
          </div>
        ) : selected && (
          <div className="space-y-4">
            <Tabs tabs={detailTabs} activeTab={activeTab} onChange={setActiveTab} />

            {activeTab === 'summary' && (
              <div className="space-y-3">
                <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">{t('customers.userId')}</span>
                    <span className="font-mono text-xs">{selected.userId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">{t('customers.totalOrders')}</span>
                    <span className="font-semibold">{selected.totalOrders}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">{t('customers.totalSpent')}</span>
                    <span className="font-semibold">{Number(selected.totalSpent).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">{t('customers.activeSubscriptions')}</span>
                    <span>{selected.subscriptions.filter((s) => s.status === 'active' || s.status === 'trialing').length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">{t('customers.creditBalance')}</span>
                    <span>{selected.credits.reduce((sum, c) => sum + c.balance, 0)}</span>
                  </div>
                </div>

                {selected.affiliate && (
                  <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-4 text-sm space-y-2">
                    <h5 className="font-semibold text-gray-700 dark:text-gray-300">{t('customers.affiliate')}</h5>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Code</span>
                      <span className="font-mono text-xs">{selected.affiliate.referralCode}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Status</span>
                      <Badge>{selected.affiliate.status}</Badge>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'orders' && (
              <div>
                {selected.orders.length === 0 ? (
                  <p className="text-gray-500 text-sm py-4 text-center">{t('orders.noOrders')}</p>
                ) : (
                  <Table>
                    <Thead>
                      <tr>
                        <Th>{tc('date')}</Th>
                        <Th>{tc('product')}</Th>
                        <Th>{tc('amount')}</Th>
                        <Th>{tc('status')}</Th>
                      </tr>
                    </Thead>
                    <Tbody>
                      {selected.orders.map((order) => (
                        <tr key={order.id}>
                          <Td>{new Date(order.createdAt).toLocaleDateString()}</Td>
                          <Td>{order.price?.product?.name || '-'}</Td>
                          <Td className="font-semibold">{order.amount} {order.currency}</Td>
                          <Td><Badge>{order.status}</Badge></Td>
                        </tr>
                      ))}
                    </Tbody>
                  </Table>
                )}
              </div>
            )}

            {activeTab === 'subscriptions' && (
              <div>
                {selected.subscriptions.length === 0 ? (
                  <p className="text-gray-500 text-sm py-4 text-center">{t('subscriptions.noSubscriptions')}</p>
                ) : (
                  <Table>
                    <Thead>
                      <tr>
                        <Th>{tc('product')}</Th>
                        <Th>{tc('status')}</Th>
                        <Th>{t('subscriptions.tablePeriodEnd')}</Th>
                      </tr>
                    </Thead>
                    <Tbody>
                      {selected.subscriptions.map((sub) => (
                        <tr key={sub.id}>
                          <Td>{sub.price?.product?.name || '-'}</Td>
                          <Td><Badge>{sub.status}</Badge></Td>
                          <Td>{new Date(sub.currentPeriodEnd).toLocaleDateString()}</Td>
                        </tr>
                      ))}
                    </Tbody>
                  </Table>
                )}
              </div>
            )}

            {activeTab === 'timeline' && (
              <div>
                {selected.funnelEvents.length === 0 ? (
                  <p className="text-gray-500 text-sm py-4 text-center">{t('funnel.noData')}</p>
                ) : (
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {selected.funnelEvents.map((event) => (
                      <div
                        key={event.id}
                        className="flex items-center justify-between bg-gray-50 dark:bg-gray-900 rounded-lg px-3 py-2 text-sm"
                      >
                        <div>
                          <span className="font-medium text-gray-700 dark:text-gray-300">{event.event}</span>
                          {event.stage && (
                            <Badge variant="default" className="ml-2">{event.stage}</Badge>
                          )}
                        </div>
                        <span className="text-gray-400 text-xs">
                          {new Date(event.createdAt).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
