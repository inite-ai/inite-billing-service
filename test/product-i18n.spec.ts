import { productTranslations } from '../src/catalog/product-i18n';

describe('productTranslations', () => {
  it('keeps well-formed translations and drops the rest', () => {
    expect(
      productTranslations({
        description: 'default',
        i18n: {
          pt: { name: 'Ninguém Mais Escreve Código (livro)', description: 'Desenvolvimento' },
          es: { name: 'Ya Nadie Escribe Código (libro)', extra: 1 },
          ru: { name: '  ' },
          'pt-BR': { name: 'x' },
          de: 'nope',
        },
      }),
    ).toEqual({
      pt: { name: 'Ninguém Mais Escreve Código (livro)', description: 'Desenvolvimento' },
      es: { name: 'Ya Nadie Escribe Código (libro)' },
    });
  });

  it('is empty without translations', () => {
    expect(productTranslations(null)).toEqual({});
    expect(productTranslations({})).toEqual({});
    expect(productTranslations({ i18n: [] })).toEqual({});
  });
});
