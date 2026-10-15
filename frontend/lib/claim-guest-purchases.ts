import { API_URL } from './config'

/**
 * Orders a store opened for this person as a guest, under the email they just
 * signed in with, become theirs (the server moves them only for an address the
 * identity provider confirmed). A plain fetch, not the api client: nothing here
 * should send a fresh sign-in back to /login, and a failure only means the
 * orders move on the next sign-in.
 */
export async function claimGuestPurchases(): Promise<void> {
  try {
    await fetch(`${API_URL}/v1/orders/me/claim-guest-purchases`, {
      method: 'POST',
      credentials: 'include',
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    // Next sign-in.
  }
}
