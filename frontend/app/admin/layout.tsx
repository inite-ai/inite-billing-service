'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useAuth } from '@/contexts/AuthContext'
import { Sidebar } from '@/components/layout/Sidebar'
import { Loader2, Menu } from 'lucide-react'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const t = useTranslations('nav')
  const [navOpen, setNavOpen] = useState(false)

  useEffect(() => {
    if (!isLoading && (!user || user.role !== 'ADMIN')) {
      router.push('/dashboard')
    }
  }, [user, isLoading, router])

  if (isLoading || !user || user.role !== 'ADMIN') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-violet-500" aria-label={t('adminPanel')} />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Below `lg` the sidebar is a drawer, so the page needs its own way in.
            Sticky, because admin tables are long and the way back to navigation
            should not be a scroll to the top. */}
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-[var(--background)]/85 px-4 py-3 backdrop-blur-sm dark:border-slate-800 lg:hidden">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label={t('menu')}
            aria-expanded={navOpen}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-semibold text-slate-900 dark:text-white">
            {t('adminPanel')}
          </span>
        </header>

        {/* Admin pages keep their filters, page and sort in the URL, so they
            read `useSearchParams` — which needs a boundary above it or the
            whole route opts out of prerendering at build time. */}
        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
          <Suspense fallback={null}>{children}</Suspense>
        </main>
      </div>
    </div>
  )
}
