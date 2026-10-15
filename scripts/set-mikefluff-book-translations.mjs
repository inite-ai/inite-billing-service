#!/usr/bin/env node
/**
 * Puts the mikefluff books' localized names and descriptions into their
 * products' `metadata.i18n`, which the hosted checkout reads in the buyer's
 * language. Titles and subtitles are the ones mikefluff-site/lib/books.ts
 * shows on the book pages.
 *
 * Goes through the service catalog API with mikefluff's own service key, so
 * it can only touch mikefluff's products. Idempotent: other metadata is kept,
 * and a product already carrying these translations is left alone.
 *
 *   BILLING_SERVICE_URL=https://billing.inite.ai \
 *   BILLING_SERVICE_API_KEY=<mikefluff service key> \
 *   node scripts/set-mikefluff-book-translations.mjs [--dry-run]
 */

const TRANSLATIONS = {
  'mikefluff-book-nobody-writes-code': {
    pt: { name: 'Ninguém Mais Escreve Código (livro)', description: 'Desenvolvimento quando escrever ficou de graça' },
    es: { name: 'Ya Nadie Escribe Código (libro)', description: 'Desarrollo cuando escribir se volvió gratis' },
    ru: { name: 'Код больше не пишут (книга)', description: 'Разработка, когда писать стало бесплатно' },
  },
  'mikefluff-book-nobody-owns-money': {
    pt: { name: 'Ninguém Tem Dinheiro (livro)', description: 'A verdadeira história das criptomoedas' },
    es: { name: 'Nadie tiene dinero (libro)', description: 'La verdadera historia de las criptomonedas' },
    ru: { name: 'Ни у кого нет денег (книга)', description: 'Подлинная история крипты' },
  },
};

const base = (process.env.BILLING_SERVICE_URL || '').replace(/\/$/, '');
const key = process.env.BILLING_SERVICE_API_KEY;
const dryRun = process.argv.includes('--dry-run');
if (!base || !key) {
  console.error('Set BILLING_SERVICE_URL and BILLING_SERVICE_API_KEY.');
  process.exit(1);
}

async function call(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'x-api-key': key, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

const products = await call('GET', '/v1/service/catalog/products');
let failed = false;
for (const [code, i18n] of Object.entries(TRANSLATIONS)) {
  const product = products.find((p) => p.code === code);
  if (!product) {
    console.error(`${code}: not found among ${products.map((p) => p.code).join(', ')}`);
    failed = true;
    continue;
  }
  const metadata = product.metadata && typeof product.metadata === 'object' ? product.metadata : {};
  const next = { ...metadata, i18n: { ...(metadata.i18n || {}), ...i18n } };
  if (JSON.stringify(next.i18n) === JSON.stringify(metadata.i18n)) {
    console.log(`${code}: already set`);
    continue;
  }
  if (dryRun) {
    console.log(`${code}: would set`, JSON.stringify(next.i18n));
    continue;
  }
  await call('PUT', `/v1/service/catalog/products/${product.id}`, { metadata: next });
  console.log(`${code}: set`);
}
process.exit(failed ? 1 : 0);
