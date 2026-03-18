'use client'

import { useState, useEffect } from 'react'
import { Header } from '@/components/layout/Header'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import type { Product, Service } from '@/lib/types'

export default function CatalogPage() {
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
        toast.error('Failed to load catalog')
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
    <div className="min-h-screen">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Catalog</h1>
          {services.length > 0 && (
            <div className="w-48">
              <Select
                value={selectedService}
                onChange={(e) => setSelectedService(e.target.value)}
                options={[
                  { value: '', label: 'All Services' },
                  ...services.map((s) => ({ value: s.id, label: s.name })),
                ]}
              />
            </div>
          )}
        </div>

        {loading ? (
          <div className="text-gray-500">Loading...</div>
        ) : filteredProducts.length === 0 ? (
          <div className="text-gray-500">No products available</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredProducts.map((product) => (
              <Card key={product.id}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{product.name}</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{product.code}</p>
                  </div>
                  <Badge>{product.type}</Badge>
                </div>
                {product.prices && product.prices.length > 0 && (
                  <div className="space-y-2 mt-4">
                    {product.prices.filter((p) => p.isActive).map((price) => (
                      <div key={price.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
                        <div>
                          <span className="text-lg font-bold text-gray-900 dark:text-white">
                            {price.amount} {price.currency}
                          </span>
                          {price.interval && (
                            <span className="text-sm text-gray-500 dark:text-gray-400">/{price.interval}</span>
                          )}
                        </div>
                        <Button size="sm">Buy</Button>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
