import { describe, expect, it } from 'vitest'
import { localizeProduct } from '@/lib/product-i18n'

const product = {
  name: 'Nobody Writes Code Anymore (book)',
  description: 'Software development once writing became free',
  i18n: {
    pt: { name: 'Ninguém Mais Escreve Código (livro)', description: 'Desenvolvimento quando escrever ficou de graça' },
    es: { name: 'Ya Nadie Escribe Código (libro)' },
  },
}

describe('localizeProduct', () => {
  it('uses the translation for the page language', () => {
    expect(localizeProduct(product, 'pt-BR')).toEqual({
      name: 'Ninguém Mais Escreve Código (livro)',
      description: 'Desenvolvimento quando escrever ficou de graça',
    })
  })

  it('falls back field by field, and wholly without a translation', () => {
    expect(localizeProduct(product, 'es').description).toBe('Software development once writing became free')
    expect(localizeProduct(product, 'ru').name).toBe('Nobody Writes Code Anymore (book)')
    expect(localizeProduct(product, undefined).name).toBe('Nobody Writes Code Anymore (book)')
    expect(localizeProduct({ name: 'Plain', description: null }, 'pt')).toEqual({ name: 'Plain', description: null })
  })
})
