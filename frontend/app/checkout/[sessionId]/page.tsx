'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ArrowRight, Loader2, Tag, Check, X, CreditCard, Lock, Zap, Wallet } from 'lucide-react'
import TokenUSDT from '@web3icons/react/icons/tokens/TokenUSDT'
import TokenUSDC from '@web3icons/react/icons/tokens/TokenUSDC'
import api from '@/lib/api'
import { OAuthClient } from '@/lib/oauth-client'
import toast from 'react-hot-toast'
import RecommendedOffers from '@/components/dashboard/RecommendedOffers'
import { getErrorMessage, getErrorStatus } from '@/lib/api-error'
import { CryptoInvoice, type CryptoPayment } from '@/components/checkout/CryptoInvoice'
import { RedirectWaiting } from '@/components/checkout/RedirectWaiting'
import { CryptoAssetIcon } from '@/components/checkout/CryptoAssetIcon'
import { LedgerShell } from '@/components/ledger/LedgerShell'

interface SessionData {
  sessionId: string
  status: string
  product: {
    name: string
    code: string
    type: string
    description: string | null
  }
  price: {
    code: string
    amount: string
    currency: string
    interval: string | null
  }
  mode: string
  successUrl: string | null
  errorUrl: string | null
  paymentMethods: PaymentMethod[]
  payment?: CryptoPayment | null
  /** A payment the customer is completing on the provider's own page. */
  pending?: { rail: string; status: string; checkoutUrl: string } | null
}

/** The window the provider's payment page opens in, so this page stays put. */
const PAYMENT_WINDOW = 'billing-payment'
const PAYMENT_WINDOW_FEATURES = 'popup,width=520,height=780'
const RETURNED_MESSAGE = 'billing:payment-returned'

interface PaymentOption {
  id: string
  name: string
  /** A crypto network/token, or a way to pay within a rail (lava.top: CARD, SBP, PAYPAL). */
  metadata: { chain?: string; token?: string; chainName?: string; network?: string; method?: string }
}

interface PaymentMethod {
  code: string
  name: string
  supportedModes: string[]
  currencies: string[]
  /** For a rail where the customer picks first — crypto networks. */
  options?: PaymentOption[]
}

/** A crypto invoice worth showing again: one that can still be paid, or that was. */
function showableCrypto(payment: CryptoPayment | null | undefined): payment is CryptoPayment {
  return !!payment && payment.type === 'crypto' && !['cancelled', 'expired'].includes(payment.invoiceStatus)
}

function isSafeRedirect(url: string): boolean {
  if (url.startsWith('/')) return true
  try {
    const parsed = new URL(url)
    return parsed.origin === window.location.origin
  } catch {
    return false
  }
}

interface PromoResult {
  isValid: boolean
  error?: string
  originalAmount: number
  discountAmount: number
  finalAmount: number
  promoCodeName?: string
}

function formatPrice(amount: string | number): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount
  if (isNaN(num)) return String(amount)
  if (num === Math.floor(num)) return num.toString()
  return num.toFixed(2)
}

export default function CheckoutPage() {
  const params = useParams()
  const sessionId = params.sessionId as string
  const t = useTranslations('checkout')
  const methodLabel = (option: PaymentOption) => {
    const key = option.metadata.method
    return key === 'CARD' ? t('methods.card') : key === 'SBP' ? t('methods.sbp') : key === 'PAYPAL' ? t('methods.paypal') : option.name
  }

  const [session, setSession] = useState<SessionData | null>(null)
  const [loading, setLoading] = useState(true)
  // The three states this page can end in, each one a translation key. It was
  // `string`, cast to `any` at the call site — so a typo would have rendered
  // the key itself and nothing would have complained.
  const [error, setError] = useState<'alreadyPaid' | 'sessionExpired' | 'sessionNotFound' | null>(
    null,
  )

  // Promo
  const [promoCode, setPromoCode] = useState('')
  const [promoLoading, setPromoLoading] = useState(false)
  const [promoResult, setPromoResult] = useState<PromoResult | null>(null)

  // Payment
  const [selectedRail, setSelectedRail] = useState('')
  const [selectedOption, setSelectedOption] = useState('')
  const [payLoading, setPayLoading] = useState(false)
  // An open crypto invoice replaces the form: there is no page to redirect to.
  const [payment, setPayment] = useState<CryptoPayment | null>(null)
  // A payment on the provider's page (lava.top, Stripe, …): this page waits
  // behind it and checks with the provider until it settles.
  const [redirect, setRedirect] = useState<{ url: string; windowOpened: boolean } | null>(null)
  const [redirectOutcome, setRedirectOutcome] = useState<'paid' | 'failed' | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    const returned = new URLSearchParams(window.location.search).get('returned') === '1'
    // Back from the provider inside the payment window: tell the checkout page
    // that opened it, and close. If there is no such page (a full redirect),
    // carry on and show the result here.
    if (returned && window.opener && window.name === PAYMENT_WINDOW) {
      try {
        window.opener.postMessage({ type: RETURNED_MESSAGE, sessionId }, window.location.origin)
        window.close()
      } catch {
        // The opener is gone or elsewhere; this page handles it instead.
      }
    }

    async function fetchSession() {
      try {
        const res = returned
          ? await api.post(`/v1/checkout/sessions/${sessionId}/refresh`)
          : await api.get(`/v1/checkout/sessions/${sessionId}`)
        const data: SessionData = res.data
        setSession(data)

        if (returned && data.status === 'paid') {
          setRedirect({ url: '', windowOpened: false })
          setRedirectOutcome('paid')
          return
        }
        if (data.pending && ['created', 'open'].includes(data.status)) {
          setRedirect({ url: data.pending.checkoutUrl, windowOpened: false })
          return
        }

        // A crypto invoice under way — or just paid — is shown again after a
        // reload instead of the form, whatever the order status says.
        if (showableCrypto(data.payment) && ['created', 'open', 'paid'].includes(data.status)) {
          setPayment({ ...data.payment, intentStatus: data.status === 'paid' ? 'paid' : data.payment.intentStatus })
          const crypto = data.paymentMethods.find((m) => m.code === 'CRYPTO')
          if (crypto) setSelectedRail('CRYPTO')
          setSelectedOption(`${data.payment.chain}_${data.payment.token}`)
          return
        }

        if (data.status === 'paid') {
          setError('alreadyPaid')
          return
        }
        if (data.status !== 'created') {
          setError('sessionExpired')
          return
        }

        if (data.paymentMethods.length > 0) {
          const first = data.paymentMethods[0]
          setSelectedRail(first.code)
          if (first.options?.length) setSelectedOption(first.options[0].id)
        }
      } catch (e) {
        if (getErrorStatus(e) === 401) {
          // Not authenticated — auto-trigger OAuth silently
          sessionStorage.setItem('returnTo', `/checkout/${sessionId}`)
          OAuthClient.login()
          return
        }
        // Anything else — missing, forbidden, or a server error — reads the
        // same to someone holding a checkout link: this session is not usable.
        setError('sessionNotFound')
      } finally {
        setLoading(false)
      }
    }
    fetchSession()
  }, [sessionId])

  // While a crypto invoice is open, watch it: the chain is checked on the
  // server every half minute, and this picks the result up.
  const waitingForChain = !!payment && payment.invoiceStatus !== 'paid' && payment.intentStatus !== 'paid'
  useEffect(() => {
    if (!waitingForChain) return
    const id = setInterval(async () => {
      try {
        const res = await api.get(`/v1/checkout/sessions/${sessionId}`)
        const data: SessionData = res.data
        if (showableCrypto(data.payment)) {
          setPayment({ ...data.payment, intentStatus: data.status === 'paid' ? 'paid' : data.payment.intentStatus })
        }
      } catch {
        // A missed poll is retried on the next tick.
      }
    }, 8000)
    return () => clearInterval(id)
  }, [waitingForChain, sessionId])

  // Ask the provider (through the server) whether the payment went through.
  const checkRedirect = useCallback(async () => {
    setChecking(true)
    try {
      const res = await api.post(`/v1/checkout/sessions/${sessionId}/refresh`)
      const data: SessionData = res.data
      if (data.status === 'paid') setRedirectOutcome('paid')
      else if (['failed', 'expired'].includes(data.status)) setRedirectOutcome('failed')
    } catch {
      // Asked again on the next tick.
    } finally {
      setChecking(false)
    }
  }, [sessionId])

  const waitingForProvider = !!redirect && !redirectOutcome
  useEffect(() => {
    if (!waitingForProvider) return
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void checkRedirect()
    }, 5000)
    // The payment window reports back the moment the customer returns to it;
    // a customer who paid in another tab is caught when they come back here.
    const onMessage = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.data?.type === RETURNED_MESSAGE) void checkRedirect()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkRedirect()
    }
    window.addEventListener('message', onMessage)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      window.removeEventListener('message', onMessage)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [waitingForProvider, checkRedirect])

  const reopenPaymentWindow = () => {
    if (!redirect?.url) return
    const opened = window.open(redirect.url, PAYMENT_WINDOW, PAYMENT_WINDOW_FEATURES)
    if (opened) setRedirect({ ...redirect, windowOpened: true })
    else window.location.assign(redirect.url)
  }

  // Paid: show the confirmation for a moment, then go where the merchant asked.
  const paidNow =
    (!!payment && (payment.invoiceStatus === 'paid' || payment.intentStatus === 'paid')) ||
    redirectOutcome === 'paid'
  useEffect(() => {
    if (!paidNow || !session) return
    const target = session.successUrl && isSafeRedirect(session.successUrl) ? session.successUrl : '/orders'
    const id = setTimeout(() => {
      window.location.href = target
    }, 2500)
    return () => clearTimeout(id)
  }, [paidNow, session])

  const handleApplyPromo = async () => {
    if (!promoCode.trim() || !session) return
    setPromoLoading(true)
    try {
      const res = await api.post('/v1/checkout/validate-promo', {
        promoCode: promoCode.trim(),
        priceCode: session.price.code,
      })
      if (res.data.isValid) {
        setPromoResult(res.data)
        toast.success(t('promoApplied'))
      } else {
        const errorCode = res.data.errorCode || res.data.error
        const errorMessages: Record<string, string> = {
          not_found: t('promoNotFound'),
          inactive: t('promoInactive'),
          expired: t('promoExpired'),
          not_yet_valid: t('promoNotYetValid'),
          usage_limit_reached: t('promoUsageLimitReached'),
          per_user_limit_reached: t('promoPerUserLimitReached'),
          wrong_service: t('promoWrongService'),
          min_purchase_not_met: t('promoMinPurchase'),
        }
        toast.error(errorMessages[errorCode] || t('promoInvalid'))
        setPromoResult(null)
      }
    } catch (e) {
      toast.error(getErrorMessage(e, t('promoInvalid')))
      setPromoResult(null)
    } finally {
      setPromoLoading(false)
    }
  }

  const clearPromo = () => {
    setPromoCode('')
    setPromoResult(null)
  }

  const finalAmount = promoResult
    ? promoResult.finalAmount
    : parseFloat(session?.price.amount || '0')
  const isFree = finalAmount === 0

  const selectedMethod = session?.paymentMethods.find((m) => m.code === selectedRail)
  const needsOption = !isFree && !!selectedMethod?.options?.length
  const chosenOption = selectedMethod?.options?.find((o) => o.id === selectedOption)

  const handlePay = async () => {
    if (!session) return
    if (!isFree && !selectedRail) return
    if (needsOption && !chosenOption) return

    setPayLoading(true)
    // Opened now, inside the click, or the browser blocks it; pointed at the
    // provider once the server has made the payment. Not for crypto, which
    // has no page to go to, nor for a free order.
    const paymentWindow =
      !isFree && selectedRail !== 'CRYPTO' ? window.open('', PAYMENT_WINDOW, PAYMENT_WINDOW_FEATURES) : null
    try {
      const payload: Record<string, unknown> = {}
      if (!isFree && selectedRail) {
        payload.rail = selectedRail
      }
      if (needsOption && chosenOption) {
        if (chosenOption.metadata.chain) {
          payload.cryptoChain = chosenOption.metadata.chain
          payload.cryptoToken = chosenOption.metadata.token
        } else if (chosenOption.metadata.method) {
          payload.method = chosenOption.metadata.method
        }
      }
      if (promoResult?.isValid && promoCode.trim()) {
        payload.promoCode = promoCode.trim()
      }

      const res = await api.post(`/v1/checkout/sessions/${sessionId}/pay`, payload)

      if (res.data.payment?.type === 'crypto') {
        paymentWindow?.close()
        setPayment(res.data.payment)
        setPayLoading(false)
        return
      }

      if (res.data.checkoutUrl) {
        if (paymentWindow && !paymentWindow.closed) {
          paymentWindow.location.replace(res.data.checkoutUrl)
          setRedirect({ url: res.data.checkoutUrl, windowOpened: true })
          setPayLoading(false)
        } else {
          // Popup blocked: the ordinary redirect, and the provider sends the
          // customer back here to finish.
          window.location.assign(res.data.checkoutUrl)
        }
      } else {
        paymentWindow?.close()
        // Free order fulfilled — go to orders
        toast.success(t('promoApplied'))
        const successTarget = session.successUrl && isSafeRedirect(session.successUrl) ? session.successUrl : '/orders'
        window.location.assign(successTarget)
      }
    } catch (e) {
      paymentWindow?.close()
      toast.error(getErrorMessage(e, 'Payment failed'))
      setPayLoading(false)
    }
  }

  const getIntervalLabel = (interval: string | null) => {
    if (!interval) return t('oneTime')
    if (interval === 'month') return t('monthly')
    if (interval === 'year') return t('yearly')
    return interval
  }

  // --- Render ---

  const secureFooter = (
    <>
      <Lock className="h-3 w-3" aria-hidden />
      {t('securePayment')}
    </>
  )

  if (loading) {
    return (
      <LedgerShell>
        <p className="mono flex items-center gap-2.5 text-[13px] text-[color:var(--dim)]" role="status">
          <Loader2 className="h-4 w-4 animate-spin text-[color:var(--accent)]" />
          {t('processing')}
        </p>
      </LedgerShell>
    )
  }

  if (error) {
    return (
      <LedgerShell>
        <div className="panel rise w-full max-w-[420px] p-9 text-center" role="alert">
          <div className={`badge-ic ${error === 'alreadyPaid' ? 'ok' : 'bad'}`}>
            {error === 'alreadyPaid' ? <Check className="h-6 w-6" /> : <X className="h-6 w-6" />}
          </div>
          <h1 className="text-[28px]">{t(error)}</h1>
          {error === 'alreadyPaid' ? (
            <a href="/orders" className="link mono mt-6 inline-block text-[13px]">
              /orders →
            </a>
          ) : (
            session?.errorUrl &&
            isSafeRedirect(session.errorUrl) && (
              <a href={session.errorUrl} className="link mt-6 inline-block text-sm">
                {t('goBack')}
              </a>
            )
          )}
        </div>
      </LedgerShell>
    )
  }

  if (!session) return null

  const currency = session.price.currency
  const formStage = !redirect && !payment

  return (
    <LedgerShell footer={secureFooter}>
      <div className="grid w-full max-w-[980px] gap-4 md:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] md:items-start md:gap-5">
        {/* The receipt: what is being bought, and what it costs. */}
        <aside className="receipt rise d1">
          <div className="rc-top sm:!px-5">
            <span className="path">
              {t('order')} <span>#{sessionId.slice(0, 8)}</span>
            </span>
            {!paidNow && (
              <span className="live">
                <i />
                {t('pay_step')}
              </span>
            )}
          </div>
          <div className="mesh px-4 pb-3 pt-6 sm:px-5">
            <p className="eyebrow mb-3">
              <span className="dot">●</span> {t('product')}
            </p>
            <h1 className="text-[30px] sm:text-[36px]">{session.product.name}</h1>
            {session.product.description && (
              <p className="mt-3 text-sm leading-relaxed text-[color:var(--dim)]">{session.product.description}</p>
            )}
          </div>
          <div className="rc-body sm:!px-5">
            <div className="rc-line">
              <span className="k">{t('interval')}</span>
              <span className="v">{getIntervalLabel(session.price.interval)}</span>
            </div>
            <div className="rc-line">
              <span className="k">{promoResult?.isValid ? t('originalPrice') : t('price')}</span>
              <span className="v">
                {formatPrice(session.price.amount)} {currency}
              </span>
            </div>
            {promoResult?.isValid && (
              <div className="rc-line">
                <span className="k">
                  {t('discount')}
                  {promoResult.promoCodeName ? ` · ${promoResult.promoCodeName}` : ''}
                </span>
                <span className="v ok">
                  −{formatPrice(promoResult.discountAmount)} {currency}
                </span>
              </div>
            )}
          </div>
          <div className="px-4 pb-5 pt-4 sm:px-5">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-sm text-[color:var(--dim)]">{t('youPay')}</span>
              <span className="text-right font-[family-name:var(--display)] text-[34px] font-bold leading-none tracking-[-0.02em]">
                {isFree ? (
                  <span className="text-[color:var(--accent)]">{t('free')}</span>
                ) : (
                  <>
                    {formatPrice(finalAmount)}{' '}
                    <span className="mono text-base font-medium text-[color:var(--dim)]">{currency}</span>
                  </>
                )}
              </span>
            </div>

            {formStage && (
              <div className="mt-5 border-t border-dashed border-[color:var(--line)] pt-4">
                <label htmlFor="promo" className="eyebrow mb-2 flex items-center gap-1.5">
                  <Tag className="h-3 w-3" aria-hidden />
                  {t('promoCode')}
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      id="promo"
                      type="text"
                      value={promoCode}
                      onChange={(e) => {
                        setPromoCode(e.target.value.toUpperCase())
                        if (promoResult) setPromoResult(null)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleApplyPromo()
                      }}
                      placeholder="PROMO2026"
                      disabled={!!promoResult?.isValid}
                      className="field"
                    />
                    {promoResult?.isValid && (
                      <button
                        type="button"
                        onClick={clearPromo}
                        aria-label={t('removePromo')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[color:var(--dim)] transition-colors hover:text-[color:var(--ink)]"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleApplyPromo}
                    disabled={!promoCode.trim() || !!promoResult?.isValid || promoLoading}
                    className="btn ghost"
                  >
                    {promoLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : promoResult?.isValid ? (
                      <Check className="h-4 w-4 text-[color:var(--accent)]" />
                    ) : (
                      t('applyPromo')
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
          {paidNow && (
            <div className="stamp" style={{ top: 58, bottom: 'auto' }}>
              {t('paidStamp')}
            </div>
          )}
        </aside>

        {/* The payment: pick a way, then pay, wait for the provider, or send crypto. */}
        <section className="panel rise d2 p-5 sm:p-7">
          {redirect ? (
            <RedirectWaiting
              provider={session.paymentMethods.find((m) => m.code === (session.pending?.rail ?? selectedRail))?.name ?? ''}
              outcome={redirectOutcome}
              checking={checking}
              windowOpened={redirect.windowOpened}
              onReopen={reopenPaymentWindow}
              onCheck={() => void checkRedirect()}
              errorUrl={session.errorUrl && isSafeRedirect(session.errorUrl) ? session.errorUrl : null}
            />
          ) : payment ? (
            <CryptoInvoice
              payment={payment}
              renewing={payLoading}
              onRenew={handlePay}
              onChangeNetwork={() => setPayment(null)}
            />
          ) : (
            <>
              {!isFree && (
                <div className="mb-6">
                  <p className="eyebrow mb-3">
                    <span className="dot">●</span> {t('paymentMethod')}
                  </p>
                  {session.paymentMethods.length === 0 ? (
                    <p className="note err">{t('noPaymentMethods')}</p>
                  ) : (
                    <div className="space-y-2">
                      {session.paymentMethods.map((method) => (
                        <button
                          key={method.code}
                          type="button"
                          aria-pressed={selectedRail === method.code}
                          onClick={() => {
                            setSelectedRail(method.code)
                            // Land on a choice that belongs to this rail, not the last one's.
                            if (!method.options?.some((o) => o.id === selectedOption)) {
                              setSelectedOption(method.options?.[0]?.id ?? '')
                            }
                          }}
                          className="opt"
                        >
                          <span className="radio" aria-hidden />
                          <MethodGlyph code={method.code} />
                          <span className="ui min-w-0 flex-1 truncate text-[15px]">{method.name}</span>
                          <span className="mono shrink-0 text-[11.5px] text-[color:var(--dim)]">
                            {method.options?.length
                              ? method.options[0].metadata.chain
                                ? t('crypto.networks', { count: method.options.length })
                                : method.options.map((o) => methodLabel(o)).join(' · ')
                              : method.currencies.join(', ')}
                          </span>
                        </button>
                      ))}
                      {needsOption && selectedMethod?.options && (
                        <fieldset className="pt-3">
                          <legend className="eyebrow mb-3">
                            {selectedMethod.options[0]?.metadata.chain ? t('crypto.chooseNetwork') : t('methods.choose')}
                          </legend>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {selectedMethod.options.map((option) => (
                              <button
                                key={option.id}
                                type="button"
                                onClick={() => setSelectedOption(option.id)}
                                aria-pressed={selectedOption === option.id}
                                className="opt !py-2.5"
                              >
                                {option.metadata.chain ? (
                                  <>
                                    <CryptoAssetIcon token={option.metadata.token} chain={option.metadata.chain} size={32} />
                                    <span className="min-w-0">
                                      <span className="ui block text-sm">{option.metadata.token}</span>
                                      <span className="block truncate text-xs text-[color:var(--dim)]">
                                        {option.metadata.chainName === option.metadata.network
                                          ? option.metadata.chainName
                                          : `${option.metadata.chainName} · ${option.metadata.network}`}
                                      </span>
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <MethodGlyph method={option.metadata.method} />
                                    <span className="ui text-sm">{methodLabel(option)}</span>
                                  </>
                                )}
                              </button>
                            ))}
                          </div>
                          {/* Roubles by card go through an acquirer for Russian-issued
                              cards; a foreign card hangs there instead of being refused.
                              Found in a live test — say so before the customer tries. */}
                          {chosenOption?.metadata.method === 'CARD' && currency === 'RUB' && (
                            <p className="note warn mt-3 text-xs">{t('methods.rubCardHint')}</p>
                          )}
                        </fieldset>
                      )}
                    </div>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={handlePay}
                disabled={
                  payLoading ||
                  (!isFree && !selectedRail) ||
                  (!isFree && session.paymentMethods.length === 0) ||
                  (needsOption && !chosenOption)
                }
                className="btn acc block"
              >
                {payLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {needsOption ? t('processing') : t('redirecting')}
                  </>
                ) : isFree ? (
                  t('completeOrder')
                ) : (
                  <>
                    {t('pay', { amount: formatPrice(finalAmount), currency })}
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>

              {/* Never distract mid-payment */}
              {!payLoading && <RecommendedOffers sessionId={String(sessionId)} compact />}
            </>
          )}
        </section>
      </div>
    </LedgerShell>
  )
}

/**
 * A rail's or method's mark in the payment list: the stablecoins for crypto,
 * a card, СБП or PayPal glyph for the rest — so the choice reads at a glance.
 */
function MethodGlyph({ code, method }: { code?: string; method?: string }) {
  if (code === 'CRYPTO') {
    return (
      <span className="flex shrink-0 -space-x-2" aria-hidden>
        <TokenUSDT variant="background" size={22} className="rounded-full ring-2 ring-[#141416]" />
        <TokenUSDC variant="background" size={22} className="rounded-full ring-2 ring-[#141416]" />
      </span>
    )
  }
  const Icon = method === 'SBP' ? Zap : method === 'PAYPAL' ? Wallet : CreditCard
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[color:var(--line)] bg-white/[0.04] text-[color:var(--ink)]" aria-hidden>
      <Icon className="h-4 w-4" />
    </span>
  )
}
