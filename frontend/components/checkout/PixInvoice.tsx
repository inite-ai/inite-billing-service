'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import QRCode from 'qrcode'
import { AlertTriangle, Check, Loader2, RefreshCw } from 'lucide-react'
import { CopyField } from './CryptoInvoice'

export interface PixPayment {
  type: 'pix'
  /** The PIX "copia e cola" string; the QR code encodes the same text. */
  qrCode: string
  amount: string | null
  currency: 'BRL'
  depositStatus: string
  intentStatus?: string
  rail?: string
}

/** A PIX worth showing again: one that can still be paid, or that was. */
export function showablePix(payment: { type?: string; depositStatus?: string } | null | undefined): payment is PixPayment {
  return !!payment && payment.type === 'pix' && !['EXPIRED', 'FAILED', 'REFUNDED'].includes(String(payment.depositStatus))
}

/**
 * The PIX on the checkout page: a QR code to scan from a bank app and the same
 * code as text to paste, for someone paying on the phone the page is open on.
 * The amount is in the code, so there is nothing to type.
 */
export function PixInvoice({
  payment,
  onRenew,
  renewing,
}: {
  payment: PixPayment
  onRenew: () => void
  renewing: boolean
}) {
  const t = useTranslations('checkout.pix')
  const [qr, setQr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(payment.qrCode, { margin: 1, width: 360, errorCorrectionLevel: 'M' })
      .then((url) => !cancelled && setQr(url))
      .catch(() => !cancelled && setQr(null))
    return () => {
      cancelled = true
    }
  }, [payment.qrCode])

  const paid = payment.intentStatus === 'paid' || ['FIAT_PAID', 'PROCESSING', 'COMPLETED'].includes(payment.depositStatus)
  const expired = ['EXPIRED', 'FAILED'].includes(payment.depositStatus) || payment.intentStatus === 'expired'

  if (paid) {
    return (
      <div className="py-6 text-center" role="status">
        <div className="badge-ic ok">
          <Check className="h-6 w-6" />
        </div>
        <h2 className="text-[26px]">{t('paidTitle')}</h2>
        <p className="mt-1 text-sm text-[color:var(--dim)]">{t('paidHint')}</p>
      </div>
    )
  }

  if (expired) {
    return (
      <div className="py-6 text-center" role="status">
        <div className="badge-ic bad">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h2 className="text-[22px]">{t('expiredTitle')}</h2>
        <p className="mt-1 text-sm text-[color:var(--dim)]">{t('expiredHint')}</p>
        <button type="button" onClick={onRenew} disabled={renewing} className="btn btn-primary mt-5 inline-flex items-center gap-2">
          {renewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {t('renew')}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-5" aria-live="polite">
      <div>
        <h2 className="text-lg font-semibold text-[color:var(--ink)]">{t('title')}</h2>
        <p className="text-sm text-[color:var(--dim)]">{t('hint')}</p>
      </div>
      {payment.amount && (
        <p className="mono text-3xl font-semibold tracking-tight text-[color:var(--ink)]">
          R$ {payment.amount.replace('.', ',')}
        </p>
      )}
      <div className="mx-auto w-fit rounded-2xl bg-white p-3">
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt={t('qrAlt')} width={240} height={240} className="block h-60 w-60" />
        ) : (
          <div className="flex h-60 w-60 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-black/40" />
          </div>
        )}
      </div>
      <CopyField label={t('copyPaste')} value={payment.qrCode} display={<span className="line-clamp-2">{payment.qrCode}</span>} />
      <p className="flex items-center gap-2 text-sm text-[color:var(--dim)]" role="status">
        <Loader2 className="h-4 w-4 animate-spin text-[color:var(--accent)]" />
        {t('waiting')}
      </p>
    </div>
  )
}
