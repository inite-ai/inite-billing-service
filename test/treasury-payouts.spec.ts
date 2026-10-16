import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import {
  getAddress,
  keccak256,
  parseSignature,
  verifyTypedData,
  type Hex,
  type PublicClient,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { TestAppModule } from './test-app.module';
import { PrismaService } from '../src/common/services/prisma.service';
import { cleanupTestData } from './helpers/cleanup.helper';
import { TreasuryService } from '../src/wallet/treasury.service';
import * as relayerModule from '../src/adapters/crypto/x402/relayer';
import { Relayer } from '../src/adapters/crypto/x402/relayer';

/**
 * A card top-up is paid exactly once, whatever fails or runs twice: a second
 * run, a crash after sending, a failure before sending, a lost confirmation.
 * The chain (authorizationState of the nonce) is what decides a retry.
 */
describe('Treasury payouts: exactly once', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let treasury: TreasuryService;
  const realFetch = global.fetch;
  const account = privateKeyToAccount(generatePrivateKey());
  const WALLET = getAddress('0x1111111111111111111111111111111111111111');
  const RELAYER = getAddress('0x3333333333333333333333333333333333333333');
  const state = {
    signs: 0,
    signFails: 0,
    sent: [] as Hex[],
    usedNonces: new Set<string>(),
    receiptFails: 0,
  };

  const client = {
    verifyTypedData: (args: any) => verifyTypedData(args),
    readContract: async ({ functionName, args }: any) =>
      functionName === 'authorizationState'
        ? state.usedNonces.has(String(args[1]).toLowerCase())
        : 10_000_000_000n,
    estimateGas: async () => 80_000n,
    estimateFeesPerGas: async () => ({
      maxFeePerGas: 10_000_000n,
      maxPriorityFeePerGas: 1_000_000n,
    }),
    getTransactionCount: async () => state.sent.length,
    sendRawTransaction: async ({ serializedTransaction }: any) => {
      state.sent.push(serializedTransaction);
      return keccak256(serializedTransaction);
    },
    waitForTransactionReceipt: async ({ hash }: any) => {
      if (state.receiptFails > 0) {
        state.receiptFails--;
        throw new Error('RPC timeout');
      }
      return {
        status: 'success',
        transactionHash: hash,
        gasUsed: 70_000n,
        effectiveGasPrice: 10_000_000n,
      };
    },
  } as unknown as PublicClient;
  const signer = { address: RELAYER, signTransaction: jest.fn(async (u: Hex) => u) };

  beforeAll(async () => {
    (global as any).fetch = jest.fn(async (input: string | URL, init?: any) => {
      const url = new URL(String(input));
      const body = JSON.parse(init.body);
      const done = (result: unknown) =>
        new Response(
          JSON.stringify({ activity: { status: 'ACTIVITY_STATUS_COMPLETED', result } }),
          { status: 200 },
        );
      if (url.pathname.endsWith('/create_sub_organization'))
        return done({
          createSubOrganizationResultV8: {
            subOrganizationId: 'tsub',
            wallet: { walletId: 'w', addresses: [account.address] },
          },
        });
      if (url.pathname.endsWith('/create_users'))
        return done({ createUsersResult: { userIds: ['signer'] } });
      if (url.pathname.endsWith('/create_policy'))
        return done({ createPolicyResult: { policyId: 'p' } });
      if (url.pathname.endsWith('/sign_raw_payload')) {
        if (state.signFails > 0) {
          state.signFails--;
          return new Response(JSON.stringify({ message: 'internal' }), { status: 500 });
        }
        state.signs++;
        const sig = parseSignature(
          await account.signTypedData(JSON.parse(body.parameters.payload)),
        );
        return done({
          signRawPayloadResult: {
            r: sig.r.slice(2),
            s: sig.s.slice(2),
            v: sig.yParity ? '01' : '00',
          },
        });
      }
      return new Response('{}', { status: 404 });
    });
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    treasury = app.get(TreasuryService);
    await cleanupTestData(prisma);
    await prisma.treasuryPayout.deleteMany({});
    await prisma.treasury.deleteMany({});
    await prisma.paymentProvider.deleteMany({});
    await prisma.paymentProvider.create({
      data: {
        code: 'CRYPTO',
        name: 'Crypto',
        isActive: true,
        config: { x402: { organizationId: 'org' } },
      } as any,
    });
    const keys = await import('../src/adapters/crypto/x402/relayer-key');
    await new keys.RelayerKeys(prisma).rotate();
    await prisma.wallet.create({
      data: {
        ownerDid: 'did:web:auth-api.inite.ai:agents:dcr_bb',
        subOrganizationId: 's2',
        turnkeyWalletId: 'w',
        address: WALLET,
        ownerKey: '02cd',
      },
    });
    await treasury.setUp({ perTransfer: '500', dailyLimit: '1000' });
    jest
      .spyOn((treasury as any).settlements, 'relayer')
      .mockImplementation(async () => new Relayer(signer, client));
    // The reconcile reads the chain through the same fake.
    jest.spyOn(relayerModule, 'baseClient').mockImplementation(() => client);
  });

  afterAll(async () => {
    (global as any).fetch = realFetch;
    await prisma.treasuryPayout.deleteMany({});
    await prisma.treasury.deleteMany({});
    await cleanupTestData(prisma);
    await prisma.paymentProvider.deleteMany({});
    await app.close();
    await prisma.$disconnect();
  });

  const paidTopup = async (amount = '25') => {
    const { sessionId } = await treasury.startCardTopup(WALLET, amount);
    await prisma.order.update({ where: { id: sessionId }, data: { status: 'paid' } });
    return sessionId;
  };
  const payout = (orderId: string) =>
    prisma.treasuryPayout.findUniqueOrThrow({ where: { orderId } });
  const expire = (orderId: string) =>
    prisma.treasuryPayout.update({
      where: { orderId },
      data: { validBefore: new Date(Date.now() - 10 * 60_000) },
    });

  it('pays once even when run again and again, also in parallel', async () => {
    const order = await paidTopup();
    await Promise.all([treasury.payOut(), treasury.payOut(), treasury.payOut()]);
    await treasury.payOut();
    expect((await payout(order)).status).toBe('mined');
    expect(state.sent).toHaveLength(1);
  });

  it('a lost confirmation after sending is never sent again; the chain settles it', async () => {
    const before = state.sent.length;
    state.receiptFails = 1;
    const order = await paidTopup();
    await treasury.payOut();
    const p = await payout(order);
    expect(p.status).toBe('submitted');
    expect(state.sent.length).toBe(before + 1);
    // The transfer went through on chain; even long past its expiry it is not retried.
    state.usedNonces.add(p.nonce!.toLowerCase());
    await expire(order);
    await treasury.payOut();
    expect((await payout(order)).status).toBe('mined');
    expect(state.sent.length).toBe(before + 1);
  });

  it('a failure before sending is retried only once the old authorization is dead', async () => {
    const before = state.sent.length;
    state.signFails = 1;
    const order = await paidTopup();
    await treasury.payOut();
    const failed = await payout(order);
    expect(failed.status).toBe('failed');
    // Not expired yet: no retry, even though it failed.
    await treasury.payOut();
    expect((await payout(order)).nonce).toBe(failed.nonce);
    expect(state.sent.length).toBe(before);
    // Expired and unused on chain: a fresh attempt with a new nonce.
    await expire(order);
    await treasury.payOut();
    const done = await payout(order);
    expect(done.status).toBe('mined');
    expect(done.nonce).not.toBe(failed.nonce);
    expect(done.attempts).toBe(2);
    expect(state.sent.length).toBe(before + 1);
  });

  it('a sent attempt whose nonce stays unused past expiry (dropped) gets one new attempt', async () => {
    const before = state.sent.length;
    state.receiptFails = 1;
    const order = await paidTopup();
    await treasury.payOut();
    expect((await payout(order)).status).toBe('submitted');
    await expire(order); // never used on chain
    await treasury.payOut();
    const p = await payout(order);
    expect(p.status).toBe('mined');
    expect(p.attempts).toBe(2);
    expect(state.sent.length).toBe(before + 2);
  });
});
