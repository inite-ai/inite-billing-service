'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, ShoppingBag, Receipt, CreditCard, Users,
  Settings, LogOut, Menu, X, ChevronRight,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useTranslations } from 'next-intl'
import LanguageSwitcher from '@/components/ui/LanguageSwitcher'

const navItems = [
  { href: '/dashboard', key: 'dashboard', icon: LayoutDashboard },
  { href: '/catalog', key: 'catalog', icon: ShoppingBag },
  { href: '/orders', key: 'orders', icon: Receipt },
  { href: '/subscriptions', key: 'subscriptions', icon: CreditCard },
  { href: '/referrals', key: 'referrals', icon: Users },
]

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  const { user, logout } = useAuth()
  const t = useTranslations('nav')

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-5 py-6">
        <Link href="/dashboard" className="flex items-center gap-3" onClick={onNavigate}>
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
            <span className="text-white font-bold text-sm">IN</span>
          </div>
          <div>
            <span className="text-white font-bold text-lg tracking-tight">INITE</span>
            <span className="text-slate-500 text-xs block -mt-0.5">Billing</span>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-1">
        <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
          {t('menu') || 'Menu'}
        </p>
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={`sidebar-item ${isActive ? 'active' : ''}`}
            >
              <Icon className={`w-[18px] h-[18px] sidebar-icon ${isActive ? 'text-violet-500' : ''}`} />
              <span className="flex-1">{t(item.key)}</span>
              {isActive && (
                <ChevronRight className="w-3.5 h-3.5 text-violet-500/50" />
              )}
            </Link>
          )
        })}

        {user?.role === 'ADMIN' && (
          <>
            <div className="my-3 border-t border-slate-800" />
            <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
              {t('admin')}
            </p>
            <Link
              href="/admin"
              onClick={onNavigate}
              className={`sidebar-item ${pathname.startsWith('/admin') ? 'active' : ''}`}
            >
              <Settings className="w-[18px] h-[18px] sidebar-icon" />
              <span className="flex-1">{t('adminPanel')}</span>
            </Link>
          </>
        )}
      </nav>

      {/* User section */}
      <div className="px-3 pb-4 mt-auto">
        <div className="border-t border-slate-800 pt-4 space-y-3">
          <div className="flex items-center justify-between px-3">
            <LanguageSwitcher />
          </div>
          {user && (
            <div className="flex items-center gap-3 px-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-purple-700 flex items-center justify-center text-white text-xs font-bold shrink-0">
                {(user.name || user.email || '?')[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-200 truncate">
                  {user.name || user.email}
                </p>
                {user.name && user.email && (
                  <p className="text-xs text-slate-500 truncate">{user.email}</p>
                )}
              </div>
              <button
                onClick={logout}
                className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                title="Logout"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="flex min-h-screen">
      {/* Desktop Sidebar */}
      <aside className="sidebar hidden lg:flex lg:flex-col lg:w-[260px] lg:fixed lg:inset-y-0 z-30">
        <SidebarContent />
      </aside>

      {/* Mobile header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 h-14 flex items-center px-4 glass">
        <button
          onClick={() => setMobileOpen(true)}
          className="p-2 -ml-1 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <Menu className="w-5 h-5" />
        </button>
        <Link href="/dashboard" className="ml-3">
          <span className="font-bold text-lg gradient-text">INITE</span>
          <span className="text-slate-400 text-sm ml-1">Billing</span>
        </Link>
      </div>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-50 mobile-overlay lg:hidden"
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed inset-y-0 left-0 z-50 w-[280px] sidebar lg:hidden"
            >
              <button
                onClick={() => setMobileOpen(false)}
                className="absolute top-4 right-3 p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-700/50 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
              <SidebarContent onNavigate={() => setMobileOpen(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main content */}
      <main className="flex-1 lg:ml-[260px] min-h-screen">
        <div className="pt-14 lg:pt-0">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8"
          >
            {children}
          </motion.div>
        </div>
      </main>
    </div>
  )
}
