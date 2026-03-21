'use client'

import { useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'

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
      className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200 transition-colors"
      title={locale === 'ru' ? 'Switch to English' : 'Switch to Russian'}
    >
      {locale === 'ru' ? 'RU' : 'EN'}
    </button>
  )
}
