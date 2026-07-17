import { BadRequestException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../common/services/prisma.service';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';
import { PromoCodesService } from '../../promo-codes/promo-codes.service';
import { CreditsService } from '../../credits/credits.service';
import { AdminOrdersService } from '../../admin/services/admin-orders.service';

export interface ActionContext {
  userId: string;
  /** userId of the confirming user, set at execute time */
  approverId?: string;
}

export interface ActionDefinition {
  name: string;
  scope: 'user' | 'admin';
  description: string;
  inputSchema: Anthropic.Tool['input_schema'];
  /** zod parse + precondition reads; returns the validated params snapshot */
  validate(params: any, ctx: ActionContext): Promise<Record<string, any>>;
  /** server-generated summary rendered on the confirmation card */
  summarize(params: Record<string, any>): string;
  /** delegates to the domain service; the LLM never touches writes directly */
  execute(params: Record<string, any>, ctx: ActionContext): Promise<any>;
}

const PROPOSAL_NOTE =
  'This PROPOSES an action that requires explicit user confirmation via a button in the UI. ' +
  'It does not execute anything. After calling it, tell the user to review and confirm the proposal card. ' +
  'Never state that the action was performed.';

const ADJUST_CREDITS_CAP = 100000;

const uuid = z.string().uuid();

@Injectable()
export class ActionRegistryService {
  private readonly definitions = new Map<string, ActionDefinition>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly promoCodesService: PromoCodesService,
    private readonly creditsService: CreditsService,
    private readonly adminOrdersService: AdminOrdersService,
  ) {
    this.register(this.cancelMySubscription());
    this.register(this.resumeMySubscription());
    this.register(this.adjustCredits());
    this.register(this.createPromoCode());
    this.register(this.proposeOrderRefund());
  }

  private register(def: ActionDefinition): void {
    this.definitions.set(def.name, def);
  }

  get(name: string): ActionDefinition | undefined {
    return this.definitions.get(name);
  }

  has(name: string): boolean {
    return this.definitions.has(name);
  }

  toolsForRoles(roles: string[]): Anthropic.Tool[] {
    const isAdmin = roles.includes('admin');
    return [...this.definitions.values()]
      .filter((def) => def.scope === 'user' || isAdmin)
      .map((def) => ({
        name: def.name,
        description: `${def.description} ${PROPOSAL_NOTE}`,
        input_schema: def.inputSchema,
      }));
  }

  private cancelMySubscription(): ActionDefinition {
    return {
      name: 'cancel_my_subscription',
      scope: 'user',
      description:
        'Cancel the current user subscription at the end of the paid period.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          subscriptionId: {
            type: 'string',
            description: 'ID of the subscription to cancel',
          },
        },
        required: ['subscriptionId'],
      },
      validate: async (params, ctx) => {
        const { subscriptionId } = z
          .object({ subscriptionId: uuid })
          .parse(params);
        // userId always comes from the JWT context, never from LLM params
        const subscription = await this.prisma.subscription.findFirst({
          where: { id: subscriptionId, userId: ctx.userId },
          include: { price: { include: { product: true } } },
        });
        if (!subscription) {
          throw new BadRequestException('Subscription not found');
        }
        if (!['active', 'trialing'].includes(subscription.status)) {
          throw new BadRequestException(
            `Subscription is ${subscription.status}, only active subscriptions can be cancelled`,
          );
        }
        if (subscription.cancelAtPeriodEnd) {
          throw new BadRequestException(
            'Subscription is already scheduled for cancellation',
          );
        }
        return {
          subscriptionId,
          productName: subscription.price?.product?.name ?? 'subscription',
          currentPeriodEnd: subscription.currentPeriodEnd,
        };
      },
      summarize: (p) =>
        `Cancel subscription "${p.productName}" at period end${
          p.currentPeriodEnd
            ? ` (${new Date(p.currentPeriodEnd).toISOString().slice(0, 10)})`
            : ''
        }`,
      execute: async (p, ctx) => {
        await this.subscriptionsService.cancelSubscription(
          ctx.userId,
          p.subscriptionId,
        );
        return { subscriptionId: p.subscriptionId, cancelAtPeriodEnd: true };
      },
    };
  }

  private resumeMySubscription(): ActionDefinition {
    return {
      name: 'resume_my_subscription',
      scope: 'user',
      description:
        'Resume a subscription that was scheduled for cancellation (undo cancel).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          subscriptionId: {
            type: 'string',
            description: 'ID of the subscription to resume',
          },
        },
        required: ['subscriptionId'],
      },
      validate: async (params, ctx) => {
        const { subscriptionId } = z
          .object({ subscriptionId: uuid })
          .parse(params);
        const subscription = await this.prisma.subscription.findFirst({
          where: { id: subscriptionId, userId: ctx.userId },
          include: { price: { include: { product: true } } },
        });
        if (!subscription) {
          throw new BadRequestException('Subscription not found');
        }
        if (!subscription.cancelAtPeriodEnd) {
          throw new BadRequestException(
            'Subscription is not scheduled for cancellation',
          );
        }
        return {
          subscriptionId,
          productName: subscription.price?.product?.name ?? 'subscription',
        };
      },
      summarize: (p) => `Resume subscription "${p.productName}"`,
      execute: async (p, ctx) => {
        await this.subscriptionsService.resumeSubscription(
          ctx.userId,
          p.subscriptionId,
        );
        return { subscriptionId: p.subscriptionId, cancelAtPeriodEnd: false };
      },
    };
  }

  private adjustCredits(): ActionDefinition {
    return {
      name: 'adjust_credits',
      scope: 'admin',
      description:
        "Adjust a user's credit balance by a positive or negative amount (admin).",
      inputSchema: {
        type: 'object' as const,
        properties: {
          userId: { type: 'string', description: 'Target user ID' },
          serviceId: {
            type: 'string',
            description: 'Optional service ID scoping the balance',
          },
          amount: {
            type: 'number',
            description: 'Credits to add (positive) or remove (negative)',
          },
          description: { type: 'string', description: 'Reason for adjustment' },
        },
        required: ['userId', 'amount', 'description'],
      },
      validate: async (params) => {
        const parsed = z
          .object({
            userId: z.string().min(1).max(255),
            serviceId: uuid.optional(),
            amount: z
              .number()
              .int()
              .refine((v) => v !== 0, 'amount must not be zero')
              .refine(
                (v) => Math.abs(v) <= ADJUST_CREDITS_CAP,
                `|amount| must not exceed ${ADJUST_CREDITS_CAP}`,
              ),
            description: z.string().min(1).max(255),
          })
          .parse(params);
        return parsed;
      },
      summarize: (p) =>
        `${p.amount > 0 ? 'Grant' : 'Remove'} ${Math.abs(p.amount)} credits ${
          p.amount > 0 ? 'to' : 'from'
        } user ${p.userId}: ${p.description}`,
      execute: async (p, ctx) => {
        const balance = await this.creditsService.adminAdjust({
          userId: p.userId,
          serviceId: p.serviceId,
          amount: p.amount,
          description: `${p.description} (via assistant, approved by ${ctx.approverId ?? ctx.userId})`,
        });
        return { balance: balance.balance };
      },
    };
  }

  private createPromoCode(): ActionDefinition {
    return {
      name: 'create_promo_code',
      scope: 'admin',
      description: 'Create a new promo code (admin).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          code: { type: 'string', description: 'Promo code string' },
          name: { type: 'string', description: 'Display name' },
          discountType: {
            type: 'string',
            enum: ['percentage', 'fixed_amount'],
          },
          discountValue: {
            type: 'number',
            description: 'Percent (1-100) or fixed amount',
          },
          validFrom: {
            type: 'string',
            description: 'ISO date the code becomes valid',
          },
          validUntil: {
            type: 'string',
            description: 'Optional ISO expiry date',
          },
          maxUsageCount: { type: 'number' },
          maxUsagePerUser: { type: 'number' },
          serviceId: { type: 'string' },
        },
        required: ['code', 'name', 'discountType', 'discountValue', 'validFrom'],
      },
      validate: async (params) => {
        const parsed = z
          .object({
            code: z.string().min(2).max(64),
            name: z.string().min(1).max(255),
            discountType: z.enum(['percentage', 'fixed_amount']),
            discountValue: z.number().positive(),
            validFrom: z.string().refine((v) => !isNaN(Date.parse(v)), {
              message: 'validFrom must be a valid date',
            }),
            validUntil: z
              .string()
              .refine((v) => !isNaN(Date.parse(v)), {
                message: 'validUntil must be a valid date',
              })
              .optional(),
            maxUsageCount: z.number().int().positive().optional(),
            maxUsagePerUser: z.number().int().positive().optional(),
            serviceId: uuid.optional(),
          })
          .parse(params);
        if (
          parsed.discountType === 'percentage' &&
          parsed.discountValue > 100
        ) {
          throw new BadRequestException(
            'Percentage discount must be between 0 and 100',
          );
        }
        return parsed;
      },
      summarize: (p) =>
        `Create promo code "${p.code}" — ${
          p.discountType === 'percentage'
            ? `${p.discountValue}% off`
            : `${p.discountValue} off`
        }${p.validUntil ? `, valid until ${p.validUntil.slice(0, 10)}` : ''}`,
      execute: async (p) => {
        return this.promoCodesService.create(p as any);
      },
    };
  }

  private proposeOrderRefund(): ActionDefinition {
    return {
      name: 'propose_order_refund',
      scope: 'admin',
      description: 'Refund a paid order (admin).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          orderId: { type: 'string', description: 'ID of the order to refund' },
        },
        required: ['orderId'],
      },
      validate: async (params) => {
        const { orderId } = z.object({ orderId: uuid }).parse(params);
        const order = await this.prisma.order.findUnique({
          where: { id: orderId },
          include: { price: { include: { product: true } } },
        });
        if (!order) {
          throw new BadRequestException('Order not found');
        }
        if (order.status !== 'paid') {
          throw new BadRequestException(
            `Order is ${order.status}, only paid orders can be refunded`,
          );
        }
        return {
          orderId,
          amount: order.amount?.toString?.() ?? String(order.amount),
          currency: order.currency,
          productName: order.price?.product?.name ?? 'order',
          orderUserId: order.userId,
        };
      },
      summarize: (p) =>
        `Refund order for "${p.productName}" — ${p.amount} ${p.currency} (user ${p.orderUserId})`,
      execute: async (p) => {
        return this.adminOrdersService.refundOrder(p.orderId);
      },
    };
  }
}
