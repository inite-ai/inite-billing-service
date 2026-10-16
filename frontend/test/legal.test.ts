import { describe, expect, it } from 'vitest'
import { getLegalDoc, legalLocale } from '@/lib/legal'

describe('privacy policy', () => {
  it('serves English to languages without a translation', () => {
    expect(legalLocale('pt')).toBe('en')
    expect(legalLocale('es')).toBe('en')
    expect(legalLocale('ru')).toBe('ru')
    expect(getLegalDoc('privacy', 'pt').locale).toBe('en')
  })

  it('keeps the translation in step with the English text', () => {
    const en = getLegalDoc('privacy', 'en').body
    const ru = getLegalDoc('privacy', 'ru').body
    const sections = (s: string) => s.match(/^## /gm)?.length ?? 0
    expect(sections(en)).toBeGreaterThan(5)
    expect(sections(ru)).toBe(sections(en))
    for (const contact of ['privacy@inite.ai', 'security@inite.ai']) {
      expect(en).toContain(contact)
      expect(ru).toContain(contact)
    }
  })
})
