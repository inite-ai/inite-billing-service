jest.mock('node:dns/promises', () => ({
  lookup: jest.fn(async (host: string) =>
    host === 'internal.example' ? [{ address: '10.0.0.5' }] : [{ address: '93.184.216.34' }],
  ),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as jwt from 'jsonwebtoken';
import { getAddress, parseSignature, verifyTypedData } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { TestAppModule } from './test-app.module';
import { PrismaService } from '../src/common/services/prisma.service';
import { cleanupTestData } from './helpers/cleanup.helper';
import { AgentPaymentsService } from '../src/wallet/agent-payments.service';
import { WalletService } from '../src/wallet/wallet.service';
import {
  decodePayment,
  encodeHeader,
  paymentRequired,
  typedData,
} from '../src/adapters/crypto/x402/protocol';
import { isPublicAddress } from '../src/wallet/x402-client';

/**
 * An AI agent pays from a person's INITE wallet, end to end with real tokens
 * and a real database: the agent's token is checked for resource, actor and
 * grant; the person approves the agent with the wallet passkey (its Turnkey
 * user, then its policy); the agent fetches a paid article, billing reads the
 * 402, keeps within the limits, signs with the agent's key and repeats the
 * request. Turnkey, Auth's DID documents, the seller and the chain are faked.
 */
describe('INITE wallet agents E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const realFetch = global.fetch;

  const PERSON = 'did:key:z6MkPerson';
  const AGENT_ID = '11111111-2222-4333-8444-555555555555';
  const AGENT = `did:web:auth-api.inite.ai:agents:${AGENT_ID}`;
  const RESOURCE = 'http://localhost:3001/mcp/wallet';
  const SHOP = getAddress('0x5555555555555555555555555555555555555555');
  const owner = privateKeyToAccount(generatePrivateKey());
  const passkeyStamp = JSON.stringify({
    credentialId: 'cred-wallet-1',
    authenticatorData: 'YQ',
    clientDataJson: 'Yw',
    signature: 'cw',
  });

  const state = {
    agentLive: true,
    turnkey: [] as { path: string; body: any; headers: Record<string, string> }[],
    seller: [] as { headers: Record<string, string> }[],
    balance: 20_000_000n,
  };

  const token = (claims: Record<string, unknown>) =>
    jwt.sign({ sub: PERSON, ...claims }, 'test-jwt-secret', { algorithm: 'HS256', expiresIn: 600 });
  const agentToken = (extra: Record<string, unknown> = {}) =>
    token({
      aud: RESOURCE,
      scope: 'wallet:pay',
      act: { sub: AGENT, client_id: 'dcr_agent' },
      authorization_details: [
        {
          type: 'inite_wallet',
          limits: { currency: 'USD', per_payment: '2', daily: '3', monthly: '50' },
        },
      ],
      ...extra,
    });
  const personToken = () => token({});

  const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });

  const MCP = { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' };
  const call = async (name: string, args: Record<string, unknown> = {}, auth = agentToken()) => {
    const res = await request(app.getHttpServer())
      .post('/mcp/wallet')
      .set(MCP)
      .set('Authorization', `Bearer ${auth}`)
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    const text = res.text ?? '';
    const line = text.split('\n').find((l) => l.startsWith('data:'));
    const body = line ? JSON.parse(line.slice(5)) : JSON.parse(text);
    return { isError: !!body.result?.isError, data: JSON.parse(body.result.content[0].text) };
  };
  const asPerson = (r: request.Test) => r.set('Authorization', `Bearer ${personToken()}`);

  beforeAll(async () => {
    process.env.FRONTEND_URL = 'http://localhost:3001';
    (global as any).fetch = jest.fn(async (input: string | URL, init?: any) => {
      const url = new URL(String(input));
      const headers = Object.fromEntries(
        Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]),
      );
      if (url.host === 'auth-api.inite.ai') {
        if (!state.agentLive) return reply(410, { error: 'gone' });
        return reply(200, {
          id: AGENT,
          controller: PERSON,
          service: [
            {
              type: 'OAuthClient',
              serviceEndpoint: { client_id: 'dcr_agent', name: 'Research Bot' },
            },
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
              subOrganizationId: 'sub-1',
              wallet: { walletId: 'w-1', addresses: [owner.address] },
            },
          });
        }
        if (url.pathname.endsWith('/create_users'))
          return done({ createUsersResult: { userIds: ['agent-user-1'] } });
        if (url.pathname.endsWith('/create_policy'))
          return done({ createPolicyResult: { policyId: 'policy-1' } });
        if (url.pathname.endsWith('/sign_raw_payload')) {
          // The agent's key stamps (X-Stamp), within the person's sub-organization.
          if (!headers['x-stamp'] || body.organizationId !== 'sub-1')
            return reply(403, { message: 'denied' });
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
      if (url.host === 'shop.example') {
        state.seller.push({ headers });
        const paid = headers['payment-signature'];
        if (!paid) {
          const terms = paymentRequired(
            {
              amountRaw: url.pathname === '/dear' ? '2500000' : '1500000',
              receiverAddress: SHOP,
              expiresAt: new Date(Date.now() + 600_000),
            },
            { url: url.toString(), description: 'An article' },
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
          { article: 'The text you paid for' },
          {
            'payment-response': encodeHeader({
              success: true,
              transaction: `0x${'ab'.repeat(32)}`,
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
      .spyOn(app.get(WalletService) as any, 'balance')
      .mockImplementation(async () => state.balance);
    jest
      .spyOn(app.get(AgentPaymentsService) as any, 'usdcBalance')
      .mockImplementation(async () => state.balance);
  });

  afterAll(async () => {
    (global as any).fetch = realFetch;
    await cleanupTestData(prisma);
    await prisma.paymentProvider.deleteMany({});
    await app.close();
    await prisma.$disconnect();
  });

  it('tells an agent without a token where to get one (RFC 9728)', async () => {
    const meta = await request(app.getHttpServer())
      .get('/.well-known/oauth-protected-resource/mcp/wallet')
      .expect(200);
    expect(meta.body).toMatchObject({ resource: RESOURCE, scopes_supported: ['wallet:pay'] });

    const res = await request(app.getHttpServer())
      .post('/mcp/wallet')
      .set(MCP)
      .send({})
      .expect(401);
    expect(res.headers['www-authenticate']).toContain(
      'resource_metadata="http://localhost:3001/.well-known/oauth-protected-resource/mcp/wallet"',
    );
  });

  it('takes only an agent’s token, issued for the wallet, with the grant', async () => {
    const post = (auth: string) =>
      request(app.getHttpServer())
        .post('/mcp/wallet')
        .set(MCP)
        .set('Authorization', `Bearer ${auth}`)
        .send({});
    // A token the agent got for another site cannot be spent here.
    await post(agentToken({ aud: 'https://other.example/mcp' })).expect(401);
    // The person's own token is for the account page.
    await post(token({ aud: RESOURCE, scope: 'wallet:pay' })).expect(403);
    await post(agentToken({ scope: 'openid', authorization_details: [] })).expect(403);
    // And an agent's token is refused on the account endpoints.
    await request(app.getHttpServer())
      .get('/v1/wallet')
      .set('Authorization', `Bearer ${agentToken()}`)
      .expect(403);
  });

  it('asks the person to open a wallet, then to approve the agent', async () => {
    const none = await call('wallet_balance');
    expect(none.isError).toBe(true);
    expect(none.data.message).toContain('no INITE wallet yet');

    await asPerson(request(app.getHttpServer()).post('/v1/wallet'))
      .send({
        passkey: {
          challenge: 'Yw',
          credentialId: 'cred-wallet-1',
          clientDataJson: 'Yw',
          attestationObject: 'Yw',
          transports: ['internal'],
        },
      })
      .expect(201);

    const pending = await call('wallet_balance');
    expect(pending.data).toMatchObject({
      status: 'pending',
      address: owner.address,
      balance: '20',
    });
    expect(pending.data.approve).toContain('/account#inite-wallet');
    const refused = await call('pay', { url: 'https://shop.example/article', maxAmount: '2' });
    expect(refused.data.reason).toBe('needs_approval');
  });

  it('is approved with the wallet passkey: a Turnkey user, then a capped policy', async () => {
    const [agent] = (
      await asPerson(request(app.getHttpServer()).get('/v1/wallet/agents')).expect(200)
    ).body;
    expect(agent).toMatchObject({
      agentDid: AGENT,
      name: 'Research Bot',
      status: 'pending',
      requested: { perPayment: '2', daily: '3', monthly: '50' },
    });

    await asPerson(request(app.getHttpServer()).post(`/v1/wallet/agents/${agent.id}/approve`))
      .send({ perPayment: '5', daily: '3', monthly: '50' })
      .expect(400);
    const step1 = (
      await asPerson(request(app.getHttpServer()).post(`/v1/wallet/agents/${agent.id}/approve`))
        .send({ perPayment: '2', daily: '3', monthly: '50' })
        .expect(201)
    ).body;
    expect(step1).toMatchObject({ step: 'user', credentialId: 'cred-wallet-1' });
    const user = JSON.parse(step1.request);
    expect(user).toMatchObject({ type: 'ACTIVITY_TYPE_CREATE_USERS_V4', organizationId: 'sub-1' });
    expect(user.parameters.users[0].apiKeys[0]).toMatchObject({ curveType: 'API_KEY_CURVE_P256' });
    expect(user.parameters.users[0].authenticators).toEqual([]);

    const step2 = (
      await asPerson(
        request(app.getHttpServer()).post(`/v1/wallet/agents/${agent.id}/approve/confirm`),
      )
        .send({ stamp: passkeyStamp })
        .expect(201)
    ).body;
    expect(step2.step).toBe('policy');
    const policy = JSON.parse(step2.request).parameters;
    expect(policy.consensus).toBe("approvers.any(user, user.id == 'agent-user-1')");
    expect(policy.condition).toContain("eth.eip_712.primary_type == 'TransferWithAuthorization'");
    expect(policy.condition).toContain("eth.eip_712.message['value'] <= 2000000");

    const done = (
      await asPerson(
        request(app.getHttpServer()).post(`/v1/wallet/agents/${agent.id}/approve/confirm`),
      )
        .send({ stamp: passkeyStamp })
        .expect(201)
    ).body;
    expect(done.agent).toMatchObject({
      status: 'active',
      limits: { perPayment: '2', daily: '3', monthly: '50' },
    });
    // Both requests went to Turnkey exactly as prepared, under the passkey's stamp.
    const stamped = state.turnkey.filter((t) => t.headers['x-stamp-webauthn']);
    expect(stamped.map((t) => t.path)).toEqual([
      '/public/v1/submit/create_users',
      '/public/v1/submit/create_policy',
    ]);
  });

  it('pays a 402 within the limits and returns the site’s answer', async () => {
    const free = await call('wallet_balance');
    expect(free.data).toMatchObject({ status: 'active', left: { today: '3', month: '50' } });

    const res = await call('pay', { url: 'https://shop.example/article', maxAmount: '2' });
    expect(res.isError).toBe(false);
    expect(res.data.paid).toMatchObject({ amount: '1.5', currency: 'USDC', payTo: SHOP });
    expect(res.data.response).toMatchObject({ status: 200 });
    expect(JSON.parse(res.data.response.body)).toEqual({ article: 'The text you paid for' });

    const signed = state.turnkey.find((t) => t.path.endsWith('/sign_raw_payload'))!;
    expect(signed.headers['x-stamp']).toBeDefined();
    expect(signed.headers['x-stamp-webauthn']).toBeUndefined();

    const history = await call('payments');
    expect(history.data[0]).toMatchObject({ amount: '1.5', status: 'paid' });
    expect((await call('wallet_balance')).data.left).toEqual({ today: '1.5', month: '48.5' });
  });

  it('refuses what is over maxAmount, the payment limit or the day', async () => {
    expect(
      (await call('pay', { url: 'https://shop.example/article', maxAmount: '1' })).data.reason,
    ).toBe('over_max_amount');
    expect(
      (await call('pay', { url: 'https://shop.example/dear', maxAmount: '5' })).data.reason,
    ).toBe('over_payment_limit');
    // 1.5 + 1.5 fills the day exactly; the next one would pass it.
    expect(
      (await call('pay', { url: 'https://shop.example/article', maxAmount: '2' })).data.paid,
    ).toBeTruthy();
    expect(
      (await call('pay', { url: 'https://shop.example/article', maxAmount: '2' })).data.reason,
    ).toBe('over_daily_limit');
    expect(
      (await call('pay', { url: 'https://internal.example/x', maxAmount: '2' })).data.reason,
    ).toBe('invalid_url');
    expect((await call('pay', { url: 'http://shop.example/x', maxAmount: '2' })).data.reason).toBe(
      'invalid_url',
    );
  });

  it('stops at once when the person disconnects the agent', async () => {
    state.agentLive = false;
    await new Promise((r) => setTimeout(r, 0));
    // The DID document is cached for a minute; a revoke from the account is immediate.
    const [agent] = (
      await asPerson(request(app.getHttpServer()).get('/v1/wallet/agents')).expect(200)
    ).body;
    await asPerson(
      request(app.getHttpServer()).post(`/v1/wallet/agents/${agent.id}/revoke`),
    ).expect(201);
    const row = await prisma.walletAgent.findUniqueOrThrow({ where: { id: agent.id } });
    expect(row).toMatchObject({ status: 'revoked', apiPrivateKey: null });
    const res = await call('pay', { url: 'https://shop.example/article', maxAmount: '2' });
    expect(res.isError).toBe(true);
    expect(res.data.message).toContain('no longer has access');
  });

  it('knows which addresses are not on the public internet', () => {
    for (const ip of [
      '10.1.2.3',
      '127.0.0.1',
      '169.254.169.254',
      '192.168.1.1',
      '172.20.0.1',
      '::1',
      'fd00::1',
      '::ffff:10.0.0.1',
    ]) {
      expect(isPublicAddress(ip)).toBe(false);
    }
    for (const ip of ['93.184.216.34', '2606:4700::1111']) expect(isPublicAddress(ip)).toBe(true);
  });
});
