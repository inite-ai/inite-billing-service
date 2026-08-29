/**
 * A post-login destination that cannot leave this origin.
 *
 * The check used to be `returnTo.startsWith('/')`, which passes `//evil.example`
 * — a protocol-relative URL — and `/\evil.example`, which browsers normalise to
 * the same thing. Either one turns the callback into an open redirect: a link
 * that logs the victim in on the real site and then lands them on an attacker's
 * page, carrying the trust of a completed sign-in.
 *
 * Everything is resolved against this origin and rejected unless it stays here.
 */
export function safeReturnTo(
  value: string | null | undefined,
  fallback = '/dashboard',
): string {
  if (!value || !value.startsWith('/')) return fallback
  // `//host` and `/\host` both leave the origin; neither is a path.
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback

  const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin
  try {
    const url = new URL(value, origin)
    if (url.origin !== origin) return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}
