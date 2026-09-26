'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

/** Anything a page throws lands here, in the site's own look, with a way to retry. */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('errorPages')
  useEffect(() => {
    console.error(error)
  }, [error])
  return (
    <div className="lp">
      <div className="lp-grain" />
      <div className="lp-vign" />
      <main className="shell">
        <div className="shell-main">
          <div className="panel w-full max-w-[460px] p-9 text-center" role="alert">
            <p className="eyebrow mb-4">
              <span className="dot">●</span> {t('errorEyebrow')}
            </p>
            <h1 className="mb-3 text-[32px]">{t('errorTitle')}</h1>
            <p className="mb-7 text-[15px] leading-relaxed text-[color:var(--dim)]">{t('errorHint')}</p>
            {error.digest && <p className="mono mb-5 text-[11.5px] text-[color:var(--dim-2)]">{error.digest}</p>}
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" onClick={reset} className="btn acc">
                {t('retry')}
              </button>
              <Link href="/" className="btn ghost">
                {t('home')}
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
