'use client'

import { useCallback, useEffect, useState } from 'react'
import Image from 'next/image'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import QRCode from 'qrcode'
import { Loader2 } from 'lucide-react'
import { API_URL } from '@/lib/config'
import { LedgerShell } from '@/components/ledger/LedgerShell'
import { CopyField } from '@/components/checkout/CryptoInvoice'
import { PixInvoice, type PixPayment } from '@/components/checkout/PixInvoice'

interface Wallet {
  address: string
  balance: string | null
  owner: 'agent' | 'person'
  pix: boolean
}

interface Topup {
  id: string
  amount: string
  status: string
  qrCode: string | null
}

const DEPOSIT: Record<string, string> = {
  pending: 'PENDING',
  paid: 'FIAT_PAID',
  completed: 'COMPLETED',
  expired: 'EXPIRED',
  failed: 'FAILED',
  refunded: 'REFUNDED',
}

/**
 * Funding an INITE wallet by its address: the link an AI agent hands a
 * person ("top up my wallet"). USDC on Base from any wallet or exchange, or
 * PIX in reais that arrives as USDC. Nothing here can take money out.
 */
export default function FundPage() {
  const t = useTranslations('fund')
  const { address } = useParams<{ address: string }>()
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [missing, setMissing] = useState(false)
  const [qr, setQr] = useState<string | null>(null)
  const [amount, setAmount] = useState('50')
  const [topup, setTopup] = useState<Topup | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const base = `${API_URL}/v1/public/fund/${encodeURIComponent(address)}`

  const load = useCallback(async () => {
    const res = await fetch(base, { cache: 'no-store' })
    if (res.status === 404) return setMissing(true)
    if (res.ok) setWallet(await res.json())
  }, [base])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!wallet) return
    QRCode.toDataURL(`ethereum:${wallet.address}@8453`, { margin: 1, width: 320 })
      .then(setQr)
      .catch(() => setQr(null))
  }, [wallet])

  // A PIX top-up: ask until it is paid, then refresh the balance.
  useEffect(() => {
    if (!topup || !['pending', 'paid'].includes(topup.status)) return
    const timer = setInterval(async () => {
      const res = await fetch(`${base}/topups/${topup.id}`, { cache: 'no-store' })
      if (!res.ok) return
      const next = (await res.json()) as Topup
      setTopup((prev) => ({ ...next, qrCode: next.qrCode ?? prev?.qrCode ?? null }))
      if (next.status === 'completed') void load()
    }, 5000)
    return () => clearInterval(timer)
  }, [topup, base, load])

  const startPix = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`${base}/pix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.message ?? t('pixFailed'))
      setTopup(body)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('pixFailed'))
    } finally {
      setBusy(false)
    }
  }

  if (missing) {
    return (
      <LedgerShell>
        <h1 className="text-xl font-semibold">{t('notFound')}</h1>
      </LedgerShell>
    )
  }
  if (!wallet) {
    return (
      <LedgerShell>
        <Loader2 className="h-5 w-5 animate-spin" />
      </LedgerShell>
    )
  }

  const pixPayment: PixPayment | null =
    topup?.qrCode && topup
      ? {
          type: 'pix',
          qrCode: topup.qrCode,
          amount: topup.amount,
          currency: 'BRL',
          depositStatus: DEPOSIT[topup.status] ?? 'PENDING',
        }
      : null

  return (
    <LedgerShell>
      <div className="space-y-6">
        <div>
          <p className="text-xs uppercase tracking-wide text-[var(--text-muted,#6b6b6b)]">
            {wallet.owner === 'agent' ? t('agentWallet') : t('personWallet')}
          </p>
          <h1 className="mt-1 text-2xl font-semibold">{t('title')}</h1>
          <p className="mt-2 text-sm opacity-80">{t('lead')}</p>
          <p className="mt-3 text-sm">
            {t('balance')}: <strong>{wallet.balance ?? '—'} USDC</strong>
          </p>
        </div>

        <section className="space-y-3">
          <h2 className="font-medium">{t('usdcTitle')}</h2>
          {qr && (
            <Image src={qr} alt="" width={160} height={160} unoptimized className="rounded-lg border bg-white p-1" />
          )}
          <CopyField label={t('address')} value={wallet.address} />
          <p className="text-xs opacity-75">{t('usdcWarning')}</p>
        </section>

        {wallet.pix && (
          <section className="space-y-3">
            <h2 className="font-medium">{t('pixTitle')}</h2>
            {pixPayment ? (
              <PixInvoice payment={pixPayment} onRenew={() => setTopup(null)} renewing={false} />
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-sm">
                  {t('pixAmount')}
                  <input
                    className="ml-2 w-28 rounded border px-2 py-1"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(',', '.'))}
                  />
                </label>
                <button className="btn btn-primary" disabled={busy} onClick={startPix}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t('pixButton')}
                </button>
              </div>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <p className="text-xs opacity-75">{t('pixNote')}</p>
          </section>
        )}
      </div>
    </LedgerShell>
  )
}
