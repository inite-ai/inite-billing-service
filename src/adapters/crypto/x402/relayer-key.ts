import { createECDH } from 'node:crypto';
import { PrismaService } from '../../../common/services/prisma.service';
import { openKey, sealKey } from '../../../common/key-seal';

export interface RelayerKey {
  publicKey: string;
  privateKey: string;
}

/** A fresh P-256 key pair in the form Turnkey's API key stamper takes (hex, compressed public). */
export function newTurnkeyApiKey(): RelayerKey {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey('hex', 'compressed'),
    privateKey: ecdh.getPrivateKey('hex').padStart(64, '0'),
  };
}

/**
 * The key billing signs its Turnkey requests with, made by billing itself.
 *
 * Nobody types, copies or receives the private half: it is generated here,
 * kept in billing's database sealed (key-seal.ts), and used only to stamp
 * requests to Turnkey. The
 * admin page shows the public half, which is registered in Turnkey for the
 * API user the relayer policy is written for — so even this key can sign
 * nothing but settlements of real payments into our wallet.
 */
export class RelayerKeys {
  constructor(private readonly prisma: PrismaService) {}

  /** The key in use, or null before one is made. */
  async current(): Promise<RelayerKey | null> {
    const row = await this.prisma.x402RelayerKey.findFirst({
      where: { retiredAt: null },
      orderBy: { createdAt: 'desc' },
      select: { publicKey: true, privateKey: true },
    });
    if (!row) return null;
    return { publicKey: row.publicKey, privateKey: openKey(row.privateKey, row.publicKey) };
  }

  /**
   * Make a new key and retire the old one. Turnkey keeps accepting the old
   * public key until it is removed there; billing stops using it at once.
   * Returns only the public half.
   */
  async rotate(): Promise<{ publicKey: string }> {
    const { publicKey, privateKey } = newTurnkeyApiKey();
    await this.prisma.$transaction([
      this.prisma.x402RelayerKey.updateMany({
        where: { retiredAt: null },
        data: { retiredAt: new Date() },
      }),
      this.prisma.x402RelayerKey.create({
        data: { publicKey, privateKey: sealKey(privateKey, publicKey) },
      }),
    ]);
    return { publicKey };
  }
}
