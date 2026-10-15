import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import {
  decodeFunctionData,
  getAddress,
  keccak256,
  parseSignature,
  parseTransaction,
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
import { cleanupTestData } from './helpers/cleanup.helper';
import { Relayer, USDC_ABI } from '../src/adapters/crypto/x402/relayer';
import { usdcAddress } from '../src/adapters/crypto/x402/protocol';
import { WalletService, joinSignature } from '../src/wallet/wallet.service';
import { HODLE_UNMATCHED_EVENT, HodleAdapter } from '../src/adapters/hodle/hodle.adapter';

/**
 * A person's INITE wallet, end to end against a real database: opened with a
 * passkey as a Turnkey sub-organization, topped up by PIX straight to its
 * address, emptied by a withdrawal the passkey signs and the relayer sends.
 * Turnkey, Hodle and the chain are faked; the fake Turnkey signs with the
 * wallet's key only when given a passkey stamp of the exact prepared request.
 */
describe('INITE wallet E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let wallets: WalletService;
  const realFetch = global.fetch;

  const RAIL_WALLET = getAddress('0x2222222222222222222222222222222222222222');
  const RELAYER = getAddress('0x3333333333333333333333333333333333333333');
  const FRIEND = getAddress('0x4444444444444444444444444444444444444444');
  /** The key Turnkey holds in the person's sub-organization. */
  const owner = privateKeyToAccount(generatePrivateKey());

  const passkey = {
    challenge: 'Y2hhbGxlbmdl',
    credentialId: 'cred-wallet-1',
    clientDataJson: 'eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0',
    attestationObject: 'o2NmbXRkbm9uZQ',
    transports: ['internal', 'hybrid'],
  };
  const stamp = JSON.stringify({
    credentialId: passkey.credentialId,
    authenticatorData: 'YXV0aA',
    clientDataJson: 'Y2xpZW50',
    signature: 'c2ln',
  });

  const turnkey = { subOrgs: [] as any[], signed: [] as { body: string; stamp: string }[] };
  const hodle = { deposits: [] as any[], status: 'PENDING' };
  const chain = { sent: [] as Hex[], balance: 10_000_000n };

  const client = {
    verifyTypedData: (args: any) => verifyTypedData(args),
    readContract: async ({ functionName }: any) =>
      functionName === 'authorizationState' ? false : chain.balance,
    estimateGas: async () => 80_000n,
    estimateFeesPerGas: async () => ({
      maxFeePerGas: 10_000_000n,
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
      effectiveGasPrice: 10_000_000n,
    }),
  } as unknown as PublicClient;
  const signer = { address: RELAYER, signTransaction: jest.fn(async (unsigned: Hex) => unsigned) };

  const http = () => request(app.getHttpServer());
  const asUser = () => {
    MockJwtAuthGuard.testUserRoles = ['user'];
    MockJwtAuthGuard.testActor = undefined;
  };
  const asAdmin = () => (MockJwtAuthGuard.testUserRoles = ['admin']);
  const reply = (status: number, body: unknown) => ({
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });

  beforeAll(async () => {
    (global as any).fetch = jest.fn(async (url: string, init?: any) => {
      const { host, pathname } = new URL(url);
      const headers = Object.fromEntries(
        Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
      ) as Record<string, string>;
      if (host === 'api.turnkey.com' && pathname === '/public/v1/submit/create_sub_organization') {
        const body = JSON.parse(init.body);
        turnkey.subOrgs.push({ body, stamped: !!headers['x-stamp'] });
        return reply(200, {
          activity: {
            status: 'ACTIVITY_STATUS_COMPLETED',
            result: {
              createSubOrganizationResultV8: {
                subOrganizationId: `sub-${turnkey.subOrgs.length}`,
                wallet: { walletId: 'w-1', addresses: [owner.address] },
                rootUserIds: ['root-1'],
              },
            },
          },
        });
      }
      if (host === 'api.turnkey.com' && pathname === '/public/v1/submit/sign_raw_payload') {
        // Turnkey signs only what the passkey stamped, in the person's sub-organization.
        if (!headers['x-stamp-webauthn']) return reply(401, { message: 'no stamp' });
        turnkey.signed.push({ body: init.body, stamp: headers['x-stamp-webauthn'] });
        const { organizationId, parameters } = JSON.parse(init.body);
        if (organizationId !== 'sub-1' || parameters.encoding !== 'PAYLOAD_ENCODING_EIP712') {
          return reply(403, { message: 'not allowed' });
        }
        const sig = parseSignature(await owner.signTypedData(JSON.parse(parameters.payload)));
        return reply(200, {
          activity: {
            status: 'ACTIVITY_STATUS_COMPLETED',
            result: {
              signRawPayloadResult: {
                r: sig.r.slice(2),
                s: sig.s.slice(2),
                v: sig.yParity === 0 ? '00' : '01',
              },
            },
          },
        });
      }
      if (host === 'api.hodle.com.br' && pathname === '/api/deposit/asset') {
        const body = JSON.parse(init.body);
        hodle.deposits.push(body);
        return reply(200, { qrCode: '00020126pix', externalId: body.externalId, fee: 75 });
      }
      if (host === 'api.hodle.com.br' && pathname.startsWith('/api/deposit/asset/')) {
        return reply(200, { data: { status: hodle.status } });
      }
      return reply(404, {});
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(MockJwtAuthGuard)
      .overrideGuard(JwtOrServiceGuard)
      .useClass(MockJwtOrServiceGuard)
      .compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    wallets = app.get(WalletService);
    await prisma.paymentProvider.deleteMany({});
    await prisma.x402RelayerKey.deleteMany({});
    jest.spyOn(wallets as any, 'balance').mockImplementation(async () => chain.balance);
  });

  afterAll(async () => {
    (global as any).fetch = realFetch;
    asUser();
    await cleanupTestData(prisma);
    await prisma.paymentProvider.deleteMany({});
    await app.close();
    await prisma.$disconnect();
    await new Promise((r) => setTimeout(r, 200));
  });

  it('cannot be opened before Turnkey is set up', async () => {
    asUser();
    const res = await http().get('/v1/wallet').expect(200);
    expect(res.body).toMatchObject({ wallet: null, canOpen: false, canWithdraw: false });
    await http().post('/v1/wallet').send({ passkey }).expect(503);
  });

  it('is the person’s: an agent’s token for them is refused', async () => {
    asUser();
    MockJwtAuthGuard.testActor = 'did:web:auth-api.inite.ai:agents:1';
    await http().get('/v1/wallet').expect(403);
    await http().post('/v1/wallet').send({ passkey }).expect(403);
    asUser();
  });

  it('opens as a sub-organization whose only root user is the passkey', async () => {
    asAdmin();
    await http()
      .put('/v1/admin/crypto/settings')
      .send({
        isActive: true,
        wallets: { EVM: RAIL_WALLET },
        x402: {
          organizationId: 'org-test',
          relayerAddress: RELAYER,
          turnkeyUserId: 'user-billing',
        },
      })
      .expect(200);
    await http().post('/v1/admin/crypto/x402/key').expect(201);

    asUser();
    expect((await http().get('/v1/wallet').expect(200)).body.canOpen).toBe(true);
    const res = await http().post('/v1/wallet').send({ passkey }).expect(201);
    expect(res.body.wallet).toMatchObject({
      address: owner.address,
      asset: 'USDC',
      network: 'eip155:8453',
      balance: '10',
      credentialId: passkey.credentialId,
    });

    expect(turnkey.subOrgs).toHaveLength(1);
    const { body, stamped } = turnkey.subOrgs[0];
    expect(stamped).toBe(true);
    expect(body).toMatchObject({
      type: 'ACTIVITY_TYPE_CREATE_SUB_ORGANIZATION_V8',
      organizationId: 'org-test',
      parameters: {
        rootQuorumThreshold: 1,
        disableEmailRecovery: true,
        disableEmailAuth: true,
      },
    });
    const [root] = body.parameters.rootUsers;
    expect(body.parameters.rootUsers).toHaveLength(1);
    // The passkey, and no API key: billing gets no standing in the wallet.
    expect(root.apiKeys).toEqual([]);
    expect(root.authenticators[0].attestation).toMatchObject({
      credentialId: passkey.credentialId,
      transports: ['AUTHENTICATOR_TRANSPORT_INTERNAL', 'AUTHENTICATOR_TRANSPORT_HYBRID'],
    });
    // Turnkey is not told who the person is.
    expect(JSON.stringify(body)).not.toContain(MockJwtAuthGuard.testUserId);

    // One wallet per person.
    await http().post('/v1/wallet').send({ passkey }).expect(201);
    expect(turnkey.subOrgs).toHaveLength(1);
  });

  it('tops up by PIX: Hodle delivers USDC on Base to the wallet’s own address', async () => {
    asUser();
    await http().post('/v1/wallet/topups/pix').send({ amount: '50' }).expect(503);
    await prisma.paymentProvider.create({
      data: {
        code: 'HODLE',
        name: 'Hodle',
        isActive: true,
        config: { apiKey: 'test', apiBaseUrl: 'https://api.hodle.com.br' },
      } as any,
    });
    await http().post('/v1/wallet/topups/pix').send({ amount: '1' }).expect(400);
    const res = await http().post('/v1/wallet/topups/pix').send({ amount: '50' }).expect(201);
    expect(res.body).toMatchObject({
      amount: '50.00',
      currency: 'BRL',
      status: 'pending',
      qrCode: '00020126pix',
    });
    expect(hodle.deposits[0]).toEqual({
      value: 5000,
      asset: 'USDC',
      network: 'base',
      address: owner.address,
      externalId: expect.stringMatching(/^wallet-/),
    });

    hodle.status = 'COMPLETED';
    const later = await http().get(`/v1/wallet/topups/${res.body.id}`).expect(200);
    expect(later.body).toMatchObject({ status: 'completed', qrCode: null });

    // Its webhook is not a sale: recorded, nothing to settle.
    const parsed = await app.get(HodleAdapter).handleWebhook({
      event: 'DEPOSIT_PIX_CONFIRMED',
      data: { externalId: hodle.deposits[0].externalId, eventId: 'e1' },
    });
    expect(parsed.eventType).toBe(HODLE_UNMATCHED_EVENT);
  });

  it('withdraws: the passkey signs the transfer, the relayer sends it', async () => {
    asUser();
    jest
      .spyOn((wallets as any).settlements, 'relayer')
      .mockImplementation(async () => new Relayer(signer, client));

    for (const [body, status] of [
      [{ to: usdcAddress(), amount: '1' }, 400],
      [{ to: owner.address, amount: '1' }, 400],
      [{ to: 'nope', amount: '1' }, 400],
      [{ to: FRIEND, amount: '11' }, 400],
      [{ to: FRIEND, amount: '0.001' }, 400],
    ] as const) {
      await http().post('/v1/wallet/withdrawals').send(body).expect(status);
    }

    const prepared = (
      await http().post('/v1/wallet/withdrawals').send({ to: FRIEND, amount: '1.5' }).expect(201)
    ).body;
    expect(prepared).toMatchObject({
      status: 'prepared',
      to: FRIEND,
      amount: '1.5',
      credentialId: passkey.credentialId,
    });
    const req = JSON.parse(prepared.request);
    expect(req).toMatchObject({
      type: 'ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2',
      organizationId: 'sub-1',
      parameters: { signWith: owner.address, encoding: 'PAYLOAD_ENCODING_EIP712' },
    });
    const typed = JSON.parse(req.parameters.payload);
    expect(typed.primaryType).toBe('TransferWithAuthorization');
    expect(getAddress(typed.message.from)).toBe(owner.address);
    expect(getAddress(typed.message.to)).toBe(FRIEND);
    expect(typed.message.value).toBe('1500000');

    // No stamp, no withdrawal; it still waits for one.
    await http()
      .post(`/v1/wallet/withdrawals/${prepared.id}/confirm`)
      .send({ stamp: '{}' })
      .expect(400);

    const done = (
      await http().post(`/v1/wallet/withdrawals/${prepared.id}/confirm`).send({ stamp }).expect(201)
    ).body;
    expect(done).toMatchObject({ status: 'mined', txHash: expect.stringMatching(/^0x/) });

    // Turnkey got exactly the prepared request, under the passkey's stamp.
    expect(turnkey.signed).toEqual([{ body: prepared.request, stamp }]);
    // On chain: USDC's transferWithAuthorization from the wallet to the friend.
    const tx = parseTransaction(chain.sent[0]);
    expect(tx.to?.toLowerCase()).toBe(usdcAddress().toLowerCase());
    const call = decodeFunctionData({ abi: USDC_ABI, data: tx.data! });
    expect(call.functionName).toBe('transferWithAuthorization');
    expect(call.args!.slice(0, 3)).toEqual([owner.address, FRIEND, 1_500_000n]);
    // One relay log and fee budget with x402.
    const row = await prisma.x402Payment.findFirstOrThrow({ where: { withdrawalId: prepared.id } });
    expect(row).toMatchObject({
      orderId: null,
      status: 'mined',
      payer: owner.address.toLowerCase(),
    });

    // Once only.
    await http().post(`/v1/wallet/withdrawals/${prepared.id}/confirm`).send({ stamp }).expect(409);
    const overview = (await http().get('/v1/wallet').expect(200)).body;
    expect(overview.history.map((h: any) => [h.kind, h.status])).toEqual([
      ['withdrawal', 'mined'],
      ['topup', 'completed'],
    ]);
  });

  it('lets a withdrawal lapse if the passkey does not approve it in time', async () => {
    asUser();
    const prepared = (
      await http().post('/v1/wallet/withdrawals').send({ to: FRIEND, amount: '1' }).expect(201)
    ).body;
    await prisma.walletWithdrawal.update({
      where: { id: prepared.id },
      data: { validBefore: new Date(Date.now() + 10_000) },
    });
    await http().post(`/v1/wallet/withdrawals/${prepared.id}/confirm`).send({ stamp }).expect(409);
    expect(
      (await prisma.walletWithdrawal.findUniqueOrThrow({ where: { id: prepared.id } })).status,
    ).toBe('expired');
  });

  it('joins Turnkey’s r, s and v into a signature viem accepts', () => {
    const r = '1'.repeat(64);
    const s = '2'.repeat(64);
    expect(joinSignature({ r, s, v: '00' })).toBe(`0x${r}${s}1b`);
    expect(joinSignature({ r, s, v: '01' })).toBe(`0x${r}${s}1c`);
    expect(() => joinSignature(undefined)).toThrow();
  });
});
