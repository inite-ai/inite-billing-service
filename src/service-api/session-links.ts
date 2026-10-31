import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/services/prisma.service';
import { resolveFrontendUrl } from '../common/config/frontend-url';
import { newCheckoutLink } from '../checkout/checkout-link';
import { checkoutPageUrl } from '../checkout/checkout.service';
import { X402Service } from '../checkout/x402.service';

export interface SessionLinks {
  sessionId: string;
  checkoutUrl: string;
  x402Url?: string;
}

/**
 * The ways to pay one checkout session, for a service that opened it: the
 * hosted page (cards, PIX, the wallet's passkey) and, when x402 is live, the
 * address an agent or a wallet pays in USDC on Base.
 */
@Injectable()
export class SessionLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly x402: X402Service,
  ) {}

  /** Add the x402 address to a fresh session, the way POST /v1/checkout/sessions does. */
  async withX402(session: { sessionId: string; checkoutUrl: string }): Promise<SessionLinks> {
    const token = /#t=([^&]+)/.exec(session.checkoutUrl)?.[1];
    if (token && (await this.x402.available().catch(() => false))) {
      return {
        ...session,
        x402Url: this.x402.urlFor(session.sessionId, decodeURIComponent(token)),
      };
    }
    return session;
  }

  /**
   * A new link for an unpaid session whose first link the product no longer
   * has (the person closed the page). Only the hash is stored, so the old
   * token cannot be shown again: the link rotates and the old one stops
   * working.
   */
  async reopen(orderId: string, locale?: string): Promise<SessionLinks | null> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.status !== 'created') return null;
    const link = newCheckoutLink();
    await this.prisma.order.update({
      where: { id: orderId },
      data: { metadata: { ...((order.metadata as object) ?? {}), linkTokenHash: link.hash } },
    });
    const session = {
      sessionId: order.id,
      checkoutUrl: `${checkoutPageUrl(resolveFrontendUrl(this.config), order.id, locale)}#t=${link.token}`,
    };
    // x402 pays INITE's wallet rail; a merchant is paid on its own accounts only.
    return order.merchantId ? session : this.withX402(session);
  }
}
