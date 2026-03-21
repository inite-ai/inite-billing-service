'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import { ReferralLevelConfig } from '@/components/referrals/ReferralLevelConfig'
import { Plus, Trash2, Pencil, Check, X, GitBranch, Loader2, Zap } from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import type { ReferralLevel, Service } from '@/lib/types'

interface Template {
  key: string
  name: string
  description: string
  totalRate: number
  levels: { level: number; rate: number; name: string; criteria?: Record<string, any> }[]
}

export default function AdminReferralConfigPage() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')

  const [levels, setLevels] = useState<ReferralLevel[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [filterService, setFilterService] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const [templates, setTemplates] = useState<Template[]>([])
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

  const loadTemplates = async () => {
    try {
      const res = await api.get('/v1/admin/referral-templates')
      setTemplates(res.data)
      setShowTemplates(true)
    } catch {
      toast.error(t('referralConfig.templateLoadError'))
    }
  }

  const handleApplyTemplate = async (templateKey: string) => {
    if (!filterService) {
      toast.error(t('referralConfig.templateSelectServiceError'))
      return
    }
    if (!confirm(t('referralConfig.applyConfirm'))) return
    try {
      await api.post('/v1/admin/referral-templates/apply', {
        serviceId: filterService,
        templateKey,
      })
      toast.success(t('referralConfig.templateApplied'))
      setShowTemplates(false)
      load()
    } catch (e: any) {
      toast.error(e.response?.data?.message || t('referralConfig.templateApplyError'))
    }
  }

  const handleCreate = async (data: { serviceId: string; level: number; commissionRate: number; name: string }) => {
    await api.post('/v1/admin/referral-levels', data)
    toast.success(t('referralConfig.levelCreated'))
    setShowModal(false)
    load()
  }

  const handleDelete = async (id: string) => {
    if (!confirm(t('referralConfig.deleteConfirm'))) return
    try {
      await api.delete(`/v1/admin/referral-levels/${id}`)
      toast.success(t('referralConfig.levelDeleted'))
      load()
    } catch (e: any) {
      toast.error(e.response?.data?.message || t('referralConfig.levelDeleteError'))
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
      toast.success(t('referralConfig.levelUpdated'))
      setEditingId(null)
      load()
    } catch {
      toast.error(t('referralConfig.levelUpdateError'))
    }
  }

  const filteredLevels = filterService ? levels.filter((l) => l.serviceId === filterService) : levels
  const nextLevel = filteredLevels.length > 0 ? Math.max(...filteredLevels.map((l) => l.level)) + 1 : 1
  const totalRate = filteredLevels.reduce((s, l) => s + Number(l.commissionRate), 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('referralConfig.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('referralConfig.subtitle')}</p>
        </div>
        <div className="flex gap-3">
          {services.length > 0 && (
            <div className="w-48">
              <Select value={filterService} onChange={(e) => setFilterService(e.target.value)} options={[
                { value: '', label: t('referralConfig.allServices') },
                ...services.map((s) => ({ value: s.id, label: s.name })),
              ]} />
            </div>
          )}
          <Button size="sm" variant="secondary" icon={<Zap className="w-4 h-4" />} onClick={loadTemplates}>{t('referralConfig.templates')}</Button>
          <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setShowModal(true)}>{t('referralConfig.addLevel')}</Button>
        </div>
      </div>

      {/* Total Rate Summary */}
      {filteredLevels.length > 0 && (
        <Card className="mb-4" variant={totalRate > 0.5 ? 'warning' : 'info'}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GitBranch className="w-5 h-5 text-violet-500" />
              <span className="font-semibold text-gray-900 dark:text-white">
                {t('referralConfig.levelsConfigured', { count: filteredLevels.length })}
              </span>
            </div>
            <span className="text-lg font-bold text-gray-900 dark:text-white">
              {t('referralConfig.totalRate', { rate: (totalRate * 100).toFixed(1) })}
            </span>
          </div>
        </Card>
      )}

      <Card>
        {loading ? (
          <div className="flex items-center gap-2 text-gray-500 py-4"><Loader2 className="w-5 h-5 animate-spin" /> {tc('loading')}</div>
        ) : filteredLevels.length === 0 ? (
          <div className="text-center py-8">
            <GitBranch className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500 mb-2">{t('referralConfig.noLevels')}</p>
            <p className="text-sm text-gray-400">{t('referralConfig.noLevelsHint')}</p>
          </div>
        ) : (
          <Table>
            <Thead>
              <tr><Th>{t('referralConfig.tableLevel')}</Th><Th>{t('referralConfig.tableService')}</Th><Th>{t('referralConfig.tableName')}</Th><Th>{t('referralConfig.tableRate')}</Th><Th>{t('referralConfig.tableQualification')}</Th><Th>{t('referralConfig.tableStatus')}</Th><Th>{t('referralConfig.tableActions')}</Th></tr>
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
                  <Td>
                    {(() => {
                      const c = l.qualificationCriteria
                      if (!c || Object.keys(c).length === 0) return <span className="text-gray-400 text-xs">{t('referralConfig.qualNone')}</span>
                      const parts: string[] = []
                      if (c.minDirectReferrals) parts.push(t('referralConfig.qualRefs', { count: c.minDirectReferrals }))
                      if (c.minActiveReferrals) parts.push(t('referralConfig.qualActive', { count: c.minActiveReferrals }))
                      if (c.minPersonalOrders) parts.push(t('referralConfig.qualOrders', { count: c.minPersonalOrders }))
                      if (c.minMonthlyVolume) parts.push(t('referralConfig.qualVolume', { amount: c.minMonthlyVolume }))
                      if (c.personalPurchaseRequired) parts.push(t('referralConfig.qualOwnPurchase'))
                      return <span className="text-xs text-orange-600 dark:text-orange-400">{parts.join(', ')}</span>
                    })()}
                  </Td>
                  <Td><Badge>{l.isActive ? tc('status.active') : tc('status.inactive')}</Badge></Td>
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

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={t('referralConfig.createTitle')}>
        <ReferralLevelConfig services={services} nextLevel={nextLevel} onSubmit={handleCreate} onCancel={() => setShowModal(false)} />
      </Modal>

      {/* Templates Modal */}
      <Modal isOpen={showTemplates} onClose={() => setShowTemplates(false)} title={t('referralConfig.applyTemplateTitle')}>
        <div className="space-y-4">
          {!filterService && (
            <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl text-sm text-yellow-700 dark:text-yellow-400">
              {t('referralConfig.selectServiceFirst')}
            </div>
          )}
          {templates.map((tmpl) => (
            <div key={tmpl.key} className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h4 className="font-semibold text-gray-900 dark:text-white">{tmpl.name}</h4>
                  <p className="text-xs text-gray-500 mt-0.5">{tmpl.description}</p>
                </div>
                <span className="text-lg font-bold text-violet-600 dark:text-violet-400">
                  {(tmpl.totalRate * 100).toFixed(0)}%
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {tmpl.levels.map((lvl) => (
                  <span key={lvl.level} className="text-xs bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 px-2 py-0.5 rounded-full">
                    L{lvl.level}: {(lvl.rate * 100).toFixed(1)}%
                    {lvl.criteria && Object.keys(lvl.criteria).length > 0 && ' *'}
                  </span>
                ))}
              </div>
              <Button
                size="sm"
                onClick={() => handleApplyTemplate(tmpl.key)}
                disabled={!filterService}
                icon={<Zap className="w-4 h-4" />}
                className="w-full"
              >
                {filterService ? t('referralConfig.applyTo', { service: services.find((s) => s.id === filterService)?.name || 'Service' }) : t('referralConfig.selectServicePlaceholder')}
              </Button>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  )
}
