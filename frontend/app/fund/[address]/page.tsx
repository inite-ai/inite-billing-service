'use client'

import { useCallback, useEffect, useState } from 'react'
import Image from 'next/image'
import { useParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import QRCode from 'qrcode'
import { Bot, CreditCard, Loader2, Wallet as WalletIcon, Zap } from 'lucide-react'
import TokenUSDC from '@web3icons/react/icons/tokens/TokenUSDC'
import { API_URL } from '@/lib/config'
import { LedgerShell } from '@/components/ledger/LedgerShell'
import { CopyField } from '@/components/checkout/CryptoInvoice'
import { PixInvoice, type PixPayment } from '@/components/checkout/PixInvoice'

interface Wallet {
  address: string
  balance: string | null
  owner: 'agent' | 'person'
  pix: boolean
  /** USD amounts a card top-up can be, when INITE's treasury pays them out. */
  card?: string[]
}

interface Topup {
  id: string
  amount: string
  status: string
  qrCode: string | null
}

type Method = 'usdc' | 'pix' | 'card'

const DEPOSIT: Record<string, string> = {
  pending: 'PENDING',
  paid: 'FIAT_PAID',
  completed: 'COMPLETED',
  expired: 'EXPIRED',
  failed: 'FAILED',
  refunded: 'REFUNDED',
}

const PIX_AMOUNTS = ['50', '100', '250']

/**
 * Funding an INITE wallet by its address: the link an AI agent hands a
 * person ("top up my wallet"). Laid out like the checkout: the wallet on the
 * left as the receipt, the ways to fund it on the right. USDC on Base from
 * any wallet or exchange, or PIX in reais that arrives as USDC. Nothing here
 * can take money out.
 */
export default function FundPage() {
  const t = useTranslations('fund')
  const locale = useLocale()
  const [cardAmount, setCardAmount] = useState('25')
  const { address } = useParams<{ address: string }>()
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [missing, setMissing] = useState(false)
  const [qr, setQr] = useState<string | null>(null)
  const [method, setMethod] = useState<Method>('usdc')
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

  const cardAvailable = !!wallet?.card?.length
  useEffect(() => {
    if (cardAvailable) setMethod((m) => (m === 'usdc' ? 'card' : m))
  }, [cardAvailable])

  useEffect(() => {
    void load()
    // The balance moves when someone sends USDC; keep it current while open.
    const timer = setInterval(() => void load(), 15000)
    return () => clearInterval(timer)
  }, [load])

  const walletAddress = wallet?.address
  useEffect(() => {
    if (!walletAddress) return
    QRCode.toDataURL(`ethereum:${walletAddress}@8453`, { margin: 1, width: 360, errorCorrectionLevel: 'M' })
      .then(setQr)
      .catch(() => setQr(null))
  }, [walletAddress])

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

  // A card top-up is an order on billing's checkout; USDC follows once it is paid.
  const startCard = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`${base}/card`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: cardAmount, locale }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body?.checkoutUrl) throw new Error(body?.message ?? t('cardFailed'))
      window.location.href = body.checkoutUrl
    } catch (e) {
      setError(e instanceof Error ? e.message : t('cardFailed'))
      setBusy(false)
    }
  }

  if (missing) {
    return (
      <LedgerShell>
        <section className="panel rise w-full max-w-[420px] p-9 text-center">
          <h1 className="text-[28px]">{t('notFound')}</h1>
        </section>
      </LedgerShell>
    )
  }
  if (!wallet) {
    return (
      <LedgerShell>
        <Loader2 className="h-6 w-6 animate-spin text-[color:var(--dim)]" />
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
  const short = `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`

  return (
    <LedgerShell>
      <div className="grid w-full max-w-[980px] gap-4 md:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] md:items-start md:gap-5">
        {/* The wallet, as the receipt: whose it is and what it holds. */}
        <aside className="receipt rise d1">
          <div className="rc-top sm:!px-5">
            <span className="path">
              {t('walletLabel')} <span>{short}</span>
            </span>
            <span className="live">
              <i />
              {t('step')}
            </span>
          </div>
          <div className="mesh px-4 pb-3 pt-6 sm:px-5">
            <p className="eyebrow mb-3">
              <span className="dot">●</span> {wallet.owner === 'agent' ? t('agentWallet') : t('personWallet')}
            </p>
            <h1 className="flex items-center gap-3 text-[30px] sm:text-[36px]">
              {wallet.owner === 'agent' ? (
                <Bot className="h-8 w-8 shrink-0 text-[color:var(--accent)]" aria-hidden />
              ) : (
                <WalletIcon className="h-8 w-8 shrink-0 text-[color:var(--accent)]" aria-hidden />
              )}
              {t('title')}
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-[color:var(--dim)]">{t('lead')}</p>
          </div>
          <div className="rc-body sm:!px-5">
            <div className="rc-line">
              <span className="k">{t('network')}</span>
              <span className="v">Base</span>
            </div>
            <div className="rc-line">
              <span className="k">{t('asset')}</span>
              <span className="v">USDC</span>
            </div>
            <div className="rc-line">
              <span className="k">{t('fees')}</span>
              <span className="v ok">{t('feesValue')}</span>
            </div>
          </div>
          <div className="px-4 pb-5 pt-4 sm:px-5">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-sm text-[color:var(--dim)]">{t('balance')}</span>
              <span className="text-right font-[family-name:var(--display)] text-[34px] font-bold leading-none tracking-[-0.02em]">
                {wallet.balance ?? '—'}{' '}
                <span className="mono text-base font-medium text-[color:var(--dim)]">USDC</span>
              </span>
            </div>
          </div>
        </aside>

        {/* The ways to fund it. */}
        <section className="panel rise d2 p-5 sm:p-7">
          {pixPayment ? (
            <PixInvoice payment={pixPayment} onRenew={() => setTopup(null)} renewing={false} />
          ) : (
            <>
              <p className="eyebrow mb-3">
                <span className="dot">●</span> {t('howTitle')}
              </p>
              <div className="mb-6 space-y-2">
                {!!wallet.card?.length && (
                  <button type="button" className="opt" aria-pressed={method === 'card'} onClick={() => setMethod('card')}>
                    <span className="radio" aria-hidden />
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[color:var(--line)] bg-white/[0.04] text-[color:var(--ink)]"
                      aria-hidden
                    >
                      <CreditCard className="h-4 w-4" />
                    </span>
                    <span className="ui min-w-0 flex-1 truncate text-[15px]">{t('cardTitle')}</span>
                    <span className="mono shrink-0 text-[11.5px] text-[color:var(--dim)]">USD</span>
                  </button>
                )}
                <button type="button" className="opt" aria-pressed={method === 'usdc'} onClick={() => setMethod('usdc')}>
                  <span className="radio" aria-hidden />
                  <TokenUSDC variant="background" size={28} className="shrink-0 rounded-full" />
                  <span className="ui min-w-0 flex-1 truncate text-[15px]">{t('usdcTitle')}</span>
                  <span className="mono shrink-0 text-[11.5px] text-[color:var(--dim)]">{t('usdcHint')}</span>
                </button>
                {wallet.pix && (
                  <button type="button" className="opt" aria-pressed={method === 'pix'} onClick={() => setMethod('pix')}>
                    <span className="radio" aria-hidden />
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[color:var(--line)] bg-white/[0.04] text-[color:var(--ink)]"
                      aria-hidden
                    >
                      <Zap className="h-4 w-4" />
                    </span>
                    <span className="ui min-w-0 flex-1 truncate text-[15px]">{t('pixTitle')}</span>
                    <span className="mono shrink-0 text-[11.5px] text-[color:var(--dim)]">BRL</span>
                  </button>
                )}
              </div>

              {method === 'card' ? (
                <div className="space-y-4">
                  <div>
                    <p className="eyebrow mb-3">{t('cardAmount')}</p>
                    <div className="grid grid-cols-4 gap-2">
                      {(wallet.card ?? []).map((a) => (
                        <button
                          key={a}
                          type="button"
                          className="opt !justify-center !py-2"
                          aria-pressed={cardAmount === a}
                          onClick={() => setCardAmount(a)}
                        >
                          <span className="mono text-sm">${a}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <button type="button" className="btn acc block" disabled={busy} onClick={startCard}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t('cardButton', { amount: cardAmount })}
                  </button>
                  {error && <p className="note err">{error}</p>}
                  <p className="text-xs leading-relaxed text-[color:var(--dim)]">{t('cardNote', { amount: cardAmount })}</p>
                </div>
              ) : method === 'usdc' ? (
                <div className="space-y-4">
                  {qr && (
                    <div className="flex justify-center">
                      <Image
                        src={qr}
                        alt={t('qrAlt')}
                        width={200}
                        height={200}
                        unoptimized
                        className="rounded-xl bg-white p-2"
                      />
                    </div>
                  )}
                  <CopyField label={t('address')} value={wallet.address} />
                  <p className="note warn text-xs">{t('usdcWarning')}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <p className="eyebrow mb-3">{t('pixAmount')}</p>
                    <div className="mb-2 flex gap-2">
                      {PIX_AMOUNTS.map((a) => (
                        <button
                          key={a}
                          type="button"
                          className="opt !justify-center !py-2"
                          aria-pressed={amount === a}
                          onClick={() => setAmount(a)}
                        >
                          <span className="mono text-sm">R$ {a}</span>
                        </button>
                      ))}
                    </div>
                    <input
                      className="field"
                      inputMode="decimal"
                      value={amount}
                      aria-label={t('pixAmount')}
                      onChange={(e) => setAmount(e.target.value.replace(',', '.'))}
                    />
                  </div>
                  <button type="button" className="btn acc block" disabled={busy || !amount} onClick={startPix}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t('pixButton', { amount })}
                  </button>
                  {error && <p className="note err">{error}</p>}
                  <p className="text-xs leading-relaxed text-[color:var(--dim)]">{t('pixNote')}</p>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </LedgerShell>
  )
}
