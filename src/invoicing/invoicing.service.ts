import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { withoutLinkHashes } from '../checkout/checkout-link';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/services/prisma.service';
import { CheckoutService, OpenSessionResponse } from '../checkout/checkout.service';
import { PaymentOrchestratorService } from '../payment-orchestrator/payment-orchestrator.service';
import { CreateInvoiceDto, MarkInvoicePaidDto } from './invoicing.dto';

/**
 * Invoices (19.11.2026): money owed for agreed work, paid by the link through
 * the usual rails, or marked paid by a person when it came another way (a PIX
 * straight to the account, a bank transfer).
 *
 * An invoice is an open sale (docs/open-product.md): one line on one of the
 * service's open products, with the amount and title the service names, the
 * same bounds, daily cap and audit as any open sale, and `metadata.invoice`
 * saying it is one. Nothing new decides what may be charged. Paying it by hand is a payment
 * intent on the rail `manual`, moved to `paid` by the orchestrator like any
 * other: the invoice row, the affiliate commission and the
 * `billing.payment.succeeded` event all come from the one place they come
 * from for a card. A refund later is the admin's ordinary refund, which knows
 * a rail without a connector is refunded in the database only.
 *
 * One manual intent per order (`providerIntentId = manual:<order>`, unique per
 * rail), so marking it paid twice finds the first and does nothing.
 */

export const MANUAL_RAIL = 'manual';

/** The order is an invoice: an open sale that says it is one. */
export function isInvoiceOrder(metadata: unknown): boolean {
  const meta = (metadata ?? {}) as Record<string, unknown>;
  return !!meta.open && !!meta.invoice && typeof meta.invoice === 'object';
}

/** Who is looking: a service sees its own invoices, an admin all. */
export type InvoiceScope = { serviceId: string } | { admin: true };

const ORDER_WITH = {
  paymentIntents: true,
  price: { include: { product: true } },
} satisfies Prisma.OrderInclude;

type OrderRow = Prisma.OrderGetPayload<{ include: typeof ORDER_WITH }>;

export interface InvoiceView {
  id: string;
  status: string;
  amount: string;
  currency: string;
  description: string | null;
  dueAt: string | null;
  userId: string;
  priceCode: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  paidAt: string | null;
  paidBy: { rail: string; method: string | null; reference: string | null } | null;
  cancelledAt: string | null;
}

/** The order's metadata without what only billing should hold. */
function publicMeta(metadata: unknown): Record<string, unknown> {
  return withoutLinkHashes(metadata);
}

export function invoiceView(order: OrderRow): InvoiceView {
  const meta = publicMeta(order.metadata);
  const terms = (meta.invoice ?? {}) as Record<string, unknown>;
  const paid = order.paymentIntents.find((i) => i.status === 'paid' || i.status === 'refunded');
  const snap = (paid?.snapshot ?? {}) as Record<string, unknown>;
  return {
    id: order.id,
    status: order.status,
    amount: order.amount.toString(),
    currency: order.currency,
    description: typeof terms.description === 'string' ? terms.description : null,
    dueAt: typeof terms.dueAt === 'string' ? terms.dueAt : null,
    userId: order.userId,
    priceCode: order.price.code,
    metadata: meta,
    createdAt: order.createdAt.toISOString(),
    paidAt: paid
      ? typeof snap.paidAt === 'string'
        ? snap.paidAt
        : paid.updatedAt.toISOString()
      : null,
    paidBy: paid
      ? {
          rail: paid.rail,
          method: typeof snap.method === 'string' ? snap.method : paid.method,
          reference: typeof snap.reference === 'string' ? snap.reference : null,
        }
      : null,
    cancelledAt: typeof terms.cancelledAt === 'string' ? terms.cancelledAt : null,
  };
}

@Injectable()
export class InvoicingService {
  private readonly logger = new Logger(InvoicingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly checkout: CheckoutService,
    private readonly orchestrator: PaymentOrchestratorService,
  ) {}

  /** Open an invoice: an open sale of one line, marked as an invoice. */
  async create(
    caller: { serviceId: string; serviceCode: string },
    dto: CreateInvoiceDto,
    idempotencyKey: string,
  ): Promise<OpenSessionResponse & { invoice: InvoiceView }> {
    const description = dto.description.trim();
    const session = await this.checkout.createOpenSession(
      dto.userId,
      {
        line: {
          productCode: dto.productCode,
          amount: dto.amount,
          currency: dto.currency,
          title: description,
          ref: dto.ref,
          quantity: 1,
        },
        successUrl: dto.successUrl,
        errorUrl: dto.errorUrl ?? dto.successUrl,
        metadata: {
          ...(dto.metadata ?? {}),
          invoice: { description, dueAt: dto.dueAt ?? null },
        },
        ...(dto.locale ? { locale: dto.locale } : {}),
      },
      `invoice:${idempotencyKey}`,
      caller,
    );
    const invoice = await this.get({ serviceId: caller.serviceId }, session.sessionId);
    return { ...session, invoice };
  }

  async get(scope: InvoiceScope, id: string): Promise<InvoiceView> {
    return invoiceView(await this.load(scope, id));
  }

  /** The newest invoices, for the admin. */
  async list(limit = 100): Promise<InvoiceView[]> {
    const take = Math.min(Math.max(1, limit), 500);
    const ids = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM billing.orders
       WHERE metadata ? 'invoice'
       ORDER BY created_at DESC
       LIMIT ${take}
    `);
    if (ids.length === 0) return [];
    const rows = await this.prisma.order.findMany({
      where: { id: { in: ids.map((r) => r.id) } },
      include: ORDER_WITH,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(invoiceView);
  }

  /**
   * Money that came another way: a manual intent, paid by the orchestrator.
   * Paid already (by hand or by the link) → the invoice as it is.
   */
  async markPaid(
    scope: InvoiceScope,
    id: string,
    dto: MarkInvoicePaidDto,
    by: string,
  ): Promise<InvoiceView> {
    const order = await this.load(scope, id);
    if (order.status === 'paid') return invoiceView(order);
    if (order.status === 'refunded') {
      throw new BadRequestException('This invoice was refunded');
    }
    const terms = (publicMeta(order.metadata).invoice ?? {}) as Record<string, unknown>;
    if (typeof terms.cancelledAt === 'string') {
      throw new BadRequestException('This invoice was cancelled');
    }
    const paidAt = dto.paidAt ?? new Date().toISOString();
    // A payment the payer started by the link and never finished would, left
    // open, be given up by the provider poll in three days, and giving it up
    // expires the order, a paid one included. It is closed here, the intent
    // only: the order is about to be paid by the manual intent below. Should
    // that provider still report it paid, the transition is refused and the
    // webhook fails loudly, which is what money arriving twice should do.
    const stale = order.paymentIntents.filter(
      (i) => i.rail !== MANUAL_RAIL && (i.status === 'created' || i.status === 'opened'),
    );
    if (stale.length > 0) {
      await this.prisma.paymentIntent.updateMany({
        where: { id: { in: stale.map((i) => i.id) }, status: { in: ['created', 'opened'] } },
        data: { status: 'failed' },
      });
    }
    const intent = await this.manualIntent(order);
    if (intent.status !== 'paid') {
      await this.orchestrator.applyStateTransition(intent.id, 'paid', {
        method: dto.method,
        reference: dto.reference ?? null,
        paidAt,
        markedBy: by,
      });
    }
    this.logger.log(`Invoice ${order.id} marked paid by hand (${dto.method})`);
    return this.get(scope, id);
  }

  /**
   * Cancel an unpaid invoice: every open intent expires, which ends the order
   * and tells the subscriber `billing.payment.failed`. A paid one is refunded,
   * not cancelled.
   */
  async cancel(scope: InvoiceScope, id: string, by: string): Promise<InvoiceView> {
    const order = await this.load(scope, id);
    if (order.status === 'paid' || order.status === 'refunded') {
      throw new BadRequestException('A paid invoice is refunded, not cancelled');
    }
    const meta = publicMeta(order.metadata);
    const terms = (meta.invoice ?? {}) as Record<string, unknown>;
    if (typeof terms.cancelledAt === 'string') return invoiceView(order);

    const live = order.paymentIntents.filter(
      (i) => i.status === 'created' || i.status === 'opened',
    );
    const intents =
      live.length > 0 ? live : order.status === 'created' ? [await this.manualIntent(order)] : [];
    for (const intent of intents) {
      await this.orchestrator.applyStateTransition(intent.id, 'expired');
    }
    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        metadata: {
          ...(order.metadata as Record<string, unknown>),
          invoice: { ...terms, cancelledAt: new Date().toISOString(), cancelledBy: by },
        } as Prisma.InputJsonValue,
      },
    });
    return this.get(scope, id);
  }

  private async load(scope: InvoiceScope, id: string): Promise<OrderRow> {
    const order = await this.prisma.order.findUnique({ where: { id }, include: ORDER_WITH });
    // The same answer for "not yours" and "not there": a key must not be
    // able to tell another service's invoices exist.
    const visible =
      !!order &&
      isInvoiceOrder(order.metadata) &&
      ('admin' in scope || order.price.product?.serviceId === scope.serviceId);
    if (!visible) throw new NotFoundException(`Invoice not found: ${id}`);
    return order;
  }

  /** The order's one manual intent, made on first use. */
  private async manualIntent(order: OrderRow) {
    const providerIntentId = `manual:${order.id}`;
    const existing = order.paymentIntents.find(
      (i) => i.rail === MANUAL_RAIL && i.providerIntentId === providerIntentId,
    );
    if (existing) return existing;
    try {
      return await this.prisma.paymentIntent.create({
        data: {
          orderId: order.id,
          rail: MANUAL_RAIL,
          status: 'created',
          providerIntentId,
          method: 'manual',
          amount: order.amount,
          currency: order.currency,
        },
      });
    } catch (error) {
      // Two people marking it at once: the other one made it.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const found = await this.prisma.paymentIntent.findFirst({
          where: { orderId: order.id, rail: MANUAL_RAIL, providerIntentId },
        });
        if (found) return found;
      }
      throw error;
    }
  }
}
