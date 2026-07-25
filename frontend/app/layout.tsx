import './globals.css'
import type { Metadata } from 'next'
import { Inter, Playfair_Display, Manrope, JetBrains_Mono } from 'next/font/google'
import { Toaster } from 'react-hot-toast'
import { AuthProvider } from '@/contexts/AuthContext'
import ChatWrapper from '@/components/assistant/ChatWrapper'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getLocale } from 'next-intl/server'

const inter = Inter({ subsets: ['latin', 'cyrillic'] })

// Landing-only type system (Cyrillic-complete). The dashboard keeps Inter;
// these are exposed as CSS variables and only consumed under `.lp`.
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
  title: 'INITE Billing - Dashboard',
  description: 'INITE Billing Service - Manage your subscriptions, orders, and referrals',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  const messages = await getMessages()

  return (
    <html lang={locale}>
      <body className={`${inter.className} ${display.variable} ${sans.variable} ${mono.variable}`}>
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
            style: { background: '#363636', color: '#fff' },
            success: { iconTheme: { primary: '#10b981', secondary: '#fff' } },
            error: { iconTheme: { primary: '#ef4444', secondary: '#fff' } },
          }}
        />
      </body>
    </html>
  )
}
