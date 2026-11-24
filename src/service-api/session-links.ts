import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/services/prisma.service';
import { resolveFrontendUrl } from '../common/config/frontend-url';
import { newCheckoutLink } from '../checkout/checkout-link';
import { checkoutPageUrl } from '../checkout/checkout.service';
import { X402Service } from '../checkout/x402.service';

/** A renewal sends four letters; a few more are kept for a sweep that had to repeat one. */
const MAX_RENEWAL_LINKS = 6;

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
   * One more link to a renewal's page, for a letter: the page does not move,
   * and a letter sent on the last day must not kill the link in the first one.
   * The newest is also the one link older code knows, so a rollback keeps it.
   * (`reopen`, which replaced a session's link, had no caller left and went.)
   */
  async addRenewalLink(orderId: string, locale?: string): Promise<SessionLinks | null> {
    const link = newCheckoutLink();
    const added = await this.prisma.$executeRaw`
      UPDATE billing.orders
         SET metadata = COALESCE(metadata, '{}'::jsonb)
               || jsonb_build_object('linkTokenHash', ${link.hash}::text)
               || jsonb_build_object('linkTokenHashes', (
                    -- The newest kept, in the order they were made.
                    SELECT jsonb_agg(h ORDER BY n) FROM (
                      SELECT h, n FROM jsonb_array_elements(
                        COALESCE(metadata->'linkTokenHashes', '[]'::jsonb) || to_jsonb(${link.hash}::text)
                      ) WITH ORDINALITY AS t(h, n)
                      ORDER BY n DESC LIMIT ${MAX_RENEWAL_LINKS}
                    ) kept))
       WHERE id = ${orderId}::uuid AND status = 'created'
    `;
    if (added !== 1) return null;
    return this.withX402({
      sessionId: orderId,
      checkoutUrl: `${checkoutPageUrl(resolveFrontendUrl(this.config), orderId, locale)}#t=${link.token}`,
    });
  }

  /** Stop every link of a session. */
  async revoke(orderId: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE billing.orders
         SET metadata = COALESCE(metadata, '{}'::jsonb) - 'linkTokenHash' - 'linkTokenHashes'
       WHERE id = ${orderId}::uuid
    `;
  }
}
