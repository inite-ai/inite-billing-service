'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import LanguageSwitcher from '@/components/ui/LanguageSwitcher'

/**
 * The frame for the pages a customer passes through outside the product —
 * sign-in, the OAuth callback, checkout — in the landing's Ledger look, so
 * the way from the landing to paying reads as one site.
 */
export function LedgerShell({
  children,
  footer,
  nav,
  wide = false,
}: {
  children: React.ReactNode
  footer?: React.ReactNode
  /** Links beside the language switch (sign in, account). */
  nav?: React.ReactNode
  /** A full page from the top (the catalog) rather than one card in the middle. */
  wide?: boolean
}) {
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
            <div className="navr">
              {nav}
              <LanguageSwitcher />
            </div>
          </div>
        </nav>
        <main className={wide ? 'shell-page' : 'shell-main'}>{children}</main>
        {footer && <footer className="shell-foot">{footer}</footer>}
      </div>
    </div>
  )
}
