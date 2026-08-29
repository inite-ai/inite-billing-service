import { describe, expect, it } from 'vitest'
import { getErrorMessage } from '@/lib/api-error'

/**
 * Error text reaches the operator's screen, so it may only ever be what the API
 * chose to say. A raw `Error.message` from axios or the runtime can carry an
 * internal URL, a stack frame or a driver error.
 */
describe('getErrorMessage', () => {
  it('uses the API’s own message', () => {
    expect(getErrorMessage({ response: { data: { message: 'Price not found' } } })).toBe(
      'Price not found',
    )
  })

  it('never surfaces a raw Error message', () => {
    const err = new Error('connect ECONNREFUSED 10.0.0.7:5432')
    expect(getErrorMessage(err)).toBe('An error occurred')
  })

  it('falls back for a response with no message', () => {
    expect(getErrorMessage({ response: { data: {} } }, 'Could not save')).toBe('Could not save')
  })

  it('handles values that are not objects', () => {
    expect(getErrorMessage('boom')).toBe('An error occurred')
    expect(getErrorMessage(null)).toBe('An error occurred')
  })
})
