import { describe, expect, it } from 'vitest'
import { intlTag, localeFromAcceptLanguage, resolveLocale, supportedLocale } from '@/i18n/locales'

describe('supportedLocale', () => {
  it('reduces a tag to a supported base language', () => {
    expect(supportedLocale('pt-BR')).toBe('pt')
    expect(supportedLocale('es_419')).toBe('es')
    expect(supportedLocale('RU')).toBe('ru')
  })

  it('rejects what has no messages file', () => {
    expect(supportedLocale('de')).toBeNull()
    expect(supportedLocale('../../etc/passwd')).toBeNull()
    expect(supportedLocale('')).toBeNull()
    expect(supportedLocale(undefined)).toBeNull()
  })
})

describe('localeFromAcceptLanguage', () => {
  it('takes the highest-weighted supported language', () => {
    expect(localeFromAcceptLanguage('de-DE,de;q=0.9,pt-BR;q=0.8,en;q=0.7')).toBe('pt')
    expect(localeFromAcceptLanguage('en;q=0.5,es-MX;q=0.9')).toBe('es')
    expect(localeFromAcceptLanguage('ru-RU,ru;q=0.9,en-US;q=0.8')).toBe('ru')
  })

  it('is null when nothing is supported', () => {
    expect(localeFromAcceptLanguage('de-DE,fr;q=0.8')).toBeNull()
    expect(localeFromAcceptLanguage(null)).toBeNull()
  })
})

describe('resolveLocale', () => {
  it('prefers the URL param, then the cookie, then the browser', () => {
    expect(resolveLocale({ param: 'pt', cookie: 'ru', acceptLanguage: 'es' })).toBe('pt')
    expect(resolveLocale({ param: 'xx', cookie: 'ru', acceptLanguage: 'es' })).toBe('ru')
    expect(resolveLocale({ cookie: 'zz', acceptLanguage: 'es-AR' })).toBe('es')
  })

  it('falls back to English', () => {
    expect(resolveLocale({})).toBe('en')
    expect(resolveLocale({ acceptLanguage: 'ja-JP' })).toBe('en')
  })
})

describe('intlTag', () => {
  it('maps to a regional formatting tag', () => {
    expect(intlTag('pt')).toBe('pt-BR')
    expect(intlTag('es')).toBe('es-419')
    expect(intlTag('ru')).toBe('ru-RU')
    expect(intlTag('en')).toBe('en-US')
  })
})
