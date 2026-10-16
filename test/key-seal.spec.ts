import { Test } from '@nestjs/testing';
import { TestAppModule } from './test-app.module';
import { PrismaService } from '../src/common/services/prisma.service';
import { newTurnkeyApiKey, RelayerKeys } from '../src/adapters/crypto/x402/relayer-key';
import { isSealed, openKey, sealKey, sealLegacyKeys } from '../src/common/key-seal';

/**
 * Private keys at rest: sealed, bound to their public half, and the rows
 * written before sealing are sealed once and still read the same.
 */
describe('Private keys at rest', () => {
  it('seals a key so only its own row opens it', () => {
    const a = newTurnkeyApiKey();
    const b = newTurnkeyApiKey();
    const sealed = sealKey(a.privateKey, a.publicKey);
    expect(isSealed(sealed)).toBe(true);
    expect(sealed).not.toContain(a.privateKey);
    expect(sealKey(a.privateKey, a.publicKey)).not.toBe(sealed);
    expect(openKey(sealed, a.publicKey)).toBe(a.privateKey);
    // Copied onto another key's row, it does not open.
    expect(() => openKey(sealed, b.publicKey)).toThrow();
    // Nor does a tampered one.
    const tampered = sealed.slice(0, -2) + (sealed.endsWith('A') ? 'BB' : 'AA');
    expect(() => openKey(tampered, a.publicKey)).toThrow();
    // A row written before sealing reads as it was.
    expect(openKey(a.privateKey, a.publicKey)).toBe(a.privateKey);
  });

  it('refuses a seal secret of the wrong size', () => {
    const before = process.env.KEY_SEAL_SECRET;
    process.env.KEY_SEAL_SECRET = Buffer.alloc(16).toString('base64');
    try {
      expect(() => sealKey('00', '01')).toThrow(/32 bytes/);
    } finally {
      if (before === undefined) delete process.env.KEY_SEAL_SECRET;
      else process.env.KEY_SEAL_SECRET = before;
    }
  });

  describe('keys stored bare before sealing', () => {
    let prisma: PrismaService;
    let close: () => Promise<void>;

    beforeAll(async () => {
      const module = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
      const app = module.createNestApplication();
      await app.init();
      prisma = app.get(PrismaService);
      close = () => app.close();
    });

    afterAll(async () => {
      await prisma.wallet.deleteMany({ where: { ownerDid: { startsWith: 'did:test:seal' } } });
      await prisma.x402RelayerKey.deleteMany({});
      await close();
    });

    it('are sealed once, and still sign the same', async () => {
      await prisma.x402RelayerKey.deleteMany({});
      const relayer = newTurnkeyApiKey();
      await prisma.x402RelayerKey.create({ data: relayer });
      const agent = newTurnkeyApiKey();
      await prisma.wallet.create({
        data: {
          ownerDid: 'did:test:seal-agent',
          ownerKey: agent.publicKey,
          ownerPrivateKey: agent.privateKey,
          subOrganizationId: 'sub-seal',
          turnkeyWalletId: 'wallet-seal',
          address: '0x000000000000000000000000000000000000beef',
        },
      });

      expect(await sealLegacyKeys(prisma)).toBe(2);
      expect(await sealLegacyKeys(prisma)).toBe(0);

      const row = await prisma.x402RelayerKey.findFirstOrThrow({ where: { retiredAt: null } });
      expect(isSealed(row.privateKey)).toBe(true);
      expect(await new RelayerKeys(prisma).current()).toEqual(relayer);
      const wallet = await prisma.wallet.findFirstOrThrow({
        where: { ownerDid: 'did:test:seal-agent' },
      });
      expect(isSealed(wallet.ownerPrivateKey!)).toBe(true);
      expect(openKey(wallet.ownerPrivateKey!, wallet.ownerKey!)).toBe(agent.privateKey);
    });
  });
});
