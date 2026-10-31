import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { itemKey, itemTemplate } from '../catalog/item-entitlements';
import { toMoney } from '../common/money';

/**
 * An open product: one billing product a service sells many things through,
 * each at the amount and title the service names when it opens the checkout
 * (lava.top calls this a dynamic-price offer). inite.education sells every
 * generated course through `education-open` instead of a product per course.
 *
 * The product (type `open`, owned by the service) bounds what the service may
 * ask, in `metadata`:
 *
 *   open: {
 *     currencies: { USD: { min: "1.00", max: "50.00" }, BRL: { min: "5", max: "250" } }
 *   }
 *   entitlementTemplate: "education:course:{ref}"   // optional
 *   itemParams: { ref: "^[a-z0-9][a-z0-9-]{0,79}$" } // optional, narrows SAFE_REF
 *
 * A line names `{productCode, amount, currency, title, ref, quantity}`. Billing
 * checks the amount against the currency's bounds, keeps the title and ref on
 * the order, and on payment grants the template with `ref` put in, through
 * the per-item path the orchestrator already has (`metadata.item`). Without a
 * template the sale grants nothing and the service fulfils from the
 * `billing.payment.succeeded` webhook (goods, an order of its own).
 *
 * The service's daily volume is capped per currency in the service's
 * `metadata.openDailyCap` ({ USD: "500.00" }); a currency with no cap is not
 * sold open (fail closed).
 */

/** What any ref must look like, whatever the product narrows it to. */
export const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
export const TITLE_MAX = 120;
/** A decimal amount as a string: no floats on the way in. */
const AMOUNT = /^\d{1,12}(?:\.\d{1,4})?$/;
const CURRENCY = /^[A-Z]{3,10}$/;

export interface OpenBounds {
  min: Decimal;
  max: Decimal;
}

export interface OpenConfig {
  currencies: Record<string, OpenBounds>;
  /** The item template when the sale grants an entitlement. */
  template: ReturnType<typeof itemTemplate>;
}

/**
 * The product's open configuration, checked. Throws 400 when the product is
 * not sellable open: bounds missing or inverted, or an entitlement template
 * outside the owning service's namespace or naming anything but `{ref}`.
 */
export function openConfig(
  product: { code: string; type: string; metadata?: unknown },
  serviceCode: string,
): OpenConfig {
  if (product.type !== 'open') {
    throw new BadRequestException(`Product ${product.code} is not an open product`);
  }
  const meta = (product.metadata ?? {}) as Record<string, any>;
  const raw = (meta.open?.currencies ?? {}) as Record<string, any>;
  const currencies: Record<string, OpenBounds> = {};
  for (const [code, bounds] of Object.entries(raw)) {
    const cur = code.toUpperCase();
    const min = moneyField(bounds?.min);
    const max = moneyField(bounds?.max);
    if (!CURRENCY.test(cur) || !min || !max || min.lte(0) || max.lt(min)) {
      throw new BadRequestException(`Product ${product.code} has invalid bounds for ${code}`);
    }
    currencies[cur] = { min, max };
  }
  if (Object.keys(currencies).length === 0) {
    throw new BadRequestException(`Product ${product.code} allows no currency`);
  }
  let template: OpenConfig['template'] = null;
  try {
    template = itemTemplate(product);
  } catch {
    throw new BadRequestException(`Product ${product.code} has an invalid entitlement template`);
  }
  if (template) {
    // One placeholder, {ref}, and the key lives in the seller's own namespace:
    // a bare `course:<id>` could collide with another service's course.
    const names = Object.keys(template.params);
    const placeholders = [...template.template.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]{0,30})\}/g)];
    if (
      names.length !== 1 ||
      names[0] !== 'ref' ||
      placeholders.length !== 1 ||
      !template.template.startsWith(`${serviceCode}:`)
    ) {
      throw new BadRequestException(
        `Product ${product.code}'s entitlement template must be "${serviceCode}:...{ref}"`,
      );
    }
  }
  return { currencies, template };
}

/** A whole-value decimal, or null. */
function moneyField(value: unknown): Decimal | null {
  const s = typeof value === 'number' ? String(value) : value;
  if (typeof s !== 'string' || !AMOUNT.test(s.trim())) return null;
  return toMoney(s.trim());
}

/** The amount a service asked for, as a decimal string; 400 otherwise. */
export function parseOpenAmount(value: unknown): Decimal {
  if (typeof value !== 'string' || !AMOUNT.test(value)) {
    throw new BadRequestException('An open line\'s amount is a decimal string, e.g. "2.00"');
  }
  return toMoney(value);
}

/**
 * The title as the checkout page, the receipt and the ledger will show it:
 * Unicode-normalised, with control and bidirectional-override characters and
 * angle brackets removed, whitespace collapsed, 1 to TITLE_MAX characters.
 */
export function sanitizeTitle(value: unknown): string {
  if (typeof value !== 'string') throw new BadRequestException('An open line needs a title');
  const clean = value
    .normalize('NFC')
    // C0/C1 controls, zero-width and bidi controls that can disguise a title.
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) throw new BadRequestException('An open line needs a title');
  if ([...clean].length > TITLE_MAX) {
    throw new BadRequestException(`An open line's title is at most ${TITLE_MAX} characters`);
  }
  return clean;
}

/** The ref, checked against SAFE_REF and the product's own pattern. */
export function checkRef(value: unknown, config: OpenConfig): string {
  if (typeof value !== 'string' || !SAFE_REF.test(value)) {
    throw new BadRequestException("An open line's ref is 1-100 of A-Z a-z 0-9 . _ -");
  }
  const own = config.template?.params.ref;
  if (own && !own.test(value)) {
    throw new BadRequestException("An open line's ref does not fit this product");
  }
  return value;
}

/** The amount within the currency's bounds; 400 naming them otherwise. */
export function checkBounds(amount: Decimal, currency: string, config: OpenConfig): void {
  const bounds = config.currencies[currency];
  if (!bounds) {
    throw new BadRequestException(
      `This product is not sold in ${currency}; it takes ${Object.keys(config.currencies).join(', ')}`,
    );
  }
  if (amount.lt(bounds.min) || amount.gt(bounds.max)) {
    throw new BadRequestException(
      `The amount must be between ${bounds.min.toFixed(2)} and ${bounds.max.toFixed(2)} ${currency}`,
    );
  }
}

/** The key the sale grants, or null when it grants nothing. */
export function openEntitlementKey(config: OpenConfig, ref: string): string | null {
  return config.template ? itemKey(config.template, { ref }) : null;
}

/** The service's daily cap for open sales in a currency, or null (none: not sold). */
export function openDailyCap(serviceMetadata: unknown, currency: string): Decimal | null {
  const caps = ((serviceMetadata ?? {}) as Record<string, any>).openDailyCap ?? {};
  const raw = caps[currency] ?? caps[currency.toLowerCase()];
  const cap = moneyField(raw);
  return cap && cap.gt(0) ? cap : null;
}

/** The internal price an open order hangs on, one per product and currency. */
export function openPriceCode(productCode: string, currency: string): string {
  return `${productCode}-open-${currency.toLowerCase()}`;
}
