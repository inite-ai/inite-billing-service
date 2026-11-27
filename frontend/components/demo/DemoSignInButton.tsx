'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { demoSignInHref, type DemoPersona } from '@/lib/demo'

/**
 * «Войти в демо» / «Try the demo»: a plain link to `/api/auth/demo`. Shown
 * only when the demo is on (`DEMO_ENABLED=1` on the server: the door answers
 * HEAD with 204), so a deployment without it shows no dead button.
 */
export function DemoSignInButton({
  persona = 'owner',
  returnTo = '/dashboard',
  className,
  withHint = false,
}: {
  persona?: DemoPersona
  returnTo?: string
  className?: string
  withHint?: boolean
}) {
  const t = useTranslations('demo')
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    let live = true
    fetch('/api/auth/demo', { method: 'HEAD', cache: 'no-store' })
      .then((res) => live && setEnabled(res.status === 204))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  if (!enabled) return null
  return (
    <>
      <a href={demoSignInHref(persona, returnTo)} rel="nofollow" data-inite-demo-button="" className={className}>
        {t('button')}
      </a>
      {withHint && <p className="mt-2 text-[12.5px] leading-relaxed text-[color:var(--dim-2)]">{t('hint')}</p>}
    </>
  )
}
