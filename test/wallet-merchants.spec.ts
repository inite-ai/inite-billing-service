import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as jwt from 'jsonwebtoken';
import {
  decodeFunctionData,
  getAddress,
  keccak256,
  parseSignature,
  parseTransaction,
  toHex,
  verifyTypedData,
  type Hex,
  type PublicClient,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { TestAppModule } from './test-app.module';
import { PrismaService } from '../src/common/services/prisma.service';
import { cleanupTestData } from './helpers/cleanup.helper';
import { Relayer, USDC_ABI } from '../src/adapters/crypto/x402/relayer';
import { WalletService } from '../src/wallet/wallet.service';
import { AgentPaymentsService } from '../src/wallet/agent-payments.service';
import { WalletMerchantsService } from '../src/wallet/wallet-merchants.service';

/**
 * A site pays its own checkout session from the buyer's INITE wallet, end to
 * end with a real database, a real person's token and real service keys: the
 * site is told to send the person to the approve page; the person makes the
 * wallet's "INITE checkout" user (two passkey stamps) and allows the site with
 * limits; the site's next call pays the session's crypto invoice exactly,
 * within the month, to billing's receiving wallet. Turnkey and the chain are
 * faked.
 */
describe('Pay from the INITE wallet E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const realFetch = global.fetch;

  const PERSON = 'did:key:z6MkBuyer';
  const RAIL = getAddress('0x2222222222222222222222222222222222222222');
  const RELAYER = getAddress('0x3333333333333333333333333333333333333333');
  const owner = privateKeyToAccount(generatePrivateKey());
  const stamp = JSON.stringify({
    credentialId: 'c',
    authenticatorData: 'YQ',
    clientDataJson: 'Yw',
    signature: 'cw',
  });

  const state = {
    turnkey: [] as { path: string; body: any }[],
    sent: [] as Hex[],
    balance: 50_000_000n,
  };

  const client = {
    verifyTypedData: (args: any) => verifyTypedData(args),
    readContract: async ({ functionName }: any) =>
      functionName === 'authorizationState' ? false : state.balance,
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
    waitForTransactionReceipt: async ({ hash }: any) => ({
      status: 'success',
      transactionHash: hash,
      gasUsed: 70_000n,
      effectiveGasPrice: 10_000_000n,
    }),
  } as unknown as PublicClient;
  const signer = { address: RELAYER, signTransaction: jest.fn(async (u: Hex) => u) };

  const personToken = jwt.sign({ sub: PERSON }, 'test-jwt-secret', {
    algorithm: 'HS256',
    expiresIn: 600,
  });
  const http = () => request(app.getHttpServer());
  const asPerson = (r: request.Test) => r.set('Authorization', `Bearer ${personToken}`);
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  let shop: { id: string; code: string; apiKey: string };
  let other: { apiKey: string };

  const newSession = async () => {
    const res = await http()
      .post('/v1/checkout/sessions')
      .set('x-api-key', shop.apiKey)
      .send({ priceCode: 'book-usd', mode: 'PAYMENT', userId: PERSON });
    if (res.status !== 201) throw new Error(`session: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.sessionId as string;
  };
  const payAsShop = (sessionId: string, key = shop.apiKey) =>
    http()
      .post(`/v1/checkout/sessions/${sessionId}/pay-from-wallet`)
      .set('x-api-key', key)
      .send({ userId: PERSON, returnTo: 'https://shop.example/book' });

  beforeAll(async () => {
    (global as any).fetch = jest.fn(async (input: string | URL, init?: any) => {
      const url = new URL(String(input));
      if (url.host === 'api.turnkey.com') {
        const body = JSON.parse(init.body);
        state.turnkey.push({ path: url.pathname, body });
        const done = (result: unknown) =>
          reply(200, { activity: { status: 'ACTIVITY_STATUS_COMPLETED', result } });
        if (url.pathname.endsWith('/create_sub_organization')) {
          return done({
            createSubOrganizationResultV8: {
              subOrganizationId: 'sub-1',
              wallet: { walletId: 'w', addresses: [owner.address] },
            },
          });
        }
        if (url.pathname.endsWith('/create_users'))
          return done({ createUsersResult: { userIds: ['checkout-user'] } });
        if (url.pathname.endsWith('/create_policy'))
          return done({ createPolicyResult: { policyId: 'p' } });
        if (url.pathname.endsWith('/sign_raw_payload')) {
          const sig = parseSignature(
            await owner.signTypedData(JSON.parse(body.parameters.payload)),
          );
          return done({
            signRawPayloadResult: {
              r: sig.r.slice(2),
              s: sig.s.slice(2),
              v: sig.yParity ? '01' : '00',
            },
          });
        }
      }
      // Base RPC for the crypto rail's invoice.
      const rpc = init?.body ? JSON.parse(init.body) : {};
      return reply(200, {
        jsonrpc: '2.0',
        id: rpc.id,
        result: rpc.method === 'eth_blockNumber' ? toHex(1000n) : [],
      });
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    await cleanupTestData(prisma);
    await prisma.paymentProvider.deleteMany({});
    await prisma.paymentProvider.create({
      data: {
        code: 'CRYPTO',
        name: 'Crypto',
        isActive: true,
        config: { wallets: { EVM: RAIL }, x402: { organizationId: 'org' } },
      } as any,
    });
    const keys = await import('../src/adapters/crypto/x402/relayer-key');
    await new keys.RelayerKeys(prisma).rotate();

    const service = await prisma.service.create({
      data: { code: 'shop', name: 'Shop', apiKey: 'shop-key-0123456789' },
    });
    shop = { id: service.id, code: service.code, apiKey: 'shop-key-0123456789' };
    await prisma.service.create({
      data: { code: 'other', name: 'Other', apiKey: 'other-key-0123456789' },
    });
    other = { apiKey: 'other-key-0123456789' };
    const product = await prisma.product.create({
      data: {
        code: 'book',
        name: 'A book',
        moduleScope: 'shop',
        type: 'one_time',
        isActive: true,
        serviceId: service.id,
      },
    });
    await prisma.price.create({
      data: { productId: product.id, code: 'book-usd', currency: 'USD', amount: 4, isActive: true },
    });

    jest
      .spyOn(app.get(WalletService) as any, 'balance')
      .mockImplementation(async () => state.balance);
    jest
      .spyOn(app.get(AgentPaymentsService), 'usdcBalance')
      .mockImplementation(async () => state.balance);
    jest
      .spyOn((app.get(WalletMerchantsService) as any).settlements, 'relayer')
      .mockImplementation(async () => new Relayer(signer, client));
  });

  afterAll(async () => {
    (global as any).fetch = realFetch;
    await cleanupTestData(prisma);
    await prisma.paymentProvider.deleteMany({});
    await prisma.service.deleteMany({ where: { code: { in: ['shop', 'other'] } } });
    await app.close();
    await prisma.$disconnect();
  });

  it('sends the person to the approve page until they allow the site', async () => {
    const session = await newSession();
    const none = await payAsShop(session).expect(409);
    expect(none.body).toMatchObject({ status: 'needs_approval', reason: 'no_wallet' });
    const approve = new URL(none.body.approveUrl);
    expect(approve.pathname).toBe('/account/wallet/approve');
    expect(Object.fromEntries(approve.searchParams)).toEqual({
      service: 'shop',
      session,
      returnTo: 'https://shop.example/book',
    });

    await asPerson(http().post('/v1/wallet'))
      .send({
        passkey: {
          challenge: 'Yw',
          credentialId: 'c',
          clientDataJson: 'Yw',
          attestationObject: 'Yw',
          transports: [],
        },
      })
      .expect(201);
    expect((await payAsShop(session).expect(409)).body.reason).toBe('not_approved');

    // Somebody else's site cannot even see the session.
    await payAsShop(session, other.apiKey).expect(404);
  });

  it('is allowed on one page: the checkout user (two stamps) and the site’s limits', async () => {
    const session = await newSession();
    const page = (
      await asPerson(http().get(`/v1/wallet/sites/shop?session=${session}`)).expect(200)
    ).body;
    expect(page).toMatchObject({
      service: { code: 'shop', name: 'Shop' },
      checkout: 'none',
      allowed: null,
      session: { id: session, product: 'A book', amount: '4', currency: 'USD', status: 'created' },
    });

    const step1 = (await asPerson(http().post('/v1/wallet/checkout/approve')).expect(201)).body;
    expect(step1.step).toBe('user');
    const step2 = (
      await asPerson(http().post('/v1/wallet/checkout/approve/confirm')).send({ stamp }).expect(201)
    ).body;
    expect(step2.step).toBe('policy');
    const policy = JSON.parse(step2.request).parameters;
    expect(policy.consensus).toBe("approvers.any(user, user.id == 'checkout-user')");
    // The checkout key can pay only billing's receiving wallet.
    expect(policy.condition).toContain(`eth.eip_712.message['to'] == '${RAIL.toLowerCase()}'`);
    await asPerson(http().post('/v1/wallet/checkout/approve/confirm')).send({ stamp }).expect(201);

    await asPerson(http().put('/v1/wallet/sites/shop'))
      .send({ perPayment: '5', monthly: '3' })
      .expect(400);
    const allowed = (
      await asPerson(http().put('/v1/wallet/sites/shop'))
        .send({ perPayment: '5', monthly: '6' })
        .expect(200)
    ).body;
    expect(allowed).toMatchObject({
      checkout: 'active',
      allowed: { perPayment: '5', monthly: '6' },
    });
    // The checkout user is not listed among AI agents.
    expect((await asPerson(http().get('/v1/wallet/agents')).expect(200)).body).toEqual([]);
  });

  it('pays the session’s invoice exactly, to billing’s wallet, within the month', async () => {
    const session = await newSession();
    const res = await payAsShop(session).expect(200);
    expect(res.body).toMatchObject({
      status: 'confirming',
      orderId: session,
      txHash: expect.stringMatching(/^0x/),
    });

    const tx = parseTransaction(state.sent[0]!);
    const call = decodeFunctionData({ abi: USDC_ABI, data: tx.data! });
    expect(call.functionName).toBe('transferWithAuthorization');
    const [from, to, value] = call.args as unknown as [string, string, bigint];
    expect([from, to]).toEqual([owner.address, RAIL]);
    const invoice = await prisma.cryptoInvoice.findFirstOrThrow({
      where: { orderId: session },
    } as any);
    expect(value.toString()).toBe(String((invoice as any).amountRaw));

    // 4 + 4 is over the site's 6 a month.
    expect((await payAsShop(await newSession()).expect(409)).body.reason).toBe('over_limit');
    const sites = (await asPerson(http().get('/v1/wallet/sites')).expect(200)).body;
    expect(Number(sites[0].spentThisMonth)).toBeGreaterThanOrEqual(4);
  });

  it('stops when the person takes the permission back', async () => {
    await asPerson(http().delete('/v1/wallet/sites/shop')).expect(200);
    expect((await payAsShop(await newSession()).expect(409)).body.reason).toBe('not_approved');
  });
});
