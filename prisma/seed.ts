import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';

/**
 * Demo catalog seed — gives a fresh clone something to browse and check out
 * against (a service, a subscription product + monthly price, a one-time credit
 * pack, and a placeholder payment provider). Idempotent: every write upserts on
 * a unique `code`, so re-running is safe and never rotates the demo API key.
 *
 * Run with:  npm run db:seed   (or `prisma db seed`)
 */
const prisma = new PrismaClient();

async function main() {
  const service = await prisma.service.upsert({
    where: { code: 'demo' },
    update: { name: 'Demo Service' },
    create: {
      code: 'demo',
      name: 'Demo Service',
      // Only set on first create; re-runs keep the original key.
      apiKey: `demo_${randomBytes(24).toString('hex')}`.slice(0, 64),
    },
  });

  // Subscription product + monthly price (with a trial + grace window).
  const proProduct = await prisma.product.upsert({
    where: { code: 'demo-pro' },
    update: { name: 'Demo Pro' },
    create: {
      code: 'demo-pro',
      name: 'Demo Pro',
      serviceId: service.id,
      moduleScope: 'demo',
      type: 'subscription',
      metadata: { entitlements: ['demo.pro'], creditsPerPeriod: 1000 },
    },
  });
  await prisma.price.upsert({
    where: { code: 'demo-pro-monthly' },
    update: {},
    create: {
      productId: proProduct.id,
      code: 'demo-pro-monthly',
      currency: 'USD',
      amount: 19,
      interval: 'month',
      trialDays: 14,
      graceDays: 3,
    },
  });

  // One-time product + price (a credit pack).
  const creditsProduct = await prisma.product.upsert({
    where: { code: 'demo-credits-100' },
    update: { name: 'Demo Credit Pack (100)' },
    create: {
      code: 'demo-credits-100',
      name: 'Demo Credit Pack (100)',
      serviceId: service.id,
      moduleScope: 'demo',
      type: 'one_time',
      metadata: { credits: 100 },
    },
  });
  await prisma.price.upsert({
    where: { code: 'demo-credits-100-price' },
    update: {},
    create: {
      productId: creditsProduct.id,
      code: 'demo-credits-100-price',
      currency: 'USD',
      amount: 5,
      interval: 'none',
    },
  });

  // Placeholder payment provider — inactive until real credentials are added to
  // `config` (provider secrets live in the DB, never in env). Activating it lets
  // the checkout flow reach a real rail.
  await prisma.paymentProvider.upsert({
    where: { code: 'ONE' },
    update: {},
    create: {
      code: 'ONE',
      name: 'ONE (sandbox — add credentials to activate)',
      isActive: false,
      supportedModes: ['PAYMENT', 'SUBSCRIPTION'],
      currencies: ['USD'],
      countries: ['GLOBAL'],
      metadata: {
        note: 'Demo placeholder. Set config.apiKey / config.apiSecret and isActive=true to use.',
      },
    },
  });

  // eslint-disable-next-line no-console
  console.log(
    `Seeded demo catalog (service "demo", products demo-pro + demo-credits-100).\n` +
      `Demo service API key: ${service.apiKey}`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
