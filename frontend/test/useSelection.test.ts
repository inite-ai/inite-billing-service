import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useSelection } from '@/hooks/useSelection'

/**
 * Bulk actions move money and revoke access, so the count above the table has
 * to mean the rows underneath it. A selection carried across a page change
 * would put "23 selected" above twenty rows the operator has never seen.
 */
describe('useSelection', () => {
  it('toggles a row on and off', () => {
    const { result } = renderHook(() => useSelection(['a', 'b', 'c']))

    act(() => result.current.toggle('b'))
    expect(result.current.selected).toEqual(['b'])
    expect(result.current.has('b')).toBe(true)
    expect(result.current.someSelected).toBe(true)

    act(() => result.current.toggle('b'))
    expect(result.current.selected).toEqual([])
    expect(result.current.someSelected).toBe(false)
  })

  it('select-all covers exactly the visible rows, and toggles back off', () => {
    const { result } = renderHook(() => useSelection(['a', 'b']))

    act(() => result.current.toggleAll())
    expect(result.current.selected).toEqual(['a', 'b'])
    expect(result.current.allSelected).toBe(true)
    expect(result.current.someSelected).toBe(false)

    act(() => result.current.toggleAll())
    expect(result.current.selected).toEqual([])
  })

  it('drops the selection when the rows change under it', () => {
    const { result, rerender } = renderHook(({ ids }) => useSelection(ids), {
      initialProps: { ids: ['a', 'b'] },
    })
    act(() => result.current.toggleAll())
    expect(result.current.selected).toEqual(['a', 'b'])

    rerender({ ids: ['x', 'y'] })
    expect(result.current.selected).toEqual([])
  })

  it('keeps the selection when the same rows are re-rendered', () => {
    const { result, rerender } = renderHook(({ ids }) => useSelection(ids), {
      initialProps: { ids: ['a', 'b'] },
    })
    act(() => result.current.toggle('a'))

    rerender({ ids: ['a', 'b'] })
    expect(result.current.selected).toEqual(['a'])
  })

  it('an empty table is not "all selected"', () => {
    const { result } = renderHook(() => useSelection([]))
    expect(result.current.allSelected).toBe(false)
  })
})
