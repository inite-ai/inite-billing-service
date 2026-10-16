jest.mock('node:dns/promises', () => ({
  lookup: jest.fn(async () => [{ address: '93.184.216.34' }]),
}));

import { createECDH } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as jwt from 'jsonwebtoken';
import { getAddress, parseSignature, verifyTypedData } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { ApiKeyStamper } from '@turnkey/api-key-stamper';
import { TestAppModule } from './test-app.module';
import { PrismaService } from '../src/common/services/prisma.service';
import { cleanupTestData } from './helpers/cleanup.helper';
import { SelfAgentWalletService } from '../src/wallet/self-agent-wallet.service';
import { agentWalletResource } from '../src/wallet/self-agent.guard';
import { ConfigService } from '@nestjs/config';
import {
  decodePayment,
  encodeHeader,
  paymentRequired,
  typedData,
} from '../src/adapters/crypto/x402/protocol';

/**
 * An AI agent with its own INITE identity (registered with its own key, no
 * person behind it) opens its own wallet, owned by that key, and pays an x402
 * seller: billing prepares the Turnkey request, the agent stamps it with its
 * key, billing submits and pays. Turnkey, Auth's DID document, the seller and
 * the chain are faked; the stamp is a real ApiKeyStamper stamp.
 */
describe('Agent with its own identity and wallet E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const realFetch = global.fetch;

  const AGENT_ID = 'dcr_0123456789abcdef0123456789abcdef';
  const AGENT = `did:web:auth-api.inite.ai:agents:${AGENT_ID}`;
  let RESOURCE = '';
  const SHOP = getAddress('0x5555555555555555555555555555555555555555');
  const onchain = privateKeyToAccount(generatePrivateKey());

  // The agent's own P-256 key: in its DID document, and the wallet's owner.
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const agentKey = {
    publicKey: ecdh.getPublicKey('hex', 'compressed'),
    privateKey: ecdh.getPrivateKey('hex').padStart(64, '0'),
  };
  const raw = ecdh.getPublicKey();
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: raw.subarray(1, 33).toString('base64url'),
    y: raw.subarray(33, 65).toString('base64url'),
    kid: 'agent-key',
  };

  const state = {
    turnkey: [] as { path: string; body: any; headers: Record<string, string> }[],
    balance: 10_000_000n,
  };

  const token = (claims: Record<string, unknown> = {}) =>
    `Bearer ${jwt.sign(
      { sub: AGENT, aud: RESOURCE, client_id: AGENT_ID, ...claims },
      'test-jwt-secret',
      {
        algorithm: 'HS256',
        expiresIn: 300,
      },
    )}`;
  const http = () => request(app.getHttpServer());
  const stamp = async (body: string, key = agentKey) =>
    (
      await new ApiKeyStamper({ apiPublicKey: key.publicKey, apiPrivateKey: key.privateKey }).stamp(
        body,
      )
    ).stampHeaderValue;
  const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });

  beforeAll(async () => {
    (global as any).fetch = jest.fn(async (input: string | URL, init?: any) => {
      const url = new URL(String(input));
      const headers = Object.fromEntries(
        Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]),
      );
      if (url.host === 'auth-api.inite.ai' && url.pathname === `/agents/${AGENT_ID}/did.json`) {
        return reply(200, {
          id: AGENT,
          verificationMethod: [
            { id: `${AGENT}#agent-key`, type: 'JsonWebKey2020', publicKeyJwk: jwk },
          ],
        });
      }
      if (url.host === 'api.turnkey.com') {
        const body = JSON.parse(init.body);
        state.turnkey.push({ path: url.pathname, body, headers });
        const done = (result: unknown) =>
          reply(200, { activity: { status: 'ACTIVITY_STATUS_COMPLETED', result } });
        if (url.pathname.endsWith('/create_sub_organization')) {
          return done({
            createSubOrganizationResultV8: {
              subOrganizationId: 'agent-sub',
              wallet: { walletId: 'w', addresses: [onchain.address] },
            },
          });
        }
        if (url.pathname.endsWith('/sign_raw_payload')) {
          // Only the agent's key, stamping the exact body, in its own sub-organization.
          const stamped = JSON.parse(
            Buffer.from(headers['x-stamp'] ?? '', 'base64url').toString() || '{}',
          );
          if (stamped.publicKey !== agentKey.publicKey || body.organizationId !== 'agent-sub') {
            return reply(403, { message: 'denied' });
          }
          const sig = parseSignature(
            await onchain.signTypedData(JSON.parse(body.parameters.payload)),
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
      if (url.host === 'shop.example') {
        if (url.pathname === '/free') return reply(200, { article: 'free' });
        const paid = headers['payment-signature'];
        if (!paid) {
          const terms = paymentRequired(
            {
              amountRaw: '1500000',
              receiverAddress: SHOP,
              expiresAt: new Date(Date.now() + 600_000),
            },
            { url: url.toString(), description: 'A book' },
          );
          return reply(402, { error: 'pay' }, { 'payment-required': encodeHeader(terms) });
        }
        const payment = decodePayment({ 'payment-signature': paid })!;
        const valid = await verifyTypedData({
          address: payment.authorization.from,
          signature: payment.signature,
          ...typedData(payment.authorization),
        });
        if (!valid || payment.authorization.to !== SHOP)
          return reply(402, { error: 'bad signature' });
        return reply(
          200,
          { book: 'yours' },
          {
            'payment-response': encodeHeader({
              success: true,
              transaction: `0x${'cd'.repeat(32)}`,
            }),
          },
        );
      }
      return reply(404, {});
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
    RESOURCE = agentWalletResource(app.get(ConfigService));
    await cleanupTestData(prisma);
    await prisma.paymentProvider.deleteMany({});
    await prisma.paymentProvider.create({
      data: {
        code: 'CRYPTO',
        name: 'Crypto',
        isActive: true,
        config: { x402: { organizationId: 'org-test' } },
      } as any,
    });
    const keys = await import('../src/adapters/crypto/x402/relayer-key');
    await new keys.RelayerKeys(prisma).rotate();
    jest
      .spyOn(app.get(SelfAgentWalletService), 'balance')
      .mockImplementation(async () => state.balance);
  });

  afterAll(async () => {
    (global as any).fetch = realFetch;
    await cleanupTestData(prisma);
    await prisma.paymentProvider.deleteMany({});
    await app.close();
    await prisma.$disconnect();
  });

  it('lets in only an agent with its own identity, with a token for this API', async () => {
    await http()
      .get('/v1/agent-wallet')
      .set('Authorization', token({ aud: 'https://other.example' }))
      .expect(401);
    await http()
      .get('/v1/agent-wallet')
      .set('Authorization', token({ sub: 'did:key:z6MkPerson' }))
      .expect(403);
    await http()
      .get('/v1/agent-wallet')
      .set('Authorization', token({ act: { sub: 'did:web:x', client_id: 'c' } }))
      .expect(403);
    const none = await http().get('/v1/agent-wallet').set('Authorization', token()).expect(200);
    expect(none.body.wallet).toBeNull();
  });

  it('opens a wallet whose only owner is the agent’s key from its DID document', async () => {
    const res = await http().post('/v1/agent-wallet').set('Authorization', token()).expect(201);
    expect(res.body.wallet).toMatchObject({
      address: onchain.address,
      ownerKey: agentKey.publicKey,
    });
    expect(res.body.fund).toContain(onchain.address);
    const create = state.turnkey.find((c) => c.path.endsWith('/create_sub_organization'))!;
    expect(create.body.parameters.rootUsers).toEqual([
      {
        userName: 'Agent',
        apiKeys: [
          {
            apiKeyName: 'Agent key',
            publicKey: agentKey.publicKey,
            curveType: 'API_KEY_CURVE_P256',
          },
        ],
        oauthProviders: [],
        authenticators: [],
      },
    ]);
    // Asking again gives the same wallet.
    await http().post('/v1/agent-wallet').set('Authorization', token()).expect(201);
    expect(state.turnkey.filter((c) => c.path.endsWith('/create_sub_organization'))).toHaveLength(
      1,
    );
  });

  it('passes a seller that does not ask for payment straight through', async () => {
    const res = await http()
      .post('/v1/agent-wallet/payments')
      .set('Authorization', token())
      .send({ url: 'https://shop.example/free', maxAmount: '1' })
      .expect(201);
    expect(res.body).toMatchObject({ payment: null, response: { status: 200 } });
  });

  it('refuses more than maxAmount', async () => {
    await http()
      .post('/v1/agent-wallet/payments')
      .set('Authorization', token())
      .send({ url: 'https://shop.example/book', maxAmount: '1' })
      .expect(400);
  });

  it('pays the seller with the request the agent stamped with its key', async () => {
    const prepared = (
      await http()
        .post('/v1/agent-wallet/payments')
        .set('Authorization', token())
        .send({ url: 'https://shop.example/book', maxAmount: '2' })
        .expect(201)
    ).body.payment;
    expect(prepared).toMatchObject({ amount: '1.5', payTo: SHOP, status: 'prepared' });

    // Somebody else's key: refused before Turnkey is asked.
    const other = createECDH('prime256v1');
    other.generateKeys();
    await http()
      .post(`/v1/agent-wallet/payments/${prepared.id}/confirm`)
      .set('Authorization', token())
      .send({
        stamp: await stamp(prepared.request, {
          publicKey: other.getPublicKey('hex', 'compressed'),
          privateKey: other.getPrivateKey('hex').padStart(64, '0'),
        }),
      })
      .expect(400);

    const paid = await http()
      .post(`/v1/agent-wallet/payments/${prepared.id}/confirm`)
      .set('Authorization', token())
      .send({ stamp: await stamp(prepared.request) })
      .expect(201);
    expect(paid.body.payment).toMatchObject({
      status: 'paid',
      httpStatus: 200,
      transaction: `0x${'cd'.repeat(32)}`,
    });
    expect(JSON.parse(paid.body.response.body)).toEqual({ book: 'yours' });

    // Billing submitted exactly the body it prepared, under the agent's stamp.
    const sign = state.turnkey.filter((c) => c.path.endsWith('/sign_raw_payload')).pop()!;
    expect(JSON.stringify(sign.body)).toBe(prepared.request);
    await http()
      .post(`/v1/agent-wallet/payments/${prepared.id}/confirm`)
      .set('Authorization', token())
      .send({ stamp: await stamp(prepared.request) })
      .expect(409);

    const overview = await http().get('/v1/agent-wallet').set('Authorization', token()).expect(200);
    expect(overview.body.payments[0]).toMatchObject({ amount: '1.5', status: 'paid' });
  });
});
