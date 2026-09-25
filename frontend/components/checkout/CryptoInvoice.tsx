'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import QRCode from 'qrcode'
import { AlertTriangle, Check, Copy, ExternalLink, Loader2, RefreshCw, Wallet } from 'lucide-react'

export interface CryptoPayment {
  type: 'crypto'
  invoiceStatus: 'awaiting' | 'confirming' | 'paid' | 'expired' | 'cancelled'
  intentStatus?: string
  chain: string
  chainName: string
  network: string
  token: string
  address: string
  amount: string
  amountRaw: string
  baseAmount: string
  expiresAt: string
  paymentUri: string
  confirmations: number
  requiredConfirmations: number
  txHash: string | null
  txUrl: string | null
}

/**
 * Milliseconds left until the deadline, or null before the first tick — the
 * clock is read only in the browser, so a server render and the first client
 * render agree.
 */
function useCountdown(deadline: string): number | null {
  const target = useMemo(() => new Date(deadline).getTime(), [deadline])
  const [left, setLeft] = useState<number | null>(null)
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, target - Date.now()))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [target])
  return left
}

function formatLeft(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(h ? 2 : 1, '0')
  return h ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${mm}:${String(s).padStart(2, '0')}`
}

function CopyField({
  label,
  value,
  display,
  mono = true,
  large = false,
}: {
  label: string
  value: string
  display?: React.ReactNode
  mono?: boolean
  large?: boolean
}) {
  const t = useTranslations('checkout.crypto')
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard can be refused (insecure context, permissions); the value
      // is on screen and selectable, so there is nothing else to do.
    }
  }
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-slate-400">{label}</p>
      <button
        type="button"
        onClick={copy}
        className="group flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-900/40 px-4 py-3 text-left transition-colors hover:border-violet-400/40"
        aria-label={`${t('copy')}: ${label}`}
      >
        <span
          className={`min-w-0 break-all text-white ${mono ? 'font-mono' : ''} ${large ? 'text-2xl font-semibold tracking-tight' : 'text-sm'}`}
        >
          {display ?? value}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs text-slate-400 group-hover:text-violet-300">
          {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
          <span className="hidden sm:inline">{copied ? t('copied') : t('copy')}</span>
        </span>
      </button>
    </div>
  )
}

/**
 * The crypto invoice on the checkout page.
 *
 * The one thing a customer must get right is the amount: the last digits are
 * what identifies their payment, so it is the largest thing on the screen, the
 * identifying digits are set apart, and copying it is one tap. The second is
 * the network — the same token on another chain is money nobody can recover —
 * so it is named in the warning, not just in a badge.
 */
export function CryptoInvoice({
  payment,
  onRenew,
  onChangeNetwork,
  renewing,
}: {
  payment: CryptoPayment
  onRenew: () => void
  onChangeNetwork: () => void
  renewing: boolean
}) {
  const t = useTranslations('checkout.crypto')
  const left = useCountdown(payment.expiresAt)
  const [qr, setQr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(payment.paymentUri, { margin: 1, width: 360, errorCorrectionLevel: 'M' })
      .then((url) => !cancelled && setQr(url))
      .catch(() => !cancelled && setQr(null))
    return () => {
      cancelled = true
    }
  }, [payment.paymentUri])

  const confirming = payment.invoiceStatus === 'confirming' || (payment.txHash && payment.invoiceStatus !== 'paid')
  const paid = payment.invoiceStatus === 'paid' || payment.intentStatus === 'paid'
  const timedOut = left === 0 && !confirming && !paid
  const networkLabel =
    payment.chainName === payment.network ? payment.network : `${payment.chainName} · ${payment.network}`

  // Split the amount so the identifying tail reads as part of the price but
  // cannot be mistaken for rounding noise to leave off.
  const [whole, fraction = ''] = payment.amount.split('.')
  const baseFraction = payment.baseAmount.split('.')[1] ?? ''
  const amountDisplay = (
    <>
      {whole}
      {fraction && (
        <>
          .{fraction.slice(0, Math.max(2, baseFraction.length))}
          <span className="text-violet-300">{fraction.slice(Math.max(2, baseFraction.length))}</span>
        </>
      )}{' '}
      <span className="text-base font-medium text-slate-400">{payment.token}</span>
    </>
  )

  if (paid) {
    return (
      <div className="py-6 text-center" role="status">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/10">
          <Check className="h-7 w-7 text-emerald-400" />
        </div>
        <h2 className="text-xl font-semibold text-white">{t('paidTitle')}</h2>
        <p className="mt-1 text-sm text-slate-400">{t('paidHint')}</p>
        {payment.txUrl && (
          <a
            href={payment.txUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 text-sm text-violet-300 hover:text-violet-200"
          >
            {t('viewTransaction')} <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    )
  }

  if (confirming) {
    const done = Math.min(payment.confirmations, payment.requiredConfirmations)
    const pct = Math.round((done / Math.max(1, payment.requiredConfirmations)) * 100)
    return (
      <div className="py-4" role="status" aria-live="polite">
        <div className="mb-5 flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-violet-400" />
          <div>
            <h2 className="text-lg font-semibold text-white">{t('confirmingTitle')}</h2>
            <p className="text-sm text-slate-400">{t('confirmingHint', { network: payment.chainName })}</p>
          </div>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-700/60">
          <div className="h-full rounded-full bg-violet-500 transition-all duration-700" style={{ width: `${Math.max(pct, 8)}%` }} />
        </div>
        <p className="mt-2 text-xs tabular-nums text-slate-400">
          {t('confirmations', { done, required: payment.requiredConfirmations })}
        </p>
        {payment.txUrl && (
          <a
            href={payment.txUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 text-sm text-violet-300 hover:text-violet-200"
          >
            {t('viewTransaction')} <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">{t('sendTitle', { token: payment.token })}</h2>
          <p className="mt-0.5 text-sm text-slate-400">
            {t('network')}: <span className="font-medium text-white">{networkLabel}</span>
          </p>
        </div>
        <div
          className={`shrink-0 rounded-lg px-2.5 py-1 font-mono text-sm tabular-nums ${
            timedOut ? 'bg-amber-500/15 text-amber-300' : 'bg-slate-700/50 text-slate-200'
          }`}
          aria-label={t('timeLeft')}
        >
          {timedOut ? t('timeUp') : left === null ? '–:––' : formatLeft(left)}
        </div>
      </div>

      <CopyField label={t('exactAmount')} value={payment.amount} display={amountDisplay} large />
      <p className="-mt-3 text-xs text-slate-400">{t('exactAmountHint')}</p>

      <div className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-start">
        <CopyField label={t('address')} value={payment.address} />
        {qr && (
          <div className="mx-auto sm:mx-0">
            {/* eslint-disable-next-line @next/next/no-img-element -- a generated data: URL, not an asset to optimise */}
            <img
              src={qr}
              alt={t('qrAlt', { network: payment.chainName })}
              width={132}
              height={132}
              className="rounded-xl bg-white p-1.5"
            />
          </div>
        )}
      </div>

      <div className="flex gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3.5 text-sm text-amber-100">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <p>
          {t('networkWarning', {
            token: payment.token,
            network: payment.chainName === payment.network ? payment.network : `${payment.chainName} (${payment.network})`,
          })}
        </p>
      </div>

      {timedOut ? (
        <div className="space-y-3 rounded-xl border border-white/10 bg-slate-900/40 p-4">
          <p className="text-sm text-slate-300">{t('timeUpHint')}</p>
          <button
            type="button"
            onClick={onRenew}
            disabled={renewing}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {renewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {t('newInvoice')}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2.5 text-sm text-slate-400" role="status" aria-live="polite">
          <Loader2 className="h-4 w-4 animate-spin text-violet-400" />
          {t('waiting')}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-4">
        {payment.chain !== 'TRON' ? (
          <a
            href={payment.paymentUri}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-violet-300 hover:text-violet-200"
          >
            <Wallet className="h-4 w-4" /> {t('openWallet')}
          </a>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={onChangeNetwork}
          className="text-sm text-slate-400 underline-offset-4 hover:text-white hover:underline"
        >
          {t('changeNetwork')}
        </button>
      </div>
    </div>
  )
}
