import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTableState } from '@/hooks/useTableState'

/**
 * Filters, page and sort live in the URL so a view can be refreshed, bookmarked
 * and pasted into a support ticket. The rules that make that liveable: a value
 * at its default never appears, changing a filter returns to page 1, and paging
 * replaces history rather than burying the previous screen under twenty entries.
 */
const replace = vi.fn()
let params = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/admin/orders',
  useSearchParams: () => params,
}))

const setUrl = (qs: string) => {
  params = new URLSearchParams(qs)
}

const render = () =>
  renderHook(() =>
    useTableState({ filters: { status: '', q: '' }, defaultSort: 'createdAt' }),
  )

describe('useTableState', () => {
  beforeEach(() => {
    replace.mockClear()
    setUrl('')
  })

  it('reads filters, page and sort out of the URL', () => {
    setUrl('status=paid&page=3&sort=amount&dir=asc')
    const { result } = render()

    expect(result.current.filters).toEqual({ status: 'paid', q: '' })
    expect(result.current.page).toBe(3)
    expect(result.current.sort).toEqual({ key: 'amount', dir: 'asc' })
  })

  it('keeps defaults out of the URL', () => {
    const { result } = render()
    act(() => result.current.setFilters({ status: 'paid' }))
    expect(replace).toHaveBeenCalledWith('/admin/orders?status=paid', { scroll: false })

    replace.mockClear()
    setUrl('status=paid')
    const second = render()
    act(() => second.result.current.setFilters({ status: '' }))
    expect(replace).toHaveBeenCalledWith('/admin/orders', { scroll: false })
  })

  it('returns to page 1 when a filter changes', () => {
    setUrl('page=7')
    const { result } = render()
    act(() => result.current.setFilters({ status: 'refunded' }))
    expect(replace).toHaveBeenCalledWith('/admin/orders?status=refunded', { scroll: false })
  })

  it('replaces history when paging, rather than stacking it', () => {
    const { result } = render()
    act(() => result.current.setPage(4))
    expect(replace).toHaveBeenCalledWith('/admin/orders?page=4', { scroll: false })
    // Page 1 is the default and leaves no trace in the URL.
    act(() => result.current.setPage(1))
    expect(replace).toHaveBeenLastCalledWith('/admin/orders', { scroll: false })
  })

  it('flips a column to ascending, then back to the default', () => {
    setUrl('sort=amount')
    const { result } = render()
    act(() => result.current.toggleSort('amount'))
    expect(replace).toHaveBeenCalledWith('/admin/orders?sort=amount&dir=asc', { scroll: false })

    replace.mockClear()
    setUrl('sort=amount&dir=asc')
    const second = render()
    act(() => second.result.current.toggleSort('amount'))
    expect(replace).toHaveBeenCalledWith('/admin/orders?sort=amount', { scroll: false })
  })

  it('drops the default sort out of the URL entirely', () => {
    setUrl('sort=amount&dir=asc')
    const { result } = render()
    act(() => result.current.toggleSort('createdAt'))
    expect(replace).toHaveBeenCalledWith('/admin/orders', { scroll: false })
  })

  it('hands the API only what differs from the defaults', () => {
    setUrl('status=paid&page=2&sort=amount&dir=asc')
    const { result } = render()
    expect(result.current.queryParams).toEqual({
      page: 2,
      status: 'paid',
      sortBy: 'amount',
      sortOrder: 'asc',
    })
  })

  it('sends nothing but the page for an untouched table', () => {
    const { result } = render()
    expect(result.current.queryParams).toEqual({ page: 1 })
  })
})
