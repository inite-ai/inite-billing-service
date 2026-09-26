import './globals.css'
import type { Metadata } from 'next'
import { Playfair_Display, Manrope, JetBrains_Mono } from 'next/font/google'
import { Toaster } from 'react-hot-toast'
import { AuthProvider } from '@/contexts/AuthContext'
import ChatWrapper from '@/components/assistant/ChatWrapper'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getLocale } from 'next-intl/server'
import { SITE_URL } from '@/lib/brand'

// The Ledger type system (Cyrillic-complete), used everywhere: Manrope for
// text, Playfair Display for headings, JetBrains Mono for figures and ids.
const display = Playfair_Display({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600', '700', '800', '900'],
  variable: '--font-display',
})
const sans = Manrope({
  subsets: ['latin', 'cyrillic'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-sans',
})
const mono = JetBrains_Mono({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500'],
  variable: '--font-mono',
})

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'INITE Billing — AI-first billing gateway',
    template: '%s · INITE Billing',
  },
  description:
    'Payment-rail-agnostic, AI-first billing gateway for the INITE platform — subscriptions, metered credits, entitlements and multi-level referrals.',
  applicationName: 'INITE Billing',
  alternates: { types: { 'text/llms+txt': `${SITE_URL}/llms.txt` } },
}

export const viewport = {
  themeColor: '#0a0a0b',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  const messages = await getMessages()

  return (
    <html lang={locale} className="dark">
      <body className={`${display.variable} ${sans.variable} ${mono.variable}`}>
        <NextIntlClientProvider messages={messages}>
          <AuthProvider>
            {children}
            <ChatWrapper />
          </AuthProvider>
        </NextIntlClientProvider>
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: '#141416',
              color: '#ececea',
              border: '1px solid rgba(255,255,255,0.09)',
              fontSize: '14px',
            },
            success: { iconTheme: { primary: '#ccff00', secondary: '#0a0a0b' } },
            error: { iconTheme: { primary: '#ef4444', secondary: '#fff' } },
          }}
        />
      </body>
    </html>
  )
}
