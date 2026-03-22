'use client'

import { useState, useEffect, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { motion, AnimatePresence } from 'framer-motion'
import { ClientLayout } from '@/components/layout/ClientLayout'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Tabs } from '@/components/ui/Tabs'
import { ShoppingBag, Loader2, Zap, Check, Sparkles } from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import type { Product, Service, Price } from '@/lib/types'

type BillingInterval = 'month' | 'year'

function getMetaString(product: Product, key: string): string | undefined {
  const val = product.metadata?.[key]
  return typeof val === 'string' ? val : undefined
}

function getMetaNumber(product: Product, key: string): number | undefined {
  const val = product.metadata?.[key]
  if (typeof val === 'number') return val
  if (typeof val === 'string') {
    const n = Number(val)
    return isNaN(n) ? undefined : n
  }
  return undefined
}

function getMetaBoolean(product: Product, key: string): boolean {
  const val = product.metadata?.[key]
  if (typeof val === 'boolean') return val
  if (val === 'true') return true
  return false
}

function getMetaFeatures(product: Product): string[] {
  const val = product.metadata?.features
  if (Array.isArray(val)) return val.map(String)
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val)
      if (Array.isArray(parsed)) return parsed.map(String)
    } catch {
      return val.split(',').map((s: string) => s.trim()).filter(Boolean)
    }
  }
  return []
}

function formatPrice(amount: string | number): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount
  if (isNaN(num)) return String(amount)
  if (num === Math.floor(num)) return num.toString()
  return num.toFixed(2)
}

function getPriceByInterval(product: Product, interval: string | null): Price | undefined {
  return product.prices?.find(
    (p) => p.isActive && (interval === null ? !p.interval : p.interval === interval)
  )
}

export default function CatalogPage() {
  const t = useTranslations('catalog')
  const tc = useTranslations('common')
  const [products, setProducts] = useState<Product[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [selectedService, setSelectedService] = useState('all')
  const [billingInterval, setBillingInterval] = useState<BillingInterval>('month')
  const [loading, setLoading] = useState(true)
  const [buyLoading, setBuyLoading] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const [productsRes, servicesRes] = await Promise.all([
          api.get('/v1/products'),
          api.get('/v1/admin/services').catch(() => ({ data: [] })),
        ])
        setProducts(productsRes.data)
        setServices(servicesRes.data)
      } catch {
        toast.error(t('failedToLoad'))
      } finally {
        setLoading(false)
      }
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filteredProducts = useMemo(() => {
    const base = selectedService !== 'all'
      ? products.filter((p) => p.serviceId === selectedService)
      : products
    return base.filter((p) => p.isActive)
  }, [products, selectedService])

  const subscriptionProducts = useMemo(
    () => filteredProducts.filter((p) => p.type === 'subscription'),
    [filteredProducts]
  )

  const oneTimeProducts = useMemo(
    () => filteredProducts.filter((p) => p.type === 'one_time' || p.type === 'usage'),
    [filteredProducts]
  )

  const serviceTabs = useMemo(() => {
    const tabs = [{ key: 'all', label: t('allServices') }]
    services.forEach((s) => {
      if (s.isActive) tabs.push({ key: s.id, label: s.name })
    })
    return tabs
  }, [services, t])

  const handleBuy = async (product: Product, price: Price) => {
    const key = `${product.id}:${price.id}`
    setBuyLoading(key)
    try {
      const res = await api.post('/v1/checkout/sessions', {
        priceCode: price.code,
        mode: product.type === 'subscription' ? 'SUBSCRIPTION' : 'PAYMENT',
        successUrl: window.location.origin + '/orders',
        errorUrl: window.location.origin + '/catalog',
      })
      window.location.href = `/checkout/${res.data.sessionId}`
    } catch (e: any) {
      toast.error(e.response?.data?.message || tc('errors.generic'))
      setBuyLoading(null)
    }
  }

  return (
    <ClientLayout>
      {/* Header */}
      <div className="text-center mb-10">
        <motion.h1
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white tracking-tight"
        >
          {t('title')}
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="text-slate-500 dark:text-slate-400 mt-2 text-lg"
        >
          {t('subtitle')}
        </motion.p>
      </div>

      {/* Service tabs */}
      {serviceTabs.length > 1 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="flex justify-center mb-8"
        >
          <Tabs
            tabs={serviceTabs}
            activeTab={selectedService}
            onChange={setSelectedService}
          />
        </motion.div>
      )}

      {/* Billing toggle */}
      {subscriptionProducts.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15 }}
          className="flex items-center justify-center gap-3 mb-10"
        >
          <span
            className={`text-sm font-medium transition-colors ${
              billingInterval === 'month'
                ? 'text-slate-900 dark:text-white'
                : 'text-slate-400 dark:text-slate-500'
            }`}
          >
            {t('monthly')}
          </span>
          <button
            onClick={() => setBillingInterval(billingInterval === 'month' ? 'year' : 'month')}
            className="relative w-14 h-7 rounded-full bg-slate-200 dark:bg-slate-700 transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500/40"
            aria-label="Toggle billing interval"
          >
            <motion.div
              className="absolute top-0.5 w-6 h-6 rounded-full bg-white dark:bg-slate-200 shadow-md"
              animate={{ left: billingInterval === 'year' ? '1.75rem' : '0.125rem' }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            />
          </button>
          <span
            className={`text-sm font-medium transition-colors ${
              billingInterval === 'year'
                ? 'text-slate-900 dark:text-white'
                : 'text-slate-400 dark:text-slate-500'
            }`}
          >
            {t('yearly')}
          </span>
          <AnimatePresence>
            {billingInterval === 'year' && (
              <SavingsBadgeGlobal products={subscriptionProducts} t={t} />
            )}
          </AnimatePresence>
        </motion.div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 text-slate-500 py-20">
          <Loader2 className="w-5 h-5 animate-spin" />
          {tc('loading')}
        </div>
      ) : filteredProducts.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-4">
              <ShoppingBag className="w-7 h-7 text-slate-400" />
            </div>
            <p className="text-slate-500 font-medium">{t('noProducts')}</p>
          </div>
        </Card>
      ) : (
        <>
          {/* Subscription products */}
          {subscriptionProducts.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 mb-12">
              {subscriptionProducts.map((product, index) => (
                <PricingCard
                  key={product.id}
                  product={product}
                  billingInterval={billingInterval}
                  index={index}
                  onSubscribe={handleBuy}
                  buyLoading={buyLoading}
                  t={t}
                />
              ))}
            </div>
          )}

          {/* One-time products */}
          {oneTimeProducts.length > 0 && (
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-6">
                {t('oneTimePurchases')}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {oneTimeProducts.map((product, index) => (
                  <OneTimeCard
                    key={product.id}
                    product={product}
                    index={index}
                    onBuy={handleBuy}
                    buyLoading={buyLoading}
                    t={t}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </ClientLayout>
  )
}

/* -- Savings Badge (global, shown near toggle) -- */

function SavingsBadgeGlobal({
  products,
  t,
}: {
  products: Product[]
  t: ReturnType<typeof useTranslations<'catalog'>>
}) {
  let maxSavings = 0
  for (const product of products) {
    const monthly = getPriceByInterval(product, 'month')
    const yearly = getPriceByInterval(product, 'year')
    if (monthly && yearly) {
      const monthlyNum = parseFloat(monthly.amount)
      const yearlyNum = parseFloat(yearly.amount)
      if (monthlyNum > 0) {
        const savings = Math.round((1 - yearlyNum / (monthlyNum * 12)) * 100)
        if (savings > maxSavings) maxSavings = savings
      }
    }
  }

  if (maxSavings <= 0) return null

  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.8, x: -10 }}
      animate={{ opacity: 1, scale: 1, x: 0 }}
      exit={{ opacity: 0, scale: 0.8, x: -10 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-xs font-semibold ring-1 ring-emerald-200 dark:ring-emerald-800/50"
    >
      <Sparkles className="w-3 h-3" />
      {t('save', { percent: maxSavings })}
    </motion.span>
  )
}

/* -- Pricing Card (subscription) -- */

function PricingCard({
  product,
  billingInterval,
  index,
  onSubscribe,
  buyLoading,
  t,
}: {
  product: Product
  billingInterval: BillingInterval
  index: number
  onSubscribe: (product: Product, price: Price) => void
  buyLoading: string | null
  t: ReturnType<typeof useTranslations<'catalog'>>
}) {
  const monthlyPrice = getPriceByInterval(product, 'month')
  const yearlyPrice = getPriceByInterval(product, 'year')
  const isHighlighted = getMetaBoolean(product, 'highlighted')
  const description = getMetaString(product, 'description')
  const features = getMetaFeatures(product)
  const creditsPerPeriod = getMetaNumber(product, 'creditsPerPeriod')

  const activePrice = billingInterval === 'year' && yearlyPrice
    ? yearlyPrice
    : billingInterval === 'month' && monthlyPrice
      ? monthlyPrice
      : monthlyPrice || yearlyPrice

  if (!activePrice) return null

  const isYearly = activePrice.interval === 'year'
  const priceAmount = parseFloat(activePrice.amount)
  const monthlyAmount = monthlyPrice ? parseFloat(monthlyPrice.amount) : null
  const yearlyAmount = yearlyPrice ? parseFloat(yearlyPrice.amount) : null

  let savingsPercent = 0
  if (monthlyAmount && yearlyAmount && monthlyAmount > 0) {
    savingsPercent = Math.round((1 - yearlyAmount / (monthlyAmount * 12)) * 100)
  }

  const perMonthEquivalent = isYearly ? priceAmount / 12 : null

  const yearlyCredits = getMetaNumber(product, 'creditsPerPeriodYearly')
  const bonusCredits = yearlyCredits && creditsPerPeriod
    ? yearlyCredits - creditsPerPeriod * 12
    : undefined

  const isLoading = buyLoading === `${product.id}:${activePrice.id}`

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.5 }}
      className="relative"
    >
      {isHighlighted && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-violet-600 text-white text-xs font-semibold shadow-lg shadow-violet-500/30">
            <Sparkles className="w-3 h-3" />
            {t('popular')}
          </span>
        </div>
      )}
      <div
        className={`h-full flex flex-col rounded-2xl border p-6 transition-all ${
          isHighlighted
            ? 'border-violet-500 ring-2 ring-violet-500/20 bg-white dark:bg-gray-800 shadow-xl shadow-violet-500/10'
            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-gray-800 hover:shadow-lg'
        }`}
      >
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
            {product.name}
          </h3>
          {description && (
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              {description}
            </p>
          )}
        </div>

        <div className="mb-6">
          <div className="flex items-baseline gap-1">
            <span className="text-4xl font-bold text-slate-900 dark:text-white">
              ${isYearly && perMonthEquivalent !== null
                ? formatPrice(perMonthEquivalent)
                : formatPrice(priceAmount)}
            </span>
            <span className="text-slate-500 dark:text-slate-400 text-sm">
              {t('perMonth')}
            </span>
          </div>

          {isYearly && monthlyAmount !== null && (
            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
              <span className="text-sm text-slate-400 line-through">
                ${formatPrice(monthlyAmount * 12)}{t('perYear')}
              </span>
              <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                ${formatPrice(priceAmount)}{t('perYear')}
              </span>
              <span className="text-xs text-slate-400">
                {t('billedAnnually')}
              </span>
            </div>
          )}

          {isYearly && savingsPercent > 0 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              className="mt-2"
            >
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-xs font-semibold">
                {t('save', { percent: savingsPercent })}
              </span>
            </motion.div>
          )}

          {!isYearly && activePrice.interval === 'month' && (
            <div className="mt-1.5">
              {yearlyAmount !== null && savingsPercent > 0 && (
                <p className="text-xs text-slate-400">
                  {t('save', { percent: savingsPercent })}{' '}
                  {t('billedAnnually').toLowerCase()}
                </p>
              )}
            </div>
          )}
        </div>

        {(features.length > 0 || creditsPerPeriod) && (
          <div className="mb-6 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3">
              {t('features')}
            </p>
            <ul className="space-y-2.5">
              {creditsPerPeriod && (
                <li className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <Check className="w-4 h-4 text-violet-500 mt-0.5 shrink-0" />
                  <span>
                    {isYearly && yearlyCredits
                      ? (
                        <>
                          {t('creditsYearly', { count: yearlyCredits.toLocaleString() })}
                          {bonusCredits && bonusCredits > 0 && (
                            <span className="text-emerald-600 dark:text-emerald-400 ml-1 text-xs font-medium">
                              ({t('bonusCredits', { count: bonusCredits.toLocaleString() })})
                            </span>
                          )}
                        </>
                      )
                      : t('credits', { count: creditsPerPeriod.toLocaleString() })
                    }
                  </span>
                </li>
              )}
              {features.map((feature, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <Check className="w-4 h-4 text-violet-500 mt-0.5 shrink-0" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {features.length === 0 && !creditsPerPeriod && <div className="flex-1" />}

        <Button
          className="w-full"
          size="lg"
          variant={isHighlighted ? 'primary' : 'outline'}
          onClick={() => onSubscribe(product, activePrice)}
          loading={isLoading}
        >
          {t('subscribe')}
        </Button>
      </div>
    </motion.div>
  )
}

/* -- One-time Purchase Card -- */

function OneTimeCard({
  product,
  index,
  onBuy,
  buyLoading,
  t,
}: {
  product: Product
  index: number
  onBuy: (product: Product, price: Price) => void
  buyLoading: string | null
  t: ReturnType<typeof useTranslations<'catalog'>>
}) {
  const description = getMetaString(product, 'description')
  const activePrices = product.prices?.filter((p) => p.isActive) || []

  if (activePrices.length === 0) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.5 }}
    >
      <div className="h-full flex flex-col rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-gray-800 p-6 hover:shadow-lg transition-all">
        <div className="mb-4">
          <div className="flex items-start justify-between">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
              {product.name}
            </h3>
            <Badge variant="default">{product.type === 'usage' ? 'usage' : 'one-time'}</Badge>
          </div>
          {description && (
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              {description}
            </p>
          )}
        </div>

        <div className="mt-auto space-y-2">
          {activePrices.map((price) => {
            const isLoading = buyLoading === `${product.id}:${price.id}`
            return (
              <div
                key={price.id}
                className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-800"
              >
                <span className="text-2xl font-bold text-slate-900 dark:text-white">
                  ${formatPrice(price.amount)}
                  <span className="text-sm font-normal text-slate-400 ml-1">
                    {price.currency}
                  </span>
                </span>
                <Button
                  size="sm"
                  icon={<Zap className="w-3.5 h-3.5" />}
                  onClick={() => onBuy(product, price)}
                  loading={isLoading}
                >
                  {t('buyNow')}
                </Button>
              </div>
            )
          })}
        </div>
      </div>
    </motion.div>
  )
}
