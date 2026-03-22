'use client'

import { useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Globe } from 'lucide-react'

export default function LanguageSwitcher() {
  const locale = useLocale()
  const router = useRouter()

  const toggle = () => {
    const next = locale === 'ru' ? 'en' : 'ru'
    document.cookie = `locale=${next};path=/;max-age=31536000`
    router.refresh()
  }

  return (
    <button
      onClick={toggle}
      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800/50 px-2.5 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 transition-colors"
      title={locale === 'ru' ? 'Switch to English' : 'Переключить на русский'}
    >
      <Globe className="w-3.5 h-3.5" />
      {locale === 'ru' ? 'RU' : 'EN'}
    </button>
  )
}
