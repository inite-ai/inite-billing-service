'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import { ServiceForm } from '@/components/admin/ServiceForm'
import { Plus, Pencil, Trash2, Eye, EyeOff, Server, Loader2, Copy, RefreshCw, Check, Power, PowerOff } from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import { getErrorMessage } from '@/lib/api-error'
import type { Service } from '@/lib/types'
import { PageHeader } from '@/components/ui/PageHeader'
import { ActiveBadge } from '@/components/ui/StatusBadge'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/ui/ErrorState'
import { IconButton } from '@/components/ui/IconButton'

function ApiKeyCell({
  service,
  onRegenerate,
  showLabel,
  hideLabel,
  copyLabel,
  regenerateLabel,
}: {
  service: Service
  onRegenerate: () => void
  showLabel: string
  hideLabel: string
  copyLabel: string
  regenerateLabel: string
}) {
  const [visible, setVisible] = useState(false)
  const [fullKey, setFullKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleReveal = async () => {
    if (visible) {
      setVisible(false)
      return
    }
    if (fullKey) {
      setVisible(true)
      return
    }
    setLoading(true)
    try {
      const res = await api.get(`/v1/admin/services/${service.id}/reveal-key`)
      setFullKey(res.data.apiKey)
      setVisible(true)
    } catch {
      toast.error('Failed to reveal key')
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = async () => {
    const key = fullKey || service.apiKey
    if (!fullKey) {
      try {
        const res = await api.get(`/v1/admin/services/${service.id}/reveal-key`)
        setFullKey(res.data.apiKey)
        await navigator.clipboard.writeText(res.data.apiKey)
      } catch {
        toast.error('Failed to copy key')
        return
      }
    } else {
      await navigator.clipboard.writeText(key)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const displayKey = visible && fullKey ? fullKey : service.apiKey

  return (
    <div className="flex items-center gap-1.5">
      <code className="text-xs bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded font-mono">
        {displayKey}
      </code>
      <IconButton
        onClick={handleReveal}
        label={visible ? hideLabel : showLabel}
        loading={loading}
        icon={visible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      />
      <IconButton
        onClick={handleCopy}
        tone="primary"
        label={copyLabel}
        icon={copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
      />
      <IconButton
        onClick={onRegenerate}
        tone="warning"
        label={regenerateLabel}
        icon={<RefreshCw className="w-3.5 h-3.5" />}
      />
    </div>
  )
}

export default function AdminServicesPage() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const { confirm, DialogElement } = useConfirmDialog()
  const { data: services, loading, error, refetch } = useApiQuery<Service[]>('/v1/admin/services')

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Service | undefined>()

  const handleCreate = async (data: { code: string; name: string }) => {
    await api.post('/v1/admin/services', data)
    toast.success(t('services.created'))
    setShowModal(false)
    refetch()
  }

  const handleUpdate = async (data: { code: string; name: string }) => {
    if (!editing) return
    await api.put(`/v1/admin/services/${editing.id}`, { name: data.name })
    toast.success(t('services.updated'))
    setShowModal(false)
    setEditing(undefined)
    refetch()
  }

  const handleToggleActive = async (id: string, isActive: boolean) => {
    try {
      await api.put(`/v1/admin/services/${id}`, { isActive: !isActive })
      toast.success(isActive ? t('services.deactivated') : t('services.activated'))
      refetch()
    } catch (e) {
      toast.error(getErrorMessage(e, 'Failed to toggle service status'))
    }
  }

  const handleRegenerateKey = async (id: string) => {
    // Every external module authenticating with the old key stops working the
    // moment this returns, so the dialog says whose key it is.
    const service = (services || []).find((s) => s.id === id)
    const ok = await confirm({
      title: t('services.regenerateConfirm'),
      message: t('services.regenerateConfirm'),
      record: service ? `${service.name} · ${service.code}` : id,
      variant: 'danger',
    })
    if (!ok) return
    try {
      await api.post(`/v1/admin/services/${id}/regenerate-key`)
      toast.success(t('services.keyRegenerated'))
      refetch()
    } catch (e) {
      toast.error(getErrorMessage(e, 'Failed to regenerate key'))
    }
  }

  const handleDelete = async (id: string) => {
    const service = (services || []).find((s) => s.id === id)
    const ok = await confirm({
      title: t('services.deleteConfirm'),
      message: t('services.deleteConfirm'),
      record: service ? `${service.name} · ${service.code}` : id,
      variant: 'danger',
    })
    if (!ok) return
    try {
      await api.delete(`/v1/admin/services/${id}`)
      toast.success(t('services.deleted'))
      refetch()
    } catch (e) {
      toast.error(getErrorMessage(e, t('services.deleteError')))
    }
  }

  return (
    <div>
      <PageHeader
        title={t('services.title')}
        subtitle={t('services.subtitle')}
        actions={
    <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => { setEditing(undefined); setShowModal(true) }}>
              {t('services.addService')}
            </Button>
        }
      />
      <Card>
        {loading ? (
          <TableSkeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : !services || services.length === 0 ? (
          <EmptyState icon={Server} title={t('services.noServices')} subtitle={t('services.noServicesHint')} />
        ) : (
          <Table>
            <Thead>
              <tr><Th>{t('services.tableCode')}</Th><Th>{t('services.tableName')}</Th><Th>{t('services.tableApiKey')}</Th><Th>{t('services.tableStatus')}</Th><Th>{t('services.tableCreated')}</Th><Th>{t('services.tableActions')}</Th></tr>
            </Thead>
            <Tbody>
              {services.map((s) => (
                <tr key={s.id}>
                  <Td className="font-mono font-semibold">{s.code}</Td>
                  <Td>{s.name}</Td>
                  <Td><ApiKeyCell
                      service={s}
                      onRegenerate={() => handleRegenerateKey(s.id)}
                      showLabel={tc('show')}
                      hideLabel={tc('hide')}
                      copyLabel={tc('copy')}
                      regenerateLabel={t('services.regenerateKey')}
                    /></Td>
                  <Td><ActiveBadge active={s.isActive} /></Td>
                  <Td>{new Date(s.createdAt).toLocaleDateString()}</Td>
                  <Td>
                    <div className="flex gap-2">
                      <IconButton onClick={() => { setEditing(s); setShowModal(true) }} tone="primary" label={tc('edit')} icon={<Pencil className="w-4 h-4" />} />
                      {/* One tone per outcome: this control used to be green
                          when active and hover-yellow, which read as a warning
                          about the thing it was reporting as healthy. */}
                      <IconButton
                        onClick={() => handleToggleActive(s.id, s.isActive)}
                        tone={s.isActive ? 'warning' : 'success'}
                        label={s.isActive ? tc('deactivate') : tc('activate')}
                        icon={s.isActive ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
                      />
                      <IconButton
                        onClick={() => handleDelete(s.id)}
                        tone="danger"
                        label={tc('delete')}
                        icon={<Trash2 className="w-4 h-4" />}
                      />
                    </div>
                  </Td>
                </tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Card>

      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditing(undefined) }} title={editing ? t('services.editTitle') : t('services.createTitle')}>
        <ServiceForm initial={editing} onSubmit={editing ? handleUpdate : handleCreate} onCancel={() => { setShowModal(false); setEditing(undefined) }} />
      </Modal>

      {DialogElement}
    </div>
  )
}
