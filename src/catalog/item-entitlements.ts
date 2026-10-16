import { BadRequestException } from '@nestjs/common';

/**
 * Products sold per item: one price for any unit of content (a chapter, an
 * episode, a report), the unit named at checkout.
 *
 * The product declares a template instead of fixed entitlement keys:
 *
 *   metadata.entitlementTemplate = "mikefluff:chapter:{book}:{chapter}"
 *   metadata.itemParams = { book: "^[a-z0-9-]{1,60}$", chapter: "^[A-Za-z0-9_-]{1,40}$" }
 *
 * The selling service names the unit when it opens the session
 * (`metadata.item = { book, chapter }`, service key only, so a buyer cannot
 * swap it); billing checks it against itemParams, keeps it on the order, and
 * on payment grants exactly one key with the values put in. A refund revokes
 * it like any order's entitlement (they carry the order id).
 */

export interface ItemTemplate {
  template: string;
  params: Record<string, RegExp>;
}

const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9_]{0,30})\}/g;
const MAX_VALUE = 100;

/** The product's item template, or null for an ordinary product. */
export function itemTemplate(product: { metadata?: unknown }): ItemTemplate | null {
  const metadata = (product.metadata ?? {}) as Record<string, unknown>;
  const template = metadata.entitlementTemplate;
  if (typeof template !== 'string' || !template) return null;
  const raw = (metadata.itemParams ?? {}) as Record<string, unknown>;
  const params: Record<string, RegExp> = {};
  for (const [name, pattern] of Object.entries(raw)) {
    if (typeof pattern !== 'string') continue;
    // Whole value only, whatever the admin wrote.
    params[name] = new RegExp(`^(?:${pattern.replace(/^\^/, '').replace(/\$$/, '')})$`);
  }
  for (const [, name] of template.matchAll(PLACEHOLDER)) {
    if (!params[name!]) {
      throw new Error(`entitlementTemplate uses {${name}} but itemParams has no pattern for it`);
    }
  }
  return { template, params };
}

/**
 * The unit as the service named it, checked: exactly the template's fields,
 * each a string matching its pattern. Throws 400 otherwise.
 */
export function checkItem(t: ItemTemplate, item: unknown): Record<string, string> {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new BadRequestException(
      `This product is sold per item: metadata.item must name ${Object.keys(t.params).join(', ')}`,
    );
  }
  const given = item as Record<string, unknown>;
  const extra = Object.keys(given).filter((k) => !(k in t.params));
  if (extra.length)
    throw new BadRequestException(`metadata.item has unknown fields: ${extra.join(', ')}`);
  const out: Record<string, string> = {};
  for (const [name, pattern] of Object.entries(t.params)) {
    const value = given[name];
    if (typeof value !== 'string' || value.length > MAX_VALUE || !pattern.test(value)) {
      throw new BadRequestException(
        `metadata.item.${name} is missing or not valid for this product`,
      );
    }
    out[name] = value;
  }
  return out;
}

/** The one entitlement key for this item. */
export function itemKey(t: ItemTemplate, item: Record<string, string>): string {
  return t.template.replace(PLACEHOLDER, (_, name: string) => item[name] ?? '');
}
