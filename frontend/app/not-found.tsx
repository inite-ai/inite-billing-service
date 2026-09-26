import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

export default async function NotFound() {
  const t = await getTranslations('errorPages')
  return (
    <div className="lp">
      <div className="lp-grain" />
      <div className="lp-gridbg" />
      <div className="lp-vign" />
      <main className="shell">
        <div className="shell-main">
          <div className="panel w-full max-w-[460px] p-9 text-center">
            <p className="eyebrow mb-4">
              <span className="dot">●</span> 404
            </p>
            <h1 className="mb-3 text-[34px]">{t('notFoundTitle')}</h1>
            <p className="mb-7 text-[15px] leading-relaxed text-[color:var(--dim)]">{t('notFoundHint')}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Link href="/" className="btn acc">
                {t('home')}
              </Link>
              <Link href="/catalog" className="btn ghost">
                {t('pricing')}
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
