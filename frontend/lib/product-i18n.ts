/**
 * The product's name and description in the page's language, from the
 * translations the checkout session carries (`product.i18n`, filled from the
 * product's `metadata.i18n`). Whatever is missing stays in the default.
 */
export interface CheckoutProductText {
  name: string
  description: string | null
  i18n?: Record<string, { name?: string; description?: string }>
}

export function localizeProduct(
  product: CheckoutProductText,
  locale: string | null | undefined,
): { name: string; description: string | null } {
  const lang = locale?.trim().toLowerCase().split(/[-_]/)[0]
  const entry = lang ? product.i18n?.[lang] : undefined
  return {
    name: entry?.name || product.name,
    description: entry?.description || product.description,
  }
}
