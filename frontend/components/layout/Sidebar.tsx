'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Server, Package, DollarSign, Receipt,
  CreditCard, Key, Users, GitBranch, Wallet, Webhook, ArrowLeft, Plug, ChevronRight, Tag, TrendingUp, Coins, UserCheck, Send, Gauge, ShieldAlert, X
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

/**
 * Admin navigation.
 *
 * Was a fixed `w-64 min-h-screen` column with no breakpoint, so on a phone it
 * took most of the viewport and left the tables a sliver — the admin was
 * desktop-only by omission rather than by decision. It is now a static column
 * from `lg` up and an off-canvas drawer below it, and it scrolls inside itself
 * so twenty-one destinations do not push the page.
 */
export function Sidebar({ open = false, onClose }: { open?: boolean; onClose?: () => void }) {
  const pathname = usePathname()
  const t = useTranslations('nav')
  const ta = useTranslations('admin')
  const closeRef = useRef<HTMLButtonElement>(null)

  // Navigating is the drawer's job done; leaving it open would cover the page
  // the operator just asked for.
  useEffect(() => {
    if (open) onClose?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKeyDown)
    closeRef.current?.focus()
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

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
    <>
      {/* Drawer scrim. Hidden from assistive tech: Escape and the close button
          are the labelled ways out. */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={`fixed inset-0 z-30 bg-slate-950/60 backdrop-blur-sm transition-opacity duration-200 lg:hidden ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      <aside
        aria-label={t('adminPanel')}
        className={`sidebar z-40 flex w-64 shrink-0 flex-col
          fixed inset-y-0 left-0 h-dvh transition-transform duration-200 ease-out
          ${open ? 'translate-x-0' : '-translate-x-full'}
          lg:sticky lg:top-0 lg:translate-x-0 lg:h-dvh`}
      >
        <div className="flex items-center justify-between px-5 py-6">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-300 transition-colors rounded-md"
          >
            <ArrowLeft className="w-4 h-4" />
            {t('backToDashboard')}
          </Link>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t('menu')}
            className="lg:hidden inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 mb-4">
          <h2 className="text-lg font-bold text-white">{t('adminPanel')}</h2>
        </div>

        {/* The nav owns the scroll: twenty-one destinations must not move the
            page behind them. */}
        <nav className="flex-1 overflow-y-auto px-3 pb-6">
          {groups.map((group) => (
            <div key={group.labelKey}>
              <div className="text-xs uppercase text-slate-500 mb-1 mt-4 px-3 tracking-wider">
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
                      aria-current={isActive ? 'page' : undefined}
                      className={`sidebar-item ${isActive ? 'active' : ''}`}
                    >
                      <Icon className={`w-[18px] h-[18px] sidebar-icon shrink-0 ${isActive ? 'text-violet-500' : ''}`} />
                      <span className="flex-1 truncate">{item.label}</span>
                      {isActive && (
                        <ChevronRight className="w-3.5 h-3.5 text-violet-500/50 shrink-0" />
                      )}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>
    </>
  )
}
