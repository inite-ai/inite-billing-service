'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { motion } from 'framer-motion'
import { ClientLayout } from '@/components/layout/ClientLayout'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { ShoppingBag, Loader2, Zap, Tag, Check, X } from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import type { Product, Service, Price } from '@/lib/types'

interface PromoValidation {
  valid: boolean
  discountType: 'percentage' | 'fixed_amount'
  discountValue: string
  originalAmount: string
  discountAmount: string
  finalAmount: string
  currency: string
}

export default function CatalogPage() {
  const t = useTranslations('catalog')
  const tc = useTranslations('common')
  const [products, setProducts] = useState<Product[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [selectedService, setSelectedService] = useState('')
  const [loading, setLoading] = useState(true)

  // Checkout modal state
  const [checkoutPrice, setCheckoutPrice] = useState<Price | null>(null)
  const [checkoutProduct, setCheckoutProduct] = useState<Product | null>(null)
  const [promoCode, setPromoCode] = useState('')
  const [promoLoading, setPromoLoading] = useState(false)
  const [promoResult, setPromoResult] = useState<PromoValidation | null>(null)
  const [checkoutLoading, setCheckoutLoading] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const [productsRes, servicesRes] = await Promise.all([
          api.get('/v1/catalog/products'),
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
  }, [])

  const filteredProducts = selectedService
    ? products.filter((p) => p.serviceId === selectedService)
    : products

  const openCheckout = (product: Product, price: Price) => {
    setCheckoutProduct(product)
    setCheckoutPrice(price)
    setPromoCode('')
    setPromoResult(null)
  }

  const closeCheckout = () => {
    setCheckoutProduct(null)
    setCheckoutPrice(null)
    setPromoCode('')
    setPromoResult(null)
  }

  const handleApplyPromo = async () => {
    if (!promoCode.trim() || !checkoutPrice) return
    setPromoLoading(true)
    try {
      const res = await api.post('/v1/checkout/validate-promo', {
        promoCode: promoCode.trim(),
        priceCode: checkoutPrice.code,
      })
      setPromoResult(res.data)
      if (res.data.valid) {
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

  const handleProceedToPayment = async () => {
    if (!checkoutPrice) return
    setCheckoutLoading(true)
    try {
      const payload: Record<string, unknown> = { priceId: checkoutPrice.id }
      if (promoResult?.valid && promoCode.trim()) {
        payload.promoCode = promoCode.trim()
      }
      const res = await api.post('/v1/checkout/sessions', payload)
      if (res.data.checkoutUrl) {
        window.location.href = res.data.checkoutUrl
      }
    } catch {
      toast.error(tc('errors.generic'))
    } finally {
      setCheckoutLoading(false)
    }
  }

  const clearPromo = () => {
    setPromoCode('')
    setPromoResult(null)
  }

  return (
    <ClientLayout>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">{t('title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{filteredProducts.length} products available</p>
        </div>
        {services.length > 0 && (
          <div className="w-48">
            <Select
              value={selectedService}
              onChange={(e) => setSelectedService(e.target.value)}
              options={[
                { value: '', label: t('allServices') },
                ...services.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500"><Loader2 className="w-5 h-5 animate-spin" /> {tc('loading')}</div>
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
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredProducts.map((product, index) => (
            <motion.div
              key={product.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.06, duration: 0.4 }}
            >
              <Card hover className="h-full flex flex-col">
                <div className="flex items-start justify-between mb-1">
                  <div className="flex-1">
                    <h3 className="font-semibold text-slate-900 dark:text-white">{product.name}</h3>
                    <p className="text-xs text-slate-400 font-mono mt-0.5">{product.code}</p>
                  </div>
                  <Badge variant={product.type === 'subscription' ? 'info' : 'default'}>{product.type}</Badge>
                </div>

                {product.prices && product.prices.length > 0 && (
                  <div className="mt-auto pt-4 space-y-2">
                    {product.prices.filter((p) => p.isActive).map((price) => (
                      <div key={price.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-800">
                        <div>
                          <span className="text-lg font-bold text-slate-900 dark:text-white">
                            {price.amount} {price.currency}
                          </span>
                          {price.interval && (
                            <span className="text-sm text-slate-400 ml-0.5">/{price.interval}</span>
                          )}
                        </div>
                        <Button
                          size="sm"
                          icon={<Zap className="w-3.5 h-3.5" />}
                          onClick={() => openCheckout(product, price)}
                        >
                          {tc('buy')}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      <Modal
        isOpen={!!checkoutPrice && !!checkoutProduct}
        onClose={closeCheckout}
        title={checkoutProduct?.name || ''}
      >
        {checkoutPrice && checkoutProduct && (
          <div className="space-y-5">
            <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500">{checkoutProduct.name}</span>
                <span className="text-lg font-bold text-slate-900 dark:text-white">
                  {checkoutPrice.amount} {checkoutPrice.currency}
                  {checkoutPrice.interval && (
                    <span className="text-sm font-normal text-slate-400">/{checkoutPrice.interval}</span>
                  )}
                </span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                <Tag className="w-3.5 h-3.5 inline mr-1" />
                {t('promoCode')}
              </label>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Input
                    value={promoCode}
                    onChange={(e) => {
                      setPromoCode(e.target.value.toUpperCase())
                      if (promoResult) setPromoResult(null)
                    }}
                    placeholder="SUMMER2024"
                    disabled={!!promoResult?.valid}
                  />
                  {promoResult?.valid && (
                    <button
                      onClick={clearPromo}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <Button
                  variant={promoResult?.valid ? 'secondary' : 'outline'}
                  onClick={handleApplyPromo}
                  loading={promoLoading}
                  disabled={!promoCode.trim() || !!promoResult?.valid}
                >
                  {promoResult?.valid ? <Check className="w-4 h-4" /> : t('applyPromo')}
                </Button>
              </div>
            </div>

            {promoResult?.valid && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="p-4 bg-green-50 dark:bg-green-900/20 rounded-xl border border-green-200 dark:border-green-800 space-y-2"
              >
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">{t('originalPrice')}</span>
                  <span className="text-slate-700 dark:text-slate-300">{promoResult.originalAmount} {promoResult.currency}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-green-600">{t('discount')}</span>
                  <span className="text-green-600 font-medium">-{promoResult.discountAmount} {promoResult.currency}</span>
                </div>
                <div className="border-t border-green-200 dark:border-green-800 pt-2 flex justify-between">
                  <span className="font-medium text-slate-700 dark:text-slate-200">{t('finalPrice')}</span>
                  <span className="font-bold text-lg text-slate-900 dark:text-white">{promoResult.finalAmount} {promoResult.currency}</span>
                </div>
              </motion.div>
            )}

            <Button
              className="w-full"
              size="lg"
              onClick={handleProceedToPayment}
              loading={checkoutLoading}
              icon={<Zap className="w-4 h-4" />}
            >
              {t('proceedToPayment')}
            </Button>
          </div>
        )}
      </Modal>
    </ClientLayout>
  )
}
