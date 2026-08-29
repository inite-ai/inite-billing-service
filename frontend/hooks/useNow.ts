'use client'

import { useEffect, useState } from 'react'

/**
 * The current time, as a value the component can render.
 *
 * Calling `Date.now()` while rendering makes the render impure: two renders of
 * the same state produce different output, which React is free to do at any
 * time. Reading it once into state fixes that, and an optional interval keeps
 * a relative label ("in 3 days", "2 hours ago") from going stale on a screen
 * somebody leaves open.
 */
export function useNow(refreshMs?: number): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!refreshMs) return
    const id = setInterval(() => setNow(Date.now()), refreshMs)
    return () => clearInterval(id)
  }, [refreshMs])

  return now
}
