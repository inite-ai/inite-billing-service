/** The shape an axios error carries. Only the API's own message is usable. */
interface ApiErrorLike {
  response?: { status?: number; data?: { message?: string; status?: string } }
}

export function getErrorMessage(e: unknown, fallback = 'An error occurred'): string {
  if (e && typeof e === 'object') {
    // Only use API response message, never raw Error.message (may leak internals)
    return (e as ApiErrorLike).response?.data?.message || fallback
  }
  return fallback
}

/** The HTTP status the API answered with, when there was one. */
export function getErrorStatus(e: unknown): number | undefined {
  if (e && typeof e === 'object') return (e as ApiErrorLike).response?.status
  return undefined
}

/** A machine-readable `status` field the API put in the error body. */
export function getErrorBodyStatus(e: unknown): string | undefined {
  if (e && typeof e === 'object') return (e as ApiErrorLike).response?.data?.status
  return undefined
}
