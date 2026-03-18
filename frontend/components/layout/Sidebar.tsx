'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Server, Package, DollarSign, Receipt,
  CreditCard, Key, Users, GitBranch, Wallet, Webhook, ArrowLeft, Plug
} from 'lucide-react'

const sidebarItems = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/admin/services', label: 'Services', icon: Server },
  { href: '/admin/products', label: 'Products', icon: Package },
  { href: '/admin/prices', label: 'Prices', icon: DollarSign },
  { href: '/admin/orders', label: 'Orders', icon: Receipt },
  { href: '/admin/subscriptions', label: 'Subscriptions', icon: CreditCard },
  { href: '/admin/entitlements', label: 'Entitlements', icon: Key },
  { href: '/admin/payment-providers', label: 'Payment Providers', icon: Plug },
  { href: '/admin/affiliates', label: 'Affiliates', icon: Users },
  { href: '/admin/referral-config', label: 'Referral Levels', icon: GitBranch },
  { href: '/admin/payouts', label: 'Payouts', icon: Wallet },
  { href: '/admin/webhooks', label: 'Webhooks', icon: Webhook },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-64 min-h-screen bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 p-4">
      <div className="mb-6">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Link>
      </div>
      <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Admin Panel</h2>
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
