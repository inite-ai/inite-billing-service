/**
 * A product's translations, as the hosted checkout receives them.
 *
 * The catalogue stores one name. A product that sells in more than one
 * language can carry translations in `metadata.i18n`, keyed by base language:
 *
 *   { "i18n": { "pt": { "name": "...", "description": "..." }, "es": { ... } } }
 *
 * Either field may be left out; the page falls back to the product's own name
 * and `metadata.description` for whatever is missing.
 */
export type ProductTranslations = Record<string, { name?: string; description?: string }>;

/** The well-formed part of `metadata.i18n`; anything else is dropped. */
export function productTranslations(metadata: unknown): ProductTranslations {
  const i18n = isRecord(metadata) && isRecord(metadata.i18n) ? metadata.i18n : {};
  const out: ProductTranslations = {};
  for (const [lang, entry] of Object.entries(i18n)) {
    if (!/^[a-z]{2,3}$/.test(lang) || !isRecord(entry)) continue;
    const name = nonEmpty(entry.name);
    const description = nonEmpty(entry.description);
    if (name || description)
      out[lang] = { ...(name && { name }), ...(description && { description }) };
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
