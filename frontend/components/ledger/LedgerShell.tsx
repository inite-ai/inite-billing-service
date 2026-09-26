'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import LanguageSwitcher from '@/components/ui/LanguageSwitcher'

/**
 * The frame for the pages a customer passes through outside the product —
 * sign-in, the OAuth callback, checkout — in the landing's Ledger look, so
 * the way from the landing to paying reads as one site.
 */
export function LedgerShell({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  const t = useTranslations('landing')
  return (
    <div className="lp">
      <div className="lp-grain" />
      <div className="lp-gridbg" />
      <div className="lp-vign" />
      <div className="shell">
        <nav className="shell-nav">
          <div className="wrap navrow">
            <Link href="/" className="brand">
              <span className="logo">IN</span>
              {t('brand')}
              <b>{t('brandHighlight')}</b>
            </Link>
            <LanguageSwitcher />
          </div>
        </nav>
        <main className="shell-main">{children}</main>
        {footer && <footer className="shell-foot">{footer}</footer>}
      </div>
    </div>
  )
}
