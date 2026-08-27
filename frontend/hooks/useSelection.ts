'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

export interface Selection {
  selected: string[]
  has: (id: string) => boolean
  toggle: (id: string) => void
  toggleAll: () => void
  clear: () => void
  allSelected: boolean
  someSelected: boolean
}

/**
 * Row selection for a bulk action, scoped to the rows currently on screen.
 *
 * The selection is deliberately dropped whenever the visible ids change — a
 * new page, a new filter, a reload after acting. Carrying it across pages would
 * put "23 selected" above a table showing twenty other rows, and the operator
 * would be authorising money movements they cannot see. Everything counted here
 * is something they are looking at.
 */
export function useSelection(ids: string[]): Selection {
  const [selected, setSelected] = useState<string[]>([])
  const key = ids.join(',')

  useEffect(() => {
    setSelected([])
  }, [key])

  const has = useCallback((id: string) => selected.includes(id), [selected])

  const toggle = useCallback((id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }, [])

  const toggleAll = useCallback(() => {
    setSelected((prev) => (prev.length === ids.length ? [] : [...ids]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const clear = useCallback(() => setSelected([]), [])

  return useMemo(
    () => ({
      selected,
      has,
      toggle,
      toggleAll,
      clear,
      allSelected: ids.length > 0 && selected.length === ids.length,
      someSelected: selected.length > 0 && selected.length < ids.length,
    }),
    [selected, has, toggle, toggleAll, clear, ids.length],
  )
}
