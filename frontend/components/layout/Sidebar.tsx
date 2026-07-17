'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Server, Package, DollarSign, Receipt,
  CreditCard, Key, Users, GitBranch, Wallet, Webhook, ArrowLeft, Plug, ChevronRight, Tag, TrendingUp, Coins, UserCheck, Send, Gauge, ShieldAlert
} from 'lucide-react'
import { useTranslations } from 'next-intl'

interface NavItem {
  href: string
  label: string
  icon: React.ElementType
  exact?: boolean
}

interface NavGroup {
  labelKey: string
  items: NavItem[]
}

export function Sidebar() {
  const pathname = usePathname()
  const t = useTranslations('nav')
  const ta = useTranslations('admin')

  const groups: NavGroup[] = [
    {
      labelKey: 'groupOverview',
      items: [
        { href: '/admin', label: t('dashboard'), icon: LayoutDashboard, exact: true },
        { href: '/admin/funnel', label: ta('funnel.title'), icon: TrendingUp },
        { href: '/admin/outreach', label: ta('outreach.title'), icon: Send },
        { href: '/admin/risk', label: ta('risk.title'), icon: ShieldAlert },
      ],
    },
    {
      labelKey: 'groupCatalog',
      items: [
        { href: '/admin/services', label: ta('services.title'), icon: Server },
        { href: '/admin/products', label: ta('products.title'), icon: Package },
        { href: '/admin/prices', label: ta('prices.title'), icon: DollarSign },
        { href: '/admin/promo-codes', label: ta('promoCodes.title'), icon: Tag },
      ],
    },
    {
      labelKey: 'groupSales',
      items: [
        { href: '/admin/customers', label: ta('customers.title'), icon: Users },
        { href: '/admin/orders', label: ta('orders.title'), icon: Receipt },
        { href: '/admin/subscriptions', label: ta('subscriptions.title'), icon: CreditCard },
      ],
    },
    {
      labelKey: 'groupReferrals',
      items: [
        { href: '/admin/affiliates', label: ta('affiliates.title'), icon: UserCheck },
        { href: '/admin/referral-config', label: ta('referralConfig.title'), icon: GitBranch },
        { href: '/admin/payouts', label: ta('payouts.title'), icon: Wallet },
      ],
    },
    {
      labelKey: 'groupSystem',
      items: [
        { href: '/admin/payment-providers', label: ta('providers.title'), icon: Plug },
        { href: '/admin/payout-providers', label: ta('payoutProviders.title'), icon: Receipt },
        { href: '/admin/credits', label: ta('credits.title'), icon: Coins },
        { href: '/admin/metering', label: ta('metering.title'), icon: Gauge },
        { href: '/admin/entitlements', label: ta('entitlements.title'), icon: Key },
        { href: '/admin/webhooks', label: ta('webhooks.title'), icon: Webhook },
      ],
    },
  ]

  return (
    <aside className="sidebar w-64 min-h-screen flex flex-col">
      <div className="px-5 py-6">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-300 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('backToDashboard')}
        </Link>
      </div>
      <div className="px-5 mb-4">
        <h2 className="text-lg font-bold text-white">{t('adminPanel')}</h2>
      </div>
      <nav className="flex-1 px-3">
        {groups.map((group) => (
          <div key={group.labelKey}>
            <div className="text-xs uppercase text-gray-400 mb-1 mt-4 px-3 tracking-wider">
              {t(group.labelKey)}
            </div>
            <div className="space-y-0.5 pl-1">
              {group.items.map((item) => {
                const Icon = item.icon
                const isActive = item.exact
                  ? pathname === item.href
                  : pathname.startsWith(item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`sidebar-item ${isActive ? 'active' : ''}`}
                  >
                    <Icon className={`w-[18px] h-[18px] sidebar-icon ${isActive ? 'text-violet-500' : ''}`} />
                    <span className="flex-1">{item.label}</span>
                    {isActive && (
                      <ChevronRight className="w-3.5 h-3.5 text-violet-500/50" />
                    )}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  )
}
