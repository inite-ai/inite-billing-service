'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table'
import { Pagination } from '@/components/ui/Pagination'
import { Tabs } from '@/components/ui/Tabs'
import { EntitlementForm } from '@/components/admin/EntitlementForm'
import { Plus, Search, Key } from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import type { Entitlement, PaginatedResponse } from '@/lib/types'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/ui/ErrorState'
import { CopyableId } from '@/components/ui/CopyableId'
import { PageHeader } from '@/components/ui/PageHeader'
import { useTableState } from '@/hooks/useTableState'

export default function AdminEntitlementsPage() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')

  const statusTabs = [
    { key: '', label: t('entitlements.tabAll') },
    { key: 'active', label: t('entitlements.tabActive') },
    { key: 'revoked', label: t('entitlements.tabRevoked') },
    { key: 'expired', label: t('entitlements.tabExpired') },
  ]

  const table = useTableState({ filters: { status: '', userId: '' }, defaultSort: 'createdAt' })

  const [data, setData] = useState<PaginatedResponse<Entitlement> | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [searchDraft, setSearchDraft] = useState(table.filters.userId)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean
    title: string
    message: string
    record?: string
    onConfirm: () => Promise<void>
    variant?: 'danger' | 'default'
  } | null>(null)

  const params = JSON.stringify(table.queryParams)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await api.get('/v1/admin/entitlements', {
        params: { ...JSON.parse(params), limit: 20 },
      })
      setData(res.data)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      const message = err.response?.data?.message || 'Failed to load entitlements'
      setLoadError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [params])

  useEffect(() => { load() }, [load])
  useEffect(() => { setSearchDraft(table.filters.userId) }, [table.filters.userId])

  const handleCreate = async (formData: { userId: string; key: string; expiresAt?: string }) => {
    await api.post('/v1/admin/entitlements', formData)
    toast.success(t('entitlements.created'))
    setShowModal(false)
    load()
  }

  const handleRevoke = (id: string) => {
    // Revoking cuts off access; the dialog names the key and whose it is.
    const ent = data?.items.find((e) => e.id === id)
    setConfirmState({
      isOpen: true,
      title: t('entitlements.revokeConfirm'),
      message: t('entitlements.revokeConfirm'),
      record: ent ? `${ent.key} · ${ent.userId}` : id,
      variant: 'danger',
      onConfirm: async () => {
        try {
          await api.post(`/v1/admin/entitlements/${id}/revoke`)
          toast.success(t('entitlements.revokedSuccess'))
          load()
        } catch (e: unknown) {
          const err = e as { response?: { data?: { message?: string } } }
          toast.error(err.response?.data?.message || 'Failed to revoke entitlement')
          throw e
        }
      },
    })
  }

  return (
    <div>
      <PageHeader
        title={t('entitlements.title')}
        actions={
          <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setShowModal(true)}>
            {t('entitlements.addEntitlement')}
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-4 mb-4">
        <Tabs
          tabs={statusTabs}
          activeTab={table.filters.status}
          onChange={(status) => table.setFilters({ status })}
        />
        <form
          className="flex items-center gap-2 ml-auto"
          onSubmit={(e) => { e.preventDefault(); table.setFilters({ userId: searchDraft.trim() }) }}
        >
          <div className="w-64">
            <Input
              type="search"
              aria-label={t('entitlements.searchPlaceholder')}
              placeholder={t('entitlements.searchPlaceholder')}
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
            />
          </div>
          <Button size="sm" variant="secondary" type="submit" icon={<Search className="w-4 h-4" />}>{tc('search')}</Button>
        </form>
      </div>

      <Card>
        {loading ? (
          <TableSkeleton />
        ) : loadError ? (
          <ErrorState message={loadError} onRetry={load} />
        ) : !data || data.items.length === 0 ? (
          <div className="text-center py-8">
            <Key className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
            <p className="text-slate-500">{t('entitlements.noEntitlements')}</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-slate-500 mb-3">{t('entitlements.totalEntitlements', { count: data.total })}</p>
            <Table>
              <Thead>
                <tr>
                  <Th sortKey="userId" sort={table.sort} onSort={table.toggleSort}>{t('entitlements.tableUser')}</Th>
                  <Th sortKey="key" sort={table.sort} onSort={table.toggleSort}>{t('entitlements.tableKey')}</Th>
                  <Th>{t('entitlements.tableSource')}</Th>
                  <Th sortKey="status" sort={table.sort} onSort={table.toggleSort}>{t('entitlements.tableStatus')}</Th>
                  <Th sortKey="expiresAt" sort={table.sort} onSort={table.toggleSort}>{t('entitlements.tableExpires')}</Th>
                  <Th>{t('entitlements.tableActions')}</Th>
                </tr>
              </Thead>
              <Tbody>
                {data.items.map((e) => (
                  <Tr key={e.id}>
                    <Td className="font-mono text-xs"><CopyableId value={e.userId} /></Td>
                    <Td className="font-mono font-semibold">{e.key}</Td>
                    <Td><Badge variant={e.source === 'admin' ? 'warning' : 'default'}>{e.source}</Badge></Td>
                    <Td><StatusBadge status={e.status} /></Td>
                    <Td>{e.expiresAt ? new Date(e.expiresAt).toLocaleDateString() : <span className="text-slate-400">{tc('never')}</span>}</Td>
                    <Td>
                      {e.status === 'active' && (
                        <Button size="sm" variant="danger" onClick={() => handleRevoke(e.id)}>{tc('revoke')}</Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
            <Pagination page={data.page} pages={data.pages} onPageChange={table.setPage} />
          </>
        )}
      </Card>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={t('entitlements.createTitle')}>
        <EntitlementForm onSubmit={handleCreate} onCancel={() => setShowModal(false)} />
      </Modal>

      {confirmState && (
        <ConfirmDialog
          isOpen={confirmState.isOpen}
          onClose={() => setConfirmState(null)}
          onConfirm={confirmState.onConfirm}
          title={confirmState.title}
          message={confirmState.message}
          record={confirmState.record}
          variant={confirmState.variant}
        />
      )}
    </div>
  )
}
