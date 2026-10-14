'use client'

import { useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Globe } from 'lucide-react'
import { LOCALES, LOCALE_COOKIE, supportedLocale } from '@/i18n/locales'

const NAMES: Record<(typeof LOCALES)[number], string> = {
  en: 'English',
  ru: 'Русский',
  pt: 'Português',
  es: 'Español',
}

/** Steps through the interface languages: EN → RU → PT → ES → EN. */
export default function LanguageSwitcher() {
  const current = supportedLocale(useLocale()) ?? 'en'
  const router = useRouter()
  const next = LOCALES[(LOCALES.indexOf(current) + 1) % LOCALES.length]

  const toggle = () => {
    document.cookie = `${LOCALE_COOKIE}=${next};path=/;max-age=31536000`
    // A `?locale=` in the address would win over the cookie on the next render.
    const url = new URL(window.location.href)
    if (url.searchParams.has('locale')) {
      url.searchParams.delete('locale')
      window.history.replaceState(null, '', url)
    }
    router.refresh()
  }

  return (
    <button
      onClick={toggle}
      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800/50 px-2.5 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 transition-colors"
      title={NAMES[next]}
    >
      <Globe className="w-3.5 h-3.5" />
      {current.toUpperCase()}
    </button>
  )
}
