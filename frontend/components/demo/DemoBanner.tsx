'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { demoSignInHref, formatDemoLeft, readDemoEnd, signOutHref } from '@/lib/demo'

/**
 * While a demo session is on: a bar on every page that says the company and
 * its data are made up and read-only, counts down the time left, and offers
 * to leave. The family's banner (`@inite/auth/demo-ui`), with the same words
 * (messages `demo`), drawn in billing's own style.
 *
 * It reads the readable `demo_session` cookie after mount, so it needs no
 * request and the server render (which has no cookie to read) matches.
 */
export function DemoBanner() {
  const t = useTranslations('demo')
  const [end, setEnd] = useState<Date | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const found = readDemoEnd()
    setEnd(found)
    if (!found) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  if (!end) return null
  const ended = end.getTime() <= now
  // Pinned to the bottom: the app's sidebar and mobile header are fixed to the
  // top and would cover a bar there. The spacer keeps the page's last line clear.
  return (
    <>
      <div aria-hidden className="h-24 sm:h-14" />
      <div
        role="status"
        data-inite-demo-banner=""
        className="fixed inset-x-0 bottom-0 z-[60] flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-[#ccff00]/30 bg-[#16180d] px-4 py-2.5 text-center text-[13px] leading-snug text-slate-100"
      >
        {ended ? (
          <>
            <span>{t('ended')}</span>
            <a href={demoSignInHref('owner', '/dashboard')} className="font-semibold text-[#ccff00] underline underline-offset-2">
              {t('again')}
            </a>
          </>
        ) : (
          <>
            <span>
              {t('banner')} {t('note')}{' '}
              {t('left', { time: formatDemoLeft(end.getTime() - now, { hours: t('hours'), minutes: t('minutes') }) })}
            </span>
            <a href={signOutHref('/')} className="font-semibold text-[#ccff00] underline underline-offset-2">
              {t('exit')}
            </a>
          </>
        )}
      </div>
    </>
  )
}
