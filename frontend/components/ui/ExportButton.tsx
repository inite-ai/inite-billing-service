'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'
import { useTranslations } from 'next-intl'
import toast from 'react-hot-toast'
import api from '@/lib/api'
import { Button } from '@/components/ui/Button'

interface ExportButtonProps {
  /** Matches the API resource: orders, subscriptions, payouts, affiliates, customers. */
  resource: 'orders' | 'subscriptions' | 'payouts' | 'affiliates' | 'customers'
  /** The list's current query — the export must be the rows on screen, not everything. */
  params: Record<string, string | number>
  disabled?: boolean
}

/**
 * Download the current list as CSV.
 *
 * The active filters and sort are sent with the request, so what lands in the
 * file is the set the operator is looking at. The row count comes back in a
 * header and is reported in the toast: a finance export that silently produced
 * fewer rows than expected is worth noticing before it becomes a spreadsheet.
 *
 * An error response arrives as a Blob because of `responseType`, so the message
 * has to be read back out of it — otherwise the server's explanation (usually
 * "narrow the filter, this matches too many rows") would surface as a blank
 * failure.
 */
export function ExportButton({ resource, params, disabled }: ExportButtonProps) {
  const t = useTranslations('common.export')
  const [busy, setBusy] = useState(false)

  const download = async () => {
    setBusy(true)
    try {
      const res = await api.get(`/v1/admin/export/${resource}`, {
        params,
        responseType: 'blob',
      })

      const disposition = String(res.headers['content-disposition'] || '')
      const filename = disposition.match(/filename="?([^"]+)"?/)?.[1] || `${resource}.csv`
      const rows = Number(res.headers['x-export-rows'] ?? NaN)

      const url = URL.createObjectURL(res.data as Blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)

      toast.success(Number.isFinite(rows) ? t('done', { count: rows }) : t('doneUnknown'))
    } catch (e: unknown) {
      const err = e as { response?: { data?: Blob | { message?: string } } }
      let message = t('failed')
      const data = err.response?.data
      if (data instanceof Blob) {
        try {
          const parsed = JSON.parse(await data.text())
          if (parsed?.message) message = String(parsed.message)
        } catch {
          // Not JSON — keep the generic message.
        }
      } else if (data?.message) {
        message = data.message
      }
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={download}
      loading={busy}
      disabled={disabled || busy}
      icon={<Download className="h-4 w-4" />}
    >
      {t('label')}
    </Button>
  )
}
