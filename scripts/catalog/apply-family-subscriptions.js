/* eslint-disable */
/**
 * Applies docs/catalog/family-subscriptions-2026-10.json to billing's
 * catalogue: plan products and their prices, `<service>:plan:<tier>`
 * entitlements, metadata (tier, rank, limits, isAddon), trial 0 and grace on
 * every plan price, and each service's `metadata.allowedOrigins` for the
 * /subscriptions page's "Back to …" link.
 *
 * Runs inside the billing container with billing's own Prisma client, fed on
 * stdin by apply-family-subscriptions.sh, which prepends the catalogue as
 * `globalThis.CATALOG` and the mode as `globalThis.MODE`:
 *
 *   backup   prints, as one JSON document, every row this run may touch
 *            (services without their keys, products, prices) and writes
 *            nothing;
 *   dry-run  does the whole apply in one transaction, prints the result and
 *            rolls it back;
 *   apply    the same, committed.
 *
 * Idempotent: a second apply finds every row as the file says and prints the
 * same table. All or nothing: any row that is not what the file expects (a
 * missing service, a "keep" price whose amount differs, a code that belongs
 * to another product) stops the run before anything is committed, naming
 * only codes.
 *
 * Prints only `code | type | active | amount | currency`.
 *
 * Locally, against a test database: node apply-family-subscriptions.js <catalogue.json> [mode]
 */
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

const CATALOG = globalThis.CATALOG ?? JSON.parse(fs.readFileSync(process.argv[2] || '', 'utf8'));
const MODE = globalThis.MODE ?? process.argv[3] ?? process.env.MODE ?? 'dry-run';
if (!['backup', 'dry-run', 'apply'].includes(MODE)) {
  console.error(`unknown mode ${MODE}: backup | dry-run | apply`);
  process.exit(2);
}

class Refused extends Error {}
class RolledBack extends Error {}

const changes = CATALOG.changes;
const origins = CATALOG.allowedOrigins || {};
const serviceCodes = [...new Set([...changes.map((c) => c.service), ...Object.keys(origins)])];
const productCodes = changes.map((c) => c.product);
const priceCodes = changes.flatMap((c) => c.prices.map((p) => p.code));

const num = (v) => Number(String(v));
const sameAmount = (a, b) => Math.abs(num(a) - num(b)) < 0.00005;

/** The keys billing grants for a product today (payment-orchestrator's rule). */
function grantedKeys(product) {
  const m = product.metadata || {};
  if (Array.isArray(m.entitlements)) return m.entitlements;
  if (typeof m.entitlementKey === 'string') return [m.entitlementKey];
  return [product.code];
}

/** JSON with keys sorted: jsonb does not keep key order, so a plain compare always differs. */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v === undefined ? null : v);
}

function union(a, b) {
  return [...new Set([...(a || []), ...(b || [])])];
}

async function backup(prisma) {
  const [services, products, prices] = await Promise.all([
    prisma.service.findMany({
      where: { code: { in: serviceCodes } },
      // Never the api key or the webhook secret.
      select: { id: true, code: true, name: true, isActive: true, metadata: true, updatedAt: true },
    }),
    prisma.product.findMany({ where: { code: { in: productCodes } } }),
    prisma.price.findMany({ where: { code: { in: priceCodes } } }),
  ]);
  process.stdout.write(
    JSON.stringify({ takenAt: new Date().toISOString(), services, products, prices }) + '\n',
  );
}

async function apply(tx) {
  const rows = [];
  const services = new Map();
  for (const s of await tx.service.findMany({ where: { code: { in: serviceCodes } } })) {
    services.set(s.code, s);
  }
  const missing = serviceCodes.filter((c) => !services.has(c));
  if (missing.length) {
    throw new Refused(
      `not registered in billing: ${missing.join(', ')} (Ops: register consumer service first)`,
    );
  }

  // Return origins: merged into what the service already lists.
  for (const code of Object.keys(origins)) {
    const s = services.get(code);
    const meta = s.metadata && typeof s.metadata === 'object' ? s.metadata : {};
    const list = union(
      Array.isArray(meta.allowedOrigins) ? meta.allowedOrigins : [],
      origins[code],
    );
    const same = Array.isArray(meta.allowedOrigins) && meta.allowedOrigins.length === list.length;
    if (!same) {
      await tx.service.update({
        where: { id: s.id },
        data: { metadata: { ...meta, allowedOrigins: list } },
      });
    }
    rows.push([code, 'service', s.isActive, '', '']);
  }

  for (const change of changes) {
    const service = services.get(change.service);
    let product = await tx.product.findUnique({ where: { code: change.product } });
    if (product && product.serviceId && product.serviceId !== service.id) {
      throw new Refused(`product ${change.product} belongs to another service`);
    }
    const offSale = change.action === 'off_sale';

    if (offSale) {
      if (product && product.isActive) {
        product = await tx.product.update({ where: { id: product.id }, data: { isActive: false } });
      }
    } else {
      if (!product && change.action !== 'create') {
        throw new Refused(`product ${change.product} is to be updated but does not exist`);
      }
      const meta =
        product && product.metadata && typeof product.metadata === 'object' ? product.metadata : {};
      const legacy = product ? grantedKeys(product) : [change.product];
      const next = {
        ...meta,
        tier: change.tier,
        rank: change.rank,
        entitlements: union(legacy, change.addEntitlements),
        ...(change.limits ? { limits: change.limits } : {}),
        ...(change.isAddon ? { isAddon: true } : {}),
      };
      if (!product) {
        const sibling = await tx.product.findFirst({
          where: { serviceId: service.id },
          orderBy: { createdAt: 'asc' },
        });
        product = await tx.product.create({
          data: {
            code: change.product,
            name: change.name || change.product,
            serviceId: service.id,
            moduleScope: sibling ? sibling.moduleScope : service.code,
            type: 'subscription',
            isActive: true,
            metadata: next,
          },
        });
      } else {
        if (product.type !== 'subscription') {
          throw new Refused(`product ${change.product} is not a subscription product`);
        }
        if (canonical(meta) !== canonical(next) || !product.isActive || !product.serviceId) {
          product = await tx.product.update({
            where: { id: product.id },
            data: { metadata: next, isActive: true, serviceId: service.id },
          });
        }
      }
    }
    rows.push([
      product ? product.code : change.product,
      'product',
      product ? product.isActive : false,
      '',
      '',
    ]);

    for (const p of change.prices) {
      let price = await tx.price.findUnique({ where: { code: p.code } });
      if (price && product && price.productId !== product.id) {
        throw new Refused(`price ${p.code} belongs to another product`);
      }
      if (p.action === 'deactivate' || offSale) {
        if (price && price.isActive) {
          price = await tx.price.update({ where: { id: price.id }, data: { isActive: false } });
        }
        if (price)
          rows.push([price.code, 'price', price.isActive, String(price.amount), price.currency]);
        continue;
      }
      const want = {
        currency: p.currency,
        amount: String(p.amount),
        interval: p.interval,
        trialDays: change.trialDays,
        graceDays: change.graceDays,
        isActive: true,
      };
      if (!price) {
        if (p.action !== 'create')
          throw new Refused(`price ${p.code} is to be kept or updated but does not exist`);
        price = await tx.price.create({ data: { code: p.code, productId: product.id, ...want } });
      } else {
        if (String(price.currency).toUpperCase() !== p.currency.toUpperCase()) {
          throw new Refused(
            `price ${p.code} is in another currency: a new code is needed, not an update`,
          );
        }
        if (p.action === 'keep' && !sameAmount(price.amount, p.amount)) {
          throw new Refused(`price ${p.code} is to be kept but its amount differs from the file`);
        }
        if ((price.interval || null) !== p.interval) {
          throw new Refused(`price ${p.code} has another interval`);
        }
        const differs =
          !sameAmount(price.amount, p.amount) ||
          price.trialDays !== want.trialDays ||
          price.graceDays !== want.graceDays ||
          !price.isActive;
        if (differs) {
          price = await tx.price.update({
            where: { id: price.id },
            data: {
              amount: want.amount,
              trialDays: want.trialDays,
              graceDays: want.graceDays,
              isActive: true,
            },
          });
        }
      }
      rows.push([price.code, 'price', price.isActive, String(num(price.amount)), price.currency]);
    }
  }
  return rows;
}

function print(rows) {
  const out = ['code | type | active | amount | currency'];
  for (const r of rows) out.push(r.map((v) => String(v)).join(' | '));
  process.stdout.write(out.join('\n') + '\n');
}

async function main() {
  const prisma = new PrismaClient();
  try {
    if (MODE === 'backup') return await backup(prisma);
    let rows;
    try {
      await prisma.$transaction(
        async (tx) => {
          rows = await apply(tx);
          if (MODE === 'dry-run') throw new RolledBack();
        },
        { timeout: 120000, maxWait: 10000, isolationLevel: 'Serializable' },
      );
    } catch (e) {
      if (!(e instanceof RolledBack)) throw e;
    }
    print(rows);
    process.stderr.write(
      MODE === 'apply' ? 'committed\n' : 'dry run: rolled back, nothing written\n',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  process.stderr.write(
    (e instanceof Refused
      ? `refused, nothing written: ${e.message}`
      : `failed, nothing written: ${e && e.message ? e.message.split('\n')[0] : e}`) + '\n',
  );
  process.exit(1);
});
