'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { motion } from 'framer-motion'
import { Loader2, Tag, Check, X, CreditCard, Lock, ShoppingBag } from 'lucide-react'
import api from '@/lib/api'
import { OAuthClient } from '@/lib/oauth-client'
import toast from 'react-hot-toast'

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
}

interface PaymentMethod {
  code: string
  name: string
  supportedModes: string[]
  currencies: string[]
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
  const router = useRouter()
  const sessionId = params.sessionId as string
  const t = useTranslations('checkout')

  const [session, setSession] = useState<SessionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Promo
  const [promoCode, setPromoCode] = useState('')
  const [promoLoading, setPromoLoading] = useState(false)
  const [promoResult, setPromoResult] = useState<PromoResult | null>(null)

  // Payment
  const [selectedRail, setSelectedRail] = useState('')
  const [payLoading, setPayLoading] = useState(false)

  useEffect(() => {
    async function fetchSession() {
      try {
        const res = await api.get(`/v1/checkout/sessions/${sessionId}`)
        const data: SessionData = res.data
        setSession(data)

        if (data.status === 'paid') {
          setError('alreadyPaid')
          return
        }
        if (data.status !== 'created') {
          setError('sessionExpired')
          return
        }

        if (data.paymentMethods.length > 0) {
          setSelectedRail(data.paymentMethods[0].code)
        }
      } catch (e: any) {
        if (e.response?.status === 401) {
          // Not authenticated — auto-trigger OAuth silently
          sessionStorage.setItem('returnTo', `/checkout/${sessionId}`)
          OAuthClient.login()
          return
        }
        if (e.response?.status === 404) {
          setError('sessionNotFound')
        } else {
          setError('sessionNotFound')
        }
      } finally {
        setLoading(false)
      }
    }
    fetchSession()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

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
        toast.error(t('promoInvalid'))
        setPromoResult(null)
      }
    } catch {
      toast.error(t('promoInvalid'))
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

  const handlePay = async () => {
    if (!session) return
    if (!isFree && !selectedRail) return

    setPayLoading(true)
    try {
      const payload: Record<string, unknown> = {}
      if (!isFree && selectedRail) {
        payload.rail = selectedRail
      }
      if (promoResult?.isValid && promoCode.trim()) {
        payload.promoCode = promoCode.trim()
      }

      const res = await api.post(`/v1/checkout/sessions/${sessionId}/pay`, payload)

      if (res.data.checkoutUrl) {
        window.location.href = res.data.checkoutUrl
      } else {
        // Free order fulfilled — go to orders
        toast.success(t('promoApplied'))
        window.location.href = session.successUrl || '/orders'
      }
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Payment failed')
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900 flex items-center justify-center p-4">
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-br from-slate-900/95 via-blue-900/90 to-indigo-900/95" />
        </div>
        <div className="relative z-10 flex items-center gap-3 text-white/60">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>{t('processing')}</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900 flex items-center justify-center p-4">
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-br from-slate-900/95 via-blue-900/90 to-indigo-900/95" />
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-violet-500/20 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        </div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative z-10 w-full max-w-md bg-slate-800/50 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl text-center"
        >
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
            <X className="w-7 h-7 text-red-400" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">{t(error as any)}</h2>
          {session?.errorUrl && (
            <button
              onClick={() => window.location.href = session.errorUrl!}
              className="mt-4 text-sm text-violet-400 hover:text-violet-300 underline"
            >
              Go back
            </button>
          )}
        </motion.div>
      </div>
    )
  }

  if (!session) return null

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900 flex items-center justify-center p-4">
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900/95 via-blue-900/90 to-indigo-900/95" />
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-violet-500/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 w-full max-w-lg"
      >
        <div className="bg-slate-800/50 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mx-auto mb-4">
              <ShoppingBag className="w-6 h-6 text-violet-400" />
            </div>
            <h1 className="text-2xl font-bold text-white">{t('title')}</h1>
          </div>

          {/* Order Summary */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-3">
              {t('orderSummary')}
            </h3>
            <div className="bg-slate-700/30 border border-white/5 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-300">{t('product')}</span>
                <span className="text-sm font-medium text-white">{session.product.name}</span>
              </div>
              {session.product.description && (
                <p className="text-xs text-slate-400">{session.product.description}</p>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-300">{t('interval')}</span>
                <span className="text-sm font-medium text-white">
                  {getIntervalLabel(session.price.interval)}
                </span>
              </div>
              <div className="border-t border-white/5 pt-3 flex items-center justify-between">
                <span className="text-sm text-slate-300">{t('price')}</span>
                <span className="text-xl font-bold text-white">
                  {formatPrice(session.price.amount)} {session.price.currency}
                </span>
              </div>
            </div>
          </div>

          {/* Promo Code */}
          <div className="mb-6">
            <label className="flex items-center gap-1.5 text-sm font-medium text-slate-400 mb-2">
              <Tag className="w-3.5 h-3.5" />
              {t('promoCode')}
            </label>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={promoCode}
                  onChange={(e) => {
                    setPromoCode(e.target.value.toUpperCase())
                    if (promoResult) setPromoResult(null)
                  }}
                  placeholder="PROMO2024"
                  disabled={!!promoResult?.isValid}
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-700/50 border border-white/10 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500/40 disabled:opacity-50 transition-all"
                />
                {promoResult?.isValid && (
                  <button
                    onClick={clearPromo}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <button
                onClick={handleApplyPromo}
                disabled={!promoCode.trim() || !!promoResult?.isValid || promoLoading}
                className="px-4 py-2.5 rounded-xl text-sm font-medium border transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-slate-700/50 border-white/10 text-slate-300 hover:bg-slate-600/50 hover:text-white"
              >
                {promoLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : promoResult?.isValid ? (
                  <Check className="w-4 h-4 text-green-400" />
                ) : (
                  t('applyPromo')
                )}
              </button>
            </div>
          </div>

          {/* Promo Result */}
          {promoResult?.isValid && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mb-6 bg-green-500/10 border border-green-500/20 rounded-2xl p-4 space-y-2"
            >
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">{t('originalPrice')}</span>
                <span className="text-slate-300">
                  {formatPrice(promoResult.originalAmount)} {session.price.currency}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-green-400">{t('discount')}</span>
                <span className="text-green-400 font-medium">
                  -{formatPrice(promoResult.discountAmount)} {session.price.currency}
                </span>
              </div>
              <div className="border-t border-green-500/20 pt-2 flex justify-between">
                <span className="font-medium text-slate-300">{t('total')}</span>
                <span className="font-bold text-lg text-white">
                  {promoResult.finalAmount === 0
                    ? t('free')
                    : `${formatPrice(promoResult.finalAmount)} ${session.price.currency}`}
                </span>
              </div>
            </motion.div>
          )}

          {/* Payment Methods (hide if free) */}
          {!isFree && (
            <div className="mb-6">
              <label className="flex items-center gap-1.5 text-sm font-medium text-slate-400 mb-2">
                <CreditCard className="w-3.5 h-3.5" />
                {t('paymentMethod')}
              </label>
              {session.paymentMethods.length === 0 ? (
                <p className="text-sm text-red-400 py-2">{t('noPaymentMethods')}</p>
              ) : (
                <div className="space-y-2">
                  {session.paymentMethods.map((method) => (
                    <button
                      key={method.code}
                      type="button"
                      onClick={() => setSelectedRail(method.code)}
                      className={`w-full flex items-center justify-between p-3.5 rounded-xl border transition-all text-left ${
                        selectedRail === method.code
                          ? 'border-violet-500 ring-2 ring-violet-500/20 bg-violet-500/10'
                          : 'border-white/10 bg-slate-700/30 hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                            selectedRail === method.code
                              ? 'border-violet-500'
                              : 'border-slate-500'
                          }`}
                        >
                          {selectedRail === method.code && (
                            <div className="w-2 h-2 rounded-full bg-violet-500" />
                          )}
                        </div>
                        <span className="text-sm font-medium text-white">
                          {method.name}
                        </span>
                      </div>
                      <span className="text-xs text-slate-400">
                        {method.currencies.join(', ')}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Pay Button */}
          <button
            onClick={handlePay}
            disabled={payLoading || (!isFree && !selectedRail) || (!isFree && session.paymentMethods.length === 0)}
            className="w-full py-3.5 rounded-xl font-semibold text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-lg shadow-violet-500/20"
          >
            {payLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t('redirecting')}
              </>
            ) : isFree ? (
              t('completeOrder')
            ) : (
              t('pay', {
                amount: formatPrice(finalAmount),
                currency: session.price.currency,
              })
            )}
          </button>

          {/* Security note */}
          <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-slate-500">
            <Lock className="w-3 h-3" />
            {t('securePayment')}
          </div>
        </div>
      </motion.div>
    </div>
  )
}
