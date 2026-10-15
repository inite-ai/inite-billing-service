import { createECDH } from 'node:crypto';
import { PrismaService } from '../../../common/services/prisma.service';

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
 * kept in billing's database, and used only to stamp requests to Turnkey. The
 * admin page shows the public half, which is registered in Turnkey for the
 * API user the relayer policy is written for — so even this key can sign
 * nothing but settlements of real payments into our wallet.
 */
export class RelayerKeys {
  constructor(private readonly prisma: PrismaService) {}

  /** The key in use, or null before one is made. */
  async current(): Promise<RelayerKey | null> {
    return this.prisma.x402RelayerKey.findFirst({
      where: { retiredAt: null },
      orderBy: { createdAt: 'desc' },
      select: { publicKey: true, privateKey: true },
    });
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
      this.prisma.x402RelayerKey.create({ data: { publicKey, privateKey } }),
    ]);
    return { publicKey };
  }
}
