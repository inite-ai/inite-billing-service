'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { motion } from 'framer-motion'
import { ClientLayout } from '@/components/layout/ClientLayout'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { ShoppingBag, Loader2, Zap } from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import type { Product, Service } from '@/lib/types'

export default function CatalogPage() {
  const t = useTranslations('catalog')
  const tc = useTranslations('common')
  const [products, setProducts] = useState<Product[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [selectedService, setSelectedService] = useState('')
  const [loading, setLoading] = useState(true)

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
                        <Button size="sm" icon={<Zap className="w-3.5 h-3.5" />}>{tc('buy')}</Button>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </ClientLayout>
  )
}
