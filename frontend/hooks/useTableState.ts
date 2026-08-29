'use client'

import { useCallback, useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { SortDirection, SortState } from '@/components/ui/Table'

export interface TableStateOptions<F extends Record<string, string>> {
  /** Filter names and their default values. A value equal to its default stays out of the URL. */
  filters: F
  /** The column the API sorts by when nothing is chosen. */
  defaultSort: string
  defaultDir?: SortDirection
}

export interface TableState<F extends Record<string, string>> {
  filters: F
  page: number
  sort: SortState
  /** Change filters. Any change returns to page 1 — page 7 of a new filter is usually empty. */
  setFilters: (patch: Partial<F>) => void
  setPage: (page: number) => void
  toggleSort: (key: string) => void
  /** Ready to hand to axios: filters at their default are omitted. */
  queryParams: Record<string, string | number>
}

/**
 * Filters, page and sort, kept in the URL.
 *
 * They used to be component state, so a refresh — or a link sent to a
 * colleague, or the browser Back button after opening a record — dropped the
 * operator onto page 1 of an unfiltered list. Anything worth looking at twice
 * has to be addressable, and a support ticket that says "this order" should be
 * able to carry the query that found it.
 *
 * Only non-default values are written, so a plain list keeps a clean URL, and
 * `router.replace` is used rather than `push`: paging through twenty pages
 * should not bury the previous screen under twenty history entries.
 */
export function useTableState<F extends Record<string, string>>(
  options: TableStateOptions<F>,
): TableState<F> {
  const { filters: defaults, defaultSort, defaultDir = 'desc' } = options
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Hoisted: a dependency list has to be plain expressions, so the memo can be
  // compared rather than re-run on every render.
  const defaultsKey = JSON.stringify(defaults)

  const filters = useMemo(() => {
    const out = { ...defaults }
    for (const key of Object.keys(defaults) as Array<keyof F>) {
      const value = searchParams.get(String(key))
      if (value !== null) out[key] = value as F[keyof F]
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, defaultsKey])

  const page = Math.max(parseInt(searchParams.get('page') || '1', 10) || 1, 1)

  const sort: SortState = {
    key: searchParams.get('sort') || defaultSort,
    dir: searchParams.get('dir') === 'asc' ? 'asc' : 'desc',
  }

  const write = useCallback(
    (patch: Record<string, string | number | null>) => {
      const next = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === '') next.delete(key)
        else next.set(key, String(value))
      }
      const qs = next.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  const setFilters = useCallback(
    (patch: Partial<F>) => {
      const cleaned: Record<string, string | null> = {}
      for (const [key, value] of Object.entries(patch)) {
        cleaned[key] = value === defaults[key as keyof F] ? null : (value as string)
      }
      write({ ...cleaned, page: null })
    },
    [defaults, write],
  )

  const setPage = useCallback((next: number) => write({ page: next <= 1 ? null : next }), [write])

  const toggleSort = useCallback(
    (key: string) => {
      const flipped: SortDirection = sort.key === key && sort.dir === 'desc' ? 'asc' : 'desc'
      write({
        sort: key === defaultSort && flipped === defaultDir ? null : key,
        dir: flipped === defaultDir ? null : flipped,
        page: null,
      })
    },
    [defaultDir, defaultSort, sort.dir, sort.key, write],
  )

  const filtersKey = JSON.stringify(filters)

  const queryParams = useMemo(() => {
    const params: Record<string, string | number> = { page }
    for (const [key, value] of Object.entries(filters)) {
      if (value && value !== defaults[key as keyof F]) params[key] = value
    }
    if (sort.key !== defaultSort || sort.dir !== defaultDir) {
      params.sortBy = sort.key
      params.sortOrder = sort.dir
    }
    return params
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filtersKey, sort.key, sort.dir, defaultSort, defaultDir])

  return { filters, page, sort, setFilters, setPage, toggleSort, queryParams }
}
