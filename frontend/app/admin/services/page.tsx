'use client'

import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import { ServiceForm } from '@/components/admin/ServiceForm'
import { Plus, Pencil, Trash2, Eye, EyeOff, Server, Loader2, Copy, RefreshCw, Check } from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import type { Service } from '@/lib/types'

function ApiKeyCell({ service, onRegenerate }: { service: Service; onRegenerate: () => void }) {
  const [visible, setVisible] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(service.apiKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const masked = service.apiKey.slice(0, 6) + '••••••••' + service.apiKey.slice(-4)

  return (
    <div className="flex items-center gap-1.5">
      <code className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded font-mono">
        {visible ? service.apiKey : masked}
      </code>
      <button onClick={() => setVisible(!visible)} className="text-gray-400 hover:text-gray-600" title={visible ? 'Hide' : 'Show'}>
        {visible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      </button>
      <button onClick={handleCopy} className="text-gray-400 hover:text-blue-500" title="Copy">
        {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
      <button onClick={onRegenerate} className="text-gray-400 hover:text-orange-500" title="Regenerate key">
        <RefreshCw className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

export default function AdminServicesPage() {
  const [services, setServices] = useState<Service[]>([])
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Service | undefined>()
  const [loading, setLoading] = useState(true)

  const load = async () => {
    try {
      const res = await api.get('/v1/admin/services')
      setServices(res.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleCreate = async (data: { code: string; name: string }) => {
    await api.post('/v1/admin/services', data)
    toast.success('Service created')
    setShowModal(false)
    load()
  }

  const handleUpdate = async (data: { code: string; name: string }) => {
    if (!editing) return
    await api.put(`/v1/admin/services/${editing.id}`, { name: data.name })
    toast.success('Service updated')
    setShowModal(false)
    setEditing(undefined)
    load()
  }

  const handleToggleActive = async (id: string, isActive: boolean) => {
    await api.put(`/v1/admin/services/${id}`, { isActive: !isActive })
    toast.success(isActive ? 'Service deactivated' : 'Service activated')
    load()
  }

  const handleRegenerateKey = async (id: string) => {
    if (!confirm('Regenerate API key? The old key will stop working immediately.')) return
    await api.post(`/v1/admin/services/${id}/regenerate-key`)
    toast.success('API key regenerated')
    load()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this service? This will fail if products or referral levels exist for it.')) return
    try {
      await api.delete(`/v1/admin/services/${id}`)
      toast.success('Service deleted')
      load()
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to delete — service may have associated data')
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Services</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Manage application services that billing serves</p>
        </div>
        <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => { setEditing(undefined); setShowModal(true) }}>
          Add Service
        </Button>
      </div>

      <Card>
        {loading ? (
          <div className="flex items-center gap-2 text-gray-500 py-4"><Loader2 className="w-5 h-5 animate-spin" /> Loading...</div>
        ) : services.length === 0 ? (
          <div className="text-center py-8">
            <Server className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500 mb-2">No services configured</p>
            <p className="text-sm text-gray-400">Create a service to start configuring products and referral levels</p>
          </div>
        ) : (
          <Table>
            <Thead>
              <tr><Th>Code</Th><Th>Name</Th><Th>API Key</Th><Th>Status</Th><Th>Created</Th><Th>Actions</Th></tr>
            </Thead>
            <Tbody>
              {services.map((s) => (
                <tr key={s.id}>
                  <Td className="font-mono font-semibold">{s.code}</Td>
                  <Td>{s.name}</Td>
                  <Td><ApiKeyCell service={s} onRegenerate={() => handleRegenerateKey(s.id)} /></Td>
                  <Td><Badge>{s.isActive ? 'active' : 'inactive'}</Badge></Td>
                  <Td>{new Date(s.createdAt).toLocaleDateString()}</Td>
                  <Td>
                    <div className="flex gap-2">
                      <button onClick={() => { setEditing(s); setShowModal(true) }} className="text-gray-400 hover:text-blue-500" title="Edit">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleToggleActive(s.id, s.isActive)} className="text-gray-400 hover:text-yellow-500" title={s.isActive ? 'Deactivate' : 'Activate'}>
                        {s.isActive ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                      <button onClick={() => handleDelete(s.id)} className="text-gray-400 hover:text-red-500" title="Delete">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </Td>
                </tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Card>

      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditing(undefined) }} title={editing ? 'Edit Service' : 'Create Service'}>
        <ServiceForm initial={editing} onSubmit={editing ? handleUpdate : handleCreate} onCancel={() => { setShowModal(false); setEditing(undefined) }} />
      </Modal>
    </div>
  )
}
