/**
 * The token a checkout link carries (`/checkout/<id>#t=<token>`): it opens
 * that one order without a billing sign-in, because the store that sent the
 * buyer here already knows who they are.
 *
 * It arrives in the fragment, which never reaches a server or a Referer, and
 * is kept per order in localStorage: the buyer comes back from the provider's
 * page to a bare `/checkout/<id>`, sometimes in the payment window.
 */
export const CHECKOUT_LINK_HEADER = 'x-checkout-token'

const key = (sessionId: string) => `checkout-link:${sessionId}`

export function takeCheckoutLink(sessionId: string): string | null {
  if (typeof window === 'undefined') return null
  const fromHash = new URLSearchParams(window.location.hash.slice(1)).get('t')
  if (fromHash) {
    try {
      localStorage.setItem(key(sessionId), fromHash)
    } catch {
      // Private mode: this page load still has it.
    }
    // Out of the address bar, so a copied link or a screenshot does not carry it.
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
    return fromHash
  }
  try {
    return localStorage.getItem(key(sessionId))
  } catch {
    return null
  }
}

/** Request options for a call made through the link, or none. */
export function checkoutLinkHeaders(token: string | null): { headers?: Record<string, string> } {
  return token ? { headers: { [CHECKOUT_LINK_HEADER]: token } } : {}
}
