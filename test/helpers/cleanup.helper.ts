import { PrismaService } from '../../src/common/services/prisma.service';

/**
 * Helper to clean up test database in correct order
 * Respects foreign key constraints by deleting child records first
 * Call this only in afterAll, NOT in afterEach to avoid FK errors
 */
export async function cleanupTestData(prisma: PrismaService): Promise<void> {
  try {
    // Delete in correct order (child -> parent)
    await prisma.webhookEvent.deleteMany({});
    await prisma.outboxEvent.deleteMany({});
    await prisma.affiliateCommission.deleteMany({});
    await prisma.referral.deleteMany({});
    await prisma.affiliate.deleteMany({});
    await prisma.entitlement.deleteMany({});
    await prisma.invoice.deleteMany({});
    await prisma.paymentIntent.deleteMany({});
    await prisma.subscription.deleteMany({});
    await prisma.order.deleteMany({});
    await prisma.price.deleteMany({});
    await prisma.product.deleteMany({});
  } catch (error) {
    console.error('Cleanup error:', error);
  }
}
