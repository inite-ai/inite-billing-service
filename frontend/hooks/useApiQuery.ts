'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import api from '@/lib/api'
import { getErrorMessage } from '@/lib/api-error'

interface UseApiQueryOptions<T> {
  initialData?: T
  enabled?: boolean
  onError?: (error: unknown) => void
}

interface UseApiQueryResult<T> {
  data: T | null
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

export function useApiQuery<T>(
  url: string | null,
  options?: UseApiQueryOptions<T>,
): UseApiQueryResult<T> {
  const [data, setData] = useState<T | null>(options?.initialData ?? null)
  const [loading, setLoading] = useState(url !== null && (options?.enabled !== false))
  const [error, setError] = useState<string | null>(null)
  // The latest callback, held in a ref so an inline `onError` — which every
  // caller passes — cannot re-create `fetchData` on each render and re-fetch
  // forever. Written in an effect, not during render: a ref is not rendering
  // state and touching it mid-render is what `react-hooks/refs` is about.
  const onErrorRef = useRef(options?.onError)
  useEffect(() => {
    onErrorRef.current = options?.onError
  })
  const onError = useCallback((e: unknown) => onErrorRef.current?.(e), [])

  const fetchData = useCallback(async () => {
    if (!url) return
    setLoading(true)
    setError(null)
    try {
      const res = await api.get(url)
      setData(res.data)
    } catch (e) {
      setError(getErrorMessage(e, 'Failed to load data'))
      onError?.(e)
    } finally {
      setLoading(false)
    }
    // `onError` is held in a ref-like const above so a caller passing an inline
    // callback — which every caller does — cannot re-create this function on
    // every render and re-fetch forever.
  }, [url, onError])

  useEffect(() => {
    if (options?.enabled === false) return
    fetchData()
  }, [fetchData, options?.enabled])

  return { data, loading, error, refetch: fetchData }
}

// For paginated endpoints
export function useApiPaginated<T>(
  baseUrl: string,
  params?: Record<string, string | undefined>,
) {
  const [page, setPage] = useState(1)
  const [limit] = useState(20)

  const queryParams = new URLSearchParams()
  queryParams.set('page', String(page))
  queryParams.set('limit', String(limit))
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v) queryParams.set(k, v)
    })
  }

  const url = `${baseUrl}?${queryParams}`
  const { data, loading, error, refetch } = useApiQuery<{
    items: T[]
    total: number
    page: number
    limit: number
    pages: number
  }>(url)

  return {
    items: data?.items || [],
    total: data?.total || 0,
    pages: data?.pages || 0,
    page,
    loading,
    error,
    setPage,
    refetch,
  }
}
