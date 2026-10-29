import { PrismaService } from '../../src/common/services/prisma.service';

/**
 * Helper to clean up test database in correct order
 * Respects foreign key constraints by deleting child records first
 * Call this only in afterAll, NOT in afterEach to avoid FK errors
 */
export async function cleanupTestData(prisma: PrismaService): Promise<void> {
  try {
    // Delete in correct order (child -> parent)
    await prisma.commitmentLedgerEntry.deleteMany({});
    await prisma.commitmentTransition.deleteMany({});
    await prisma.commitment.deleteMany({});
    await prisma.charityPayout.deleteMany({});
    await prisma.charity.deleteMany({});
    await prisma.creditUsage.deleteMany({});
    await prisma.creditBalance.deleteMany({});
    await prisma.webhookEvent.deleteMany({});
    await prisma.x402Payment.deleteMany({});
    await prisma.walletAgentPayment.deleteMany({});
    await prisma.walletMerchant.deleteMany({});
    await prisma.walletAgent.deleteMany({});
    await prisma.walletWithdrawal.deleteMany({});
    await prisma.walletTopup.deleteMany({});
    await prisma.wallet.deleteMany({});
    await prisma.x402RelayerKey.deleteMany({});
    await prisma.cryptoTransfer.deleteMany({});
    await prisma.cryptoInvoice.deleteMany({});
    await prisma.fxRate.deleteMany({});
    await prisma.outboxEvent.deleteMany({});
    await prisma.affiliateCommission.deleteMany({});
    await prisma.affiliatePayout.deleteMany({});
    await prisma.referral.deleteMany({});
    await prisma.affiliate.deleteMany({});
    await prisma.entitlement.deleteMany({});
    await prisma.invoice.deleteMany({});
    await prisma.paymentIntent.deleteMany({});
    await prisma.subscription.deleteMany({});
    await prisma.order.deleteMany({});
    await prisma.price.deleteMany({});
    await prisma.product.deleteMany({});
    await prisma.referralLevel.deleteMany({});
    await prisma.service.deleteMany({});
    await prisma.paymentProvider.deleteMany({});
  } catch (error) {
    console.error('Cleanup error:', error);
  }
}
