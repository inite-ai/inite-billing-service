'use client'

import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import { Pagination } from '@/components/ui/Pagination'
import { Tabs } from '@/components/ui/Tabs'
import { EntitlementForm } from '@/components/admin/EntitlementForm'
import { Plus, Search, Loader2, Key } from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import type { Entitlement, PaginatedResponse } from '@/lib/types'

const statusTabs = [
  { key: '', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'revoked', label: 'Revoked' },
  { key: 'expired', label: 'Expired' },
]

export default function AdminEntitlementsPage() {
  const [data, setData] = useState<PaginatedResponse<Entitlement> | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [userSearch, setUserSearch] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const params: Record<string, string | number> = { page, limit: 20 }
    if (statusFilter) params.status = statusFilter
    if (userSearch.trim()) params.userId = userSearch.trim()
    const res = await api.get('/v1/admin/entitlements', { params })
    setData(res.data)
    setLoading(false)
  }

  useEffect(() => { load() }, [page, statusFilter])

  const handleSearch = () => { setPage(1); load() }

  const handleCreate = async (formData: { userId: string; key: string; expiresAt?: string }) => {
    await api.post('/v1/admin/entitlements', formData)
    toast.success('Entitlement created')
    setShowModal(false)
    load()
  }

  const handleRevoke = async (id: string) => {
    if (!confirm('Revoke this entitlement? The user will lose access immediately.')) return
    await api.post(`/v1/admin/entitlements/${id}/revoke`)
    toast.success('Entitlement revoked')
    load()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Entitlements</h1>
        <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setShowModal(true)}>Add Entitlement</Button>
      </div>

      <div className="flex flex-wrap items-center gap-4 mb-4">
        <Tabs tabs={statusTabs} activeTab={statusFilter} onChange={(v) => { setStatusFilter(v); setPage(1) }} />
        <div className="flex items-center gap-2 ml-auto">
          <div className="w-64">
            <Input placeholder="Search by User ID..." value={userSearch} onChange={(e) => setUserSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
          </div>
          <Button size="sm" variant="secondary" onClick={handleSearch} icon={<Search className="w-4 h-4" />}>Search</Button>
        </div>
      </div>

      <Card>
        {loading ? (
          <div className="flex items-center gap-2 text-gray-500 py-4"><Loader2 className="w-5 h-5 animate-spin" /> Loading...</div>
        ) : !data || data.items.length === 0 ? (
          <div className="text-center py-8">
            <Key className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500">No entitlements found</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-500 mb-3">{data.total} total entitlements</p>
            <Table>
              <Thead>
                <tr><Th>User</Th><Th>Key</Th><Th>Source</Th><Th>Status</Th><Th>Expires</Th><Th>Actions</Th></tr>
              </Thead>
              <Tbody>
                {data.items.map((e) => (
                  <tr key={e.id}>
                    <Td className="font-mono text-xs">{e.userId.slice(0, 8)}...</Td>
                    <Td className="font-mono font-semibold">{e.key}</Td>
                    <Td><Badge variant={e.source === 'admin' ? 'warning' : 'default'}>{e.source}</Badge></Td>
                    <Td><Badge>{e.status}</Badge></Td>
                    <Td>{e.expiresAt ? new Date(e.expiresAt).toLocaleDateString() : <span className="text-gray-400">Never</span>}</Td>
                    <Td>
                      {e.status === 'active' && (
                        <Button size="sm" variant="danger" onClick={() => handleRevoke(e.id)}>Revoke</Button>
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

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Create Entitlement">
        <EntitlementForm onSubmit={handleCreate} onCancel={() => setShowModal(false)} />
      </Modal>
    </div>
  )
}
