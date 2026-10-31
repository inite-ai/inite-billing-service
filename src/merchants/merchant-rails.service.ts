import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../common/services/prisma.service';
import { ConnectorRegistry } from '../common/connectors/connector-registry.service';
import { Connector } from '../common/connectors/connector.interface';
import { meetsRailMinimum } from '../checkout/rail-minimums';
import { isMerchantRail, openCredentials } from './merchant-credentials';

export interface MerchantConnectionRow {
  id: string;
  merchantId: string;
  rail: string;
  status: string;
  sealedCredentials: string | null;
}

/**
 * Which of a merchant's own accounts can take a payment, and the rail's
 * connector bound to that account. Only a verified connection is ever used,
 * and there is no path from here to INITE's own provider accounts: a merchant
 * with nothing that takes the payment is refused, never served by INITE.
 */
@Injectable()
export class MerchantRailsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ConnectorRegistry,
  ) {}

  /** The rail's connector acting on this connection's own account. */
  bind(connection: MerchantConnectionRow): Connector {
    if (connection.status !== 'verified' || !connection.sealedCredentials) {
      throw new UnprocessableEntityException(
        `The merchant's ${connection.rail} account is not verified`,
      );
    }
    const base = isMerchantRail(connection.rail) ? this.registry.get(connection.rail) : undefined;
    if (!base?.withCredentials) {
      throw new UnprocessableEntityException(
        `${connection.rail} cannot carry a merchant's own account`,
      );
    }
    return base.withCredentials(openCredentials(connection.id, connection.sealedCredentials), {
      merchantId: connection.merchantId,
      connectionId: connection.id,
    });
  }

  /** The bound connector for a merchant's rail, or 422 when it has no verified account there. */
  async connectorFor(
    merchantId: string,
    rail: string,
  ): Promise<{ connector: Connector; connection: MerchantConnectionRow }> {
    const connection = await this.prisma.merchantConnection.findUnique({
      where: { merchantId_rail: { merchantId, rail } },
    });
    if (!connection || connection.status !== 'verified') {
      throw new UnprocessableEntityException(`The merchant has no verified ${rail} account`);
    }
    return { connector: this.bind(connection), connection };
  }

  /**
   * The connector for an order's payment: the merchant's own account for a
   * merchant's order, `null` for INITE's own sale (the caller then uses the
   * rail's ordinary connector).
   */
  async connectorForOrder(
    order: { merchantId?: string | null },
    rail: string,
  ): Promise<Connector | null> {
    if (!order.merchantId) return null;
    return (await this.connectorFor(order.merchantId, rail)).connector;
  }

  /**
   * The merchant's verified rails that take `amount` in `currency`: the rail
   * declares the currency (no conversion on a merchant's account) and the
   * provider's documented minimum is met.
   */
  async eligibleRails(merchantId: string, currency: string, amount: Decimal): Promise<string[]> {
    const cur = currency.toUpperCase();
    const connections = await this.prisma.merchantConnection.findMany({
      where: { merchantId, status: 'verified' },
      select: { rail: true },
      orderBy: { createdAt: 'asc' },
    });
    const out: string[] = [];
    for (const { rail } of connections) {
      const capabilities = isMerchantRail(rail)
        ? this.registry.get(rail)?.capabilities?.()
        : undefined;
      if (!capabilities || !capabilities.supportedModes.includes('PAYMENT')) continue;
      if (capabilities.currencies?.length && !capabilities.currencies.includes(cur)) continue;
      if (!meetsRailMinimum(amount, capabilities, undefined, cur)) continue;
      out.push(rail);
    }
    return out;
  }
}
