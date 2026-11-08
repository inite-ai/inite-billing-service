import { PrismaClient } from '@prisma/client';
import { DEMO_ORG_NAME, DEMO_SUBSCRIBER } from '../../src/common/demo-tenant';
import { buildDemoFixtures } from './fixtures';
import { applyDemoSeed, DemoSeedRefused, planDemoSeed, seedMode } from './seed';

/**
 * The demo tenant's billing fixtures (./seed.ts).
 *
 *   npx ts-node prisma/demo-tenant/run.ts                          # dry run: what it would do
 *   DEMO_TENANT_SEED=1 npx ts-node prisma/demo-tenant/run.ts --apply
 */
async function main(): Promise<void> {
  const mode = seedMode(process.argv.slice(2), process.env);
  const prisma = new PrismaClient();
  try {
    const fixtures = buildDemoFixtures(new Date());
    const plan =
      mode === 'apply'
        ? await applyDemoSeed(prisma, fixtures)
        : await planDemoSeed(prisma, fixtures);
    console.log(
      `${DEMO_ORG_NAME} (${DEMO_SUBSCRIBER}): ${mode === 'apply' ? 'written' : 'dry run'}`,
    );
    for (const table of Object.keys(plan.create)) {
      console.log(`  ${table}: ${plan.create[table]} new, ${plan.update[table]} updated`);
    }
    if (mode !== 'apply') console.log('Nothing written. To write: DEMO_TENANT_SEED=1 ... --apply');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof DemoSeedRefused ? `Refused: ${error.message}` : error);
  process.exit(1);
});
