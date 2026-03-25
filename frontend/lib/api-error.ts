export function getErrorMessage(e: unknown, fallback = 'An error occurred'): string {
  if (e && typeof e === 'object') {
    const err = e as any
    // Only use API response message, never raw Error.message (may leak internals)
    return err.response?.data?.message || fallback
  }
  return fallback
}
