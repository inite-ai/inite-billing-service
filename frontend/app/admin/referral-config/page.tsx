'use client'

import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import { ReferralLevelConfig } from '@/components/referrals/ReferralLevelConfig'
import { Plus, Trash2, Pencil, Check, X, GitBranch, Loader2 } from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import type { ReferralLevel, Service } from '@/lib/types'

export default function AdminReferralConfigPage() {
  const [levels, setLevels] = useState<ReferralLevel[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [filterService, setFilterService] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editRate, setEditRate] = useState('')
  const [editName, setEditName] = useState('')

  const load = async () => {
    const params: Record<string, string> = {}
    if (filterService) params.serviceId = filterService
    const [levelsRes, svcRes] = await Promise.all([
      api.get('/v1/admin/referral-levels', { params }),
      api.get('/v1/admin/services').catch(() => ({ data: [] })),
    ])
    setLevels(levelsRes.data)
    setServices(svcRes.data)
    setLoading(false)
  }

  useEffect(() => { load() }, [filterService])

  const handleCreate = async (data: { serviceId: string; level: number; commissionRate: number; name: string }) => {
    await api.post('/v1/admin/referral-levels', data)
    toast.success('Level created')
    setShowModal(false)
    load()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this referral level? Only the highest level for a service can be deleted.')) return
    try {
      await api.delete(`/v1/admin/referral-levels/${id}`)
      toast.success('Level deleted')
      load()
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to delete')
    }
  }

  const startEdit = (level: ReferralLevel) => {
    setEditingId(level.id)
    setEditRate((Number(level.commissionRate) * 100).toFixed(1))
    setEditName(level.name)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditRate('')
    setEditName('')
  }

  const saveEdit = async () => {
    if (!editingId) return
    try {
      await api.put(`/v1/admin/referral-levels/${editingId}`, {
        commissionRate: parseFloat(editRate) / 100,
        name: editName,
      })
      toast.success('Level updated')
      setEditingId(null)
      load()
    } catch {
      toast.error('Failed to update')
    }
  }

  const filteredLevels = filterService ? levels.filter((l) => l.serviceId === filterService) : levels
  const nextLevel = filteredLevels.length > 0 ? Math.max(...filteredLevels.map((l) => l.level)) + 1 : 1
  const totalRate = filteredLevels.reduce((s, l) => s + Number(l.commissionRate), 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Referral Levels</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Configure multi-level commission rates per service</p>
        </div>
        <div className="flex gap-3">
          {services.length > 0 && (
            <div className="w-48">
              <Select value={filterService} onChange={(e) => setFilterService(e.target.value)} options={[
                { value: '', label: 'All Services' },
                ...services.map((s) => ({ value: s.id, label: s.name })),
              ]} />
            </div>
          )}
          <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setShowModal(true)}>Add Level</Button>
        </div>
      </div>

      {/* Total Rate Summary */}
      {filteredLevels.length > 0 && (
        <Card className="mb-4" variant={totalRate > 0.5 ? 'warning' : 'info'}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GitBranch className="w-5 h-5 text-violet-500" />
              <span className="font-semibold text-gray-900 dark:text-white">
                {filteredLevels.length} level{filteredLevels.length !== 1 ? 's' : ''} configured
              </span>
            </div>
            <span className="text-lg font-bold text-gray-900 dark:text-white">
              Total: {(totalRate * 100).toFixed(1)}%
            </span>
          </div>
        </Card>
      )}

      <Card>
        {loading ? (
          <div className="flex items-center gap-2 text-gray-500 py-4"><Loader2 className="w-5 h-5 animate-spin" /> Loading...</div>
        ) : filteredLevels.length === 0 ? (
          <div className="text-center py-8">
            <GitBranch className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500 mb-2">No referral levels configured</p>
            <p className="text-sm text-gray-400">Select a service and add levels to enable multi-level commissions</p>
          </div>
        ) : (
          <Table>
            <Thead>
              <tr><Th>Level</Th><Th>Service</Th><Th>Name</Th><Th>Commission Rate</Th><Th>Status</Th><Th>Actions</Th></tr>
            </Thead>
            <Tbody>
              {filteredLevels.map((l) => (
                <tr key={l.id}>
                  <Td>
                    <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 font-bold">
                      {l.level}
                    </span>
                  </Td>
                  <Td>{l.service?.name || l.serviceId.slice(0, 8)}</Td>
                  <Td>
                    {editingId === l.id ? (
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="!py-1 !text-sm" />
                    ) : (
                      l.name
                    )}
                  </Td>
                  <Td>
                    {editingId === l.id ? (
                      <div className="flex items-center gap-1">
                        <Input type="number" step="0.1" value={editRate} onChange={(e) => setEditRate(e.target.value)} className="!py-1 !text-sm w-20" />
                        <span className="text-gray-500">%</span>
                      </div>
                    ) : (
                      <span className="font-semibold text-lg">{(Number(l.commissionRate) * 100).toFixed(1)}%</span>
                    )}
                  </Td>
                  <Td><Badge>{l.isActive ? 'active' : 'inactive'}</Badge></Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      {editingId === l.id ? (
                        <>
                          <button onClick={saveEdit} className="text-green-500 hover:text-green-700"><Check className="w-4 h-4" /></button>
                          <button onClick={cancelEdit} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => startEdit(l)} className="text-gray-400 hover:text-blue-500"><Pencil className="w-4 h-4" /></button>
                          <button onClick={() => handleDelete(l.id)} className="text-gray-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                        </>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Card>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Create Referral Level">
        <ReferralLevelConfig services={services} nextLevel={nextLevel} onSubmit={handleCreate} onCancel={() => setShowModal(false)} />
      </Modal>
    </div>
  )
}
