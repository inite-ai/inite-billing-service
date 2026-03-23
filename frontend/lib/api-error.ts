export function getErrorMessage(e: unknown, fallback = 'An error occurred'): string {
  if (e && typeof e === 'object') {
    const err = e as any
    return err.response?.data?.message || err.message || fallback
  }
  return fallback
}
