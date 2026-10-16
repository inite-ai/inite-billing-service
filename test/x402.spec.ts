import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import {
  getAddress,
  keccak256,
  parseTransaction,
  toHex,
  verifyTypedData,
  type Hex,
  type PublicClient,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { TestAppModule } from './test-app.module';
import { PrismaService } from '../src/common/services/prisma.service';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { JwtOrServiceGuard } from '../src/auth/guards/jwt-or-service.guard';
import { MockJwtAuthGuard, MockJwtOrServiceGuard } from './mocks/auth.mock';
import {
  CheckoutLinkOrJwtGuard,
  CheckoutLinkOrJwtOrServiceGuard,
} from '../src/checkout/checkout-link.guard';
import { cleanupTestData } from './helpers/cleanup.helper';
import { WebhookProcessor } from '../src/workers/webhook.processor';
import { X402Service } from '../src/checkout/x402.service';
import { Relayer, TRANSFER_WITH_AUTHORIZATION_SELECTOR } from '../src/adapters/crypto/x402/relayer';
import { Authorization, typedData, usdcAddress } from '../src/adapters/crypto/x402/protocol';
import { openKey } from '../src/common/key-seal';

/**
 * An agent pays a checkout session over x402, end to end against a real
 * database: the session offers an x402 URL, the URL answers 402 with the
 * invoice's terms, a signed authorization is checked and handed to the
 * relayer, and the crypto watcher — seeing the transfer on Base — settles the
 * order like any crypto payment. Only the chain and Turnkey are faked.
 */
describe('x402 E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const realFetch = global.fetch;

  const WALLET = getAddress('0x2222222222222222222222222222222222222222');
  const RELAYER = getAddress('0x3333333333333333333333333333333333333333');
  const payer = privateKeyToAccount(generatePrivateKey());

  /** What the fake chain knows. */
  const chain = {
    sent: [] as Hex[],
    used: new Set<string>(),
    balance: 10_000_000n,
    gasPrice: 10_000_000n,
    block: 1_000n,
    /** Transfer logs into our wallet, as eth_getLogs returns them. */
    logs: [] as any[],
  };

  /** The parts of a viem PublicClient the relayer uses, against `chain`. */
  const client = {
    verifyTypedData: (args: any) => verifyTypedData(args),
    readContract: async ({ functionName, args }: any) =>
      functionName === 'authorizationState'
        ? chain.used.has(`${args[0].toLowerCase()}:${args[1]}`)
        : chain.balance,
    estimateGas: async () => 80_000n,
    estimateFeesPerGas: async () => ({
      maxFeePerGas: chain.gasPrice,
      maxPriorityFeePerGas: 1_000_000n,
    }),
    getTransactionCount: async () => chain.sent.length,
    sendRawTransaction: async ({ serializedTransaction }: any) => {
      chain.sent.push(serializedTransaction);
      return keccak256(serializedTransaction);
    },
    waitForTransactionReceipt: async ({ hash }: any) => ({
      status: 'success',
      transactionHash: hash,
      gasUsed: 70_000n,
      effectiveGasPrice: chain.gasPrice,
    }),
  } as unknown as PublicClient;

  /** Stands in for Turnkey: returns the unsigned transaction it was asked to sign. */
  const signer = {
    address: RELAYER,
    signTransaction: jest.fn(async (unsigned: Hex) => unsigned),
  };

  const http = () => request(app.getHttpServer());
  const asUser = () => (MockJwtAuthGuard.testUserRoles = ['user']);
  const asAdmin = () => (MockJwtAuthGuard.testUserRoles = ['admin']);

  const newSession = async () => {
    asUser();
    const res = await http()
      .post('/v1/checkout/sessions')
      .send({ priceCode: 'x402-e2e-usd', mode: 'PAYMENT' })
      .expect(201);
    return res.body as { sessionId: string; checkoutUrl: string; x402Url?: string };
  };

  /** The path and query of an x402 URL, for supertest. */
  const local = (url: string) => {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  };

  const decode = (header: string) => JSON.parse(Buffer.from(header, 'base64').toString('utf8'));

  const authorize = async (overrides: Partial<Authorization> = {}, amount?: string) => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const authorization: Authorization = {
      from: payer.address,
      to: WALLET,
      value: BigInt(amount ?? '0'),
      validAfter: now - 60n,
      validBefore: now + 600n,
      nonce: toHex(crypto.getRandomValues(new Uint8Array(32))),
      ...overrides,
    };
    const signature = await payer.signTypedData(typedData(authorization));
    return { authorization, signature };
  };

  const header = (signed: { authorization: Authorization; signature: Hex }, version: 1 | 2 = 2) => {
    const a = signed.authorization;
    const payload = {
      signature: signed.signature,
      authorization: {
        from: a.from,
        to: a.to,
        value: a.value.toString(),
        validAfter: a.validAfter.toString(),
        validBefore: a.validBefore.toString(),
        nonce: a.nonce,
      },
    };
    const body =
      version === 2
        ? {
            x402Version: 2,
            accepted: { scheme: 'exact', network: 'eip155:8453', asset: usdcAddress() },
            payload,
          }
        : { x402Version: 1, scheme: 'exact', network: 'base', payload };
    return Buffer.from(JSON.stringify(body)).toString('base64');
  };

  /** The terms the session's x402 URL asks for. */
  const terms = async (url: string) => {
    const res = await http().get(local(url)).expect(402);
    return decode(res.headers['payment-required']).accepts[0];
  };

  beforeAll(async () => {
    // The chain as the crypto watcher reads it: Base's public RPC.
    (global as any).fetch = jest.fn(async (url: string, init?: any) => {
      const body = init?.body ? JSON.parse(init.body) : {};
      let result: unknown = {};
      if (new URL(url).host.includes('base')) {
        result =
          body.method === 'eth_blockNumber'
            ? toHex(chain.block)
            : body.method === 'eth_getLogs'
              ? chain.logs
              : null;
        result = { jsonrpc: '2.0', id: body.id, result };
      }
      return { ok: true, status: 200, json: async () => result };
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(MockJwtAuthGuard)
      .overrideGuard(JwtOrServiceGuard)
      .useClass(MockJwtOrServiceGuard)
      .overrideGuard(CheckoutLinkOrJwtGuard)
      .useClass(MockJwtAuthGuard)
      .overrideGuard(CheckoutLinkOrJwtOrServiceGuard)
      .useClass(MockJwtOrServiceGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.paymentProvider.deleteMany({});
    const product = await prisma.product.create({
      data: {
        code: 'x402-e2e',
        name: 'Celestial Code',
        moduleScope: 'test',
        type: 'one_time',
        isActive: true,
      },
    });
    await prisma.price.create({
      data: {
        productId: product.id,
        code: 'x402-e2e-usd',
        currency: 'USD',
        amount: 1,
        isActive: true,
      },
    });
    asAdmin();
    await http()
      .put('/v1/admin/crypto/settings')
      .send({ isActive: true, wallets: { EVM: WALLET } })
      .expect(200);
  });

  it('is set up from the admin page: Turnkey ids there, a key billing makes itself', async () => {
    asAdmin();
    const before = (await http().get('/v1/admin/crypto/settings').expect(200)).body.x402;
    expect(before).toMatchObject({ ready: false, apiPublicKey: null });
    expect(before.missing).toEqual(['organizationId', 'relayerAddress', 'key']);
    // Nothing from the environment makes it settle.
    expect(await (app.get(X402Service) as any).relayer()).toBeNull();

    const made = (await http().post('/v1/admin/crypto/x402/key').expect(201)).body;
    expect(made).toEqual({ publicKey: expect.stringMatching(/^0[23][0-9a-f]{64}$/) });
    await http()
      .put('/v1/admin/crypto/settings')
      .send({
        x402: { organizationId: 'org-test', relayerAddress: RELAYER, turnkeyUserId: 'user-x402' },
      })
      .expect(200);
    await http()
      .put('/v1/admin/crypto/settings')
      .send({ x402: { relayerAddress: '0x123' } })
      .expect(400);

    const res = await http().get('/v1/admin/crypto/settings').expect(200);
    const x402 = res.body.x402;
    expect(x402).toMatchObject({
      ready: true,
      missing: [],
      apiPublicKey: made.publicKey,
      organizationId: 'org-test',
      relayerAddress: RELAYER,
      wallet: WALLET,
    });
    // The policy, filled in: this user, this fee wallet, USDC authorizations only.
    // The recipient is the payer's to choose — withdrawals from INITE wallets go anywhere.
    const policy = JSON.parse(x402.policy);
    expect(policy.consensus).toContain("user.id == 'user-x402'");
    expect(policy.condition).toContain(
      `eth.tx.data[0..10] == '${TRANSFER_WITH_AUTHORIZATION_SELECTOR}'`,
    );
    expect(policy.condition).not.toContain('data[98..138]');
    expect(policy.condition).toContain(`wallet_account.address == '${RELAYER.toLowerCase()}'`);
    // The same user opens INITE wallets, and may do nothing else with that policy.
    expect(JSON.parse(x402.walletsPolicy)).toMatchObject({
      consensus: "approvers.any(user, user.id == 'user-x402')",
      condition: "activity.type == 'ACTIVITY_TYPE_CREATE_SUB_ORGANIZATION_V8'",
    });

    // The private half stays in billing: not in any answer.
    const stored = await prisma.x402RelayerKey.findFirstOrThrow({ where: { retiredAt: null } });
    const privateHalf = openKey(stored.privateKey, stored.publicKey);
    expect(JSON.stringify(res.body)).not.toContain(privateHalf);
    expect(JSON.stringify(made)).not.toContain(privateHalf);
    // Kept sealed: the row holds nothing that can stamp.
    expect(stored.privateKey).toMatch(/^sealed:v1:/);
    expect(stored.privateKey).not.toContain(privateHalf);
    const real = await (app.get(X402Service) as any).relayer();
    expect(real?.address).toBe(RELAYER);

    // A new key retires the old one.
    const next = (await http().post('/v1/admin/crypto/x402/key').expect(201)).body;
    expect(next.publicKey).not.toBe(made.publicKey);
    expect(await prisma.x402RelayerKey.count({ where: { retiredAt: null } })).toBe(1);

    // From here on the relayer settles on the fake chain, through the fake Turnkey.
    jest
      .spyOn(app.get(X402Service) as any, 'relayer')
      .mockImplementation(async () => new Relayer(signer, client));
  });

  afterAll(async () => {
    (global as any).fetch = realFetch;
    MockJwtAuthGuard.testUserRoles = ['user'];
    await cleanupTestData(prisma);
    await app.close();
    await prisma.$disconnect();
    await new Promise((r) => setTimeout(r, 200));
  });

  it('offers an x402 URL with the session, and answers 402 with the invoice’s terms', async () => {
    const session = await newSession();
    expect(session.x402Url).toContain(`/v1/x402/sessions/${session.sessionId}?t=`);

    const res = await http().get(local(session.x402Url!)).expect(402);
    expect(res.headers['cache-control']).toContain('no-store');
    const required = decode(res.headers['payment-required']);
    expect(required).toMatchObject({ x402Version: 2, resource: { mimeType: 'application/json' } });
    const accepts = required.accepts[0];
    expect(accepts).toMatchObject({
      scheme: 'exact',
      network: 'eip155:8453',
      asset: usdcAddress(),
      payTo: WALLET,
      extra: { name: 'USD Coin', version: '2' },
    });
    // $1 plus the offset that tells this invoice apart: under a cent.
    expect(BigInt(accepts.amount)).toBeGreaterThan(1_000_000n);
    expect(BigInt(accepts.amount)).toBeLessThan(1_010_000n);
    expect(required.resource.url).not.toContain('?t=');
    // v1 clients read the body.
    expect(res.body.accepts[0]).toMatchObject({
      network: 'base',
      maxAmountRequired: accepts.amount,
    });

    // The same invoice on a second look, not a new one.
    expect((await terms(session.x402Url!)).amount).toBe(accepts.amount);
  });

  it('opens nothing without the link token, or with a wrong one', async () => {
    const session = await newSession();
    await http().get(`/v1/x402/sessions/${session.sessionId}`).expect(404);
    await http().get(`/v1/x402/sessions/${session.sessionId}?t=wrong`).expect(404);
  });

  it('refuses an authorization that does not pay the invoice exactly', async () => {
    const session = await newSession();
    const { amount } = await terms(session.x402Url!);

    const cases: Array<[Partial<Authorization>, string, string]> = [
      [{}, String(BigInt(amount) + 1n), 'invalid_amount'],
      [{ to: RELAYER }, amount, 'invalid_recipient'],
      [{ validBefore: BigInt(Math.floor(Date.now() / 1000) + 5) }, amount, 'expired'],
    ];
    for (const [overrides, value, reason] of cases) {
      const res = await http()
        .get(local(session.x402Url!))
        .set('PAYMENT-SIGNATURE', header(await authorize(overrides, value)))
        .expect(402);
      expect(res.body.errorReason).toBe(reason);
    }

    // Signed by someone other than the payer it names.
    const forged = await authorize({}, amount);
    forged.authorization = { ...forged.authorization, from: RELAYER };
    const res = await http()
      .get(local(session.x402Url!))
      .set('PAYMENT-SIGNATURE', header(forged))
      .expect(402);
    expect(res.body.errorReason).toBe('invalid_signature');
    expect(chain.sent).toHaveLength(0);
  });

  it('settles a signed authorization once, and the watcher completes the order', async () => {
    const session = await newSession();
    const { amount } = await terms(session.x402Url!);
    const signed = await authorize({}, amount);

    const res = await http()
      .get(local(session.x402Url!))
      .set('PAYMENT-SIGNATURE', header(signed))
      .expect(200);
    expect(res.body.status).toBe('confirming');
    const settlement = decode(res.headers['payment-response']);
    expect(settlement).toMatchObject({
      success: true,
      network: 'eip155:8453',
      payer: payer.address,
      amount,
    });

    // One transaction, to USDC, calling transferWithAuthorization and nothing else.
    expect(chain.sent).toHaveLength(1);
    const tx = parseTransaction(chain.sent[0]);
    expect(tx.to?.toLowerCase()).toBe(usdcAddress().toLowerCase());
    expect(tx.data?.startsWith(TRANSFER_WITH_AUTHORIZATION_SELECTOR)).toBe(true);
    expect(tx.chainId).toBe(8453);
    expect(settlement.transaction).toBe(keccak256(chain.sent[0]));

    const row = await prisma.x402Payment.findFirstOrThrow({
      where: { orderId: session.sessionId },
    });
    expect(row).toMatchObject({ status: 'mined', payer: payer.address.toLowerCase() });
    expect(row.feeWei).toBe((70_000n * chain.gasPrice).toString());

    // The same header again — a retry, a replay: the same answer, nothing sent.
    const again = await http()
      .get(local(session.x402Url!))
      .set('PAYMENT-SIGNATURE', header(signed))
      .expect(200);
    expect(decode(again.headers['payment-response']).transaction).toBe(settlement.transaction);
    expect(chain.sent).toHaveLength(1);

    // The transfer lands and becomes final; the watcher sees it like any other.
    chain.used.add(`${payer.address.toLowerCase()}:${signed.authorization.nonce}`);
    chain.logs = [
      {
        transactionHash: settlement.transaction,
        blockNumber: toHex(chain.block),
        data: toHex(BigInt(amount), { size: 32 }),
        topics: [
          '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
          `0x${payer.address.slice(2).toLowerCase().padStart(64, '0')}`,
          `0x${WALLET.slice(2).toLowerCase().padStart(64, '0')}`,
        ],
      },
    ];
    chain.block += 30n;
    asAdmin();
    await http().post('/v1/admin/crypto/poll').expect(201);
    const processor = app.get(WebhookProcessor);
    for (const event of await prisma.webhookEvent.findMany({ where: { rail: 'CRYPTO' } })) {
      await processor.process({ data: { rail: 'CRYPTO', webhookId: event.webhookId } } as any);
    }
    let status = '';
    for (let i = 0; i < 50 && status !== 'paid'; i++) {
      status = (await prisma.order.findUnique({ where: { id: session.sessionId } }))!.status;
      if (status !== 'paid') await new Promise((r) => setTimeout(r, 100));
    }
    expect(status).toBe('paid');

    const after = await http().get(local(session.x402Url!)).expect(200);
    expect(after.body).toMatchObject({ status: 'paid', orderId: session.sessionId });
  });

  it('speaks v1 too', async () => {
    const session = await newSession();
    const { amount } = await terms(session.x402Url!);
    const res = await http()
      .get(local(session.x402Url!))
      .set('X-PAYMENT', header(await authorize({}, amount), 1))
      .expect(200);
    expect(decode(res.headers['x-payment-response'])).toMatchObject({
      success: true,
      network: 'base',
    });
  });

  it('sends nothing while network fees are above the cap', async () => {
    const session = await newSession();
    const { amount } = await terms(session.x402Url!);
    const sent = chain.sent.length;
    chain.gasPrice = 10_000_000_000n;
    try {
      const res = await http()
        .get(local(session.x402Url!))
        .set('PAYMENT-SIGNATURE', header(await authorize({}, amount)))
        .expect(402);
      expect(res.body.errorReason).toBe('network_busy');
      expect(chain.sent).toHaveLength(sent);
      // Refused before sending: the authorization is not held, it can be retried.
      expect(await prisma.x402Payment.count({ where: { orderId: session.sessionId } })).toBe(0);
    } finally {
      chain.gasPrice = 10_000_000n;
    }
  });

  it('counts an authorization someone else put on chain as paid', async () => {
    const session = await newSession();
    const { amount } = await terms(session.x402Url!);
    const signed = await authorize({}, amount);
    chain.used.add(`${payer.address.toLowerCase()}:${signed.authorization.nonce}`);
    const sent = chain.sent.length;
    const res = await http()
      .get(local(session.x402Url!))
      .set('PAYMENT-SIGNATURE', header(signed))
      .expect(200);
    expect(res.body.status).toBe('confirming');
    expect(chain.sent).toHaveLength(sent);
  });
});
