'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Server, Package, DollarSign, Receipt,
  CreditCard, Key, Users, GitBranch, Wallet, Webhook, ArrowLeft, Plug
} from 'lucide-react'
import { useTranslations } from 'next-intl'

export function Sidebar() {
  const pathname = usePathname()
  const t = useTranslations('nav')
  const ta = useTranslations('admin')

  const sidebarItems = [
    { href: '/admin', label: t('dashboard'), icon: LayoutDashboard, exact: true },
    { href: '/admin/services', label: ta('services.title'), icon: Server },
    { href: '/admin/products', label: ta('products.title'), icon: Package },
    { href: '/admin/prices', label: ta('prices.title'), icon: DollarSign },
    { href: '/admin/orders', label: ta('orders.title'), icon: Receipt },
    { href: '/admin/subscriptions', label: ta('subscriptions.title'), icon: CreditCard },
    { href: '/admin/entitlements', label: ta('entitlements.title'), icon: Key },
    { href: '/admin/payment-providers', label: ta('providers.title'), icon: Plug },
    { href: '/admin/affiliates', label: ta('affiliates.title'), icon: Users },
    { href: '/admin/referral-config', label: ta('referralConfig.title'), icon: GitBranch },
    { href: '/admin/payouts', label: ta('payouts.title'), icon: Wallet },
    { href: '/admin/webhooks', label: ta('webhooks.title'), icon: Webhook },
  ]

  return (
    <aside className="w-64 min-h-screen bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 p-4">
      <div className="mb-6">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('backToDashboard')}
        </Link>
      </div>
      <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">{t('adminPanel')}</h2>
      <nav className="flex flex-col gap-1">
        {sidebarItems.map((item) => {
          const Icon = item.icon
          const isActive = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
