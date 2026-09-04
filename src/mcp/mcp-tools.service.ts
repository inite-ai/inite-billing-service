import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { CreditsService } from '../credits/credits.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { CatalogService } from '../catalog/catalog.service';
import { CheckoutService } from '../checkout/checkout.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

/**
 * Who is calling a tool.
 *
 * The same two identities the REST API already knows: a person holding a JWT,
 * or a product module holding its service key.
 */
export interface McpCaller {
  userId: string;
  isService: boolean;
  serviceId?: string;
  roles: string[];
}

export interface McpToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  /** Read-only tools are safe to retry and safe to call speculatively. */
  readOnly: boolean;
  handler: (args: Record<string, any>, caller: McpCaller) => Promise<unknown>;
}

/**
 * A user id is the caller's own unless the caller is a service.
 *
 * The same rule the REST controllers follow: a person acts for themselves
 * whatever the arguments say, and a module has to name the customer it is
 * acting for. An agent is very willing to pass a `user_id` it read somewhere,
 * so this is the boundary that matters most here.
 */
function resolveUserId(caller: McpCaller, requested?: string): string {
  if (!caller.isService) return caller.userId;
  if (!requested) {
    throw new Error('user_id is required when calling with a service key');
  }
  return requested;
}

/**
 * The tools this billing service offers an agent.
 *
 * Defined once, here. Both transports — the HTTP endpoint this service serves
 * and the stdio bridge that ships as a package — read this list, so there is no
 * second copy to drift.
 *
 * The set is chosen around one loop an agent actually runs: *may I do this
 * work* → do it → *charge for it*; and when the answer is no, *where does the
 * customer pay*. Everything else is catalogue and reporting around that.
 */
@Injectable()
export class McpToolsService {
  private readonly logger = new Logger(McpToolsService.name);

  constructor(
    private readonly credits: CreditsService,
    private readonly entitlements: EntitlementsService,
    private readonly catalog: CatalogService,
    private readonly checkout: CheckoutService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  list(): McpToolDefinition[] {
    return [
      {
        name: 'check_entitlement',
        title: 'Check an entitlement',
        description:
          'Answer whether a customer currently holds a named entitlement — the check to run before doing paid work. Returns granted=false rather than an error when they do not.',
        readOnly: true,
        inputSchema: {
          key: z.string().describe('Entitlement key, e.g. "access.pro"'),
          user_id: z
            .string()
            .optional()
            .describe('Customer id. Required with a service key; ignored for a user token.'),
        },
        handler: async (args, caller) => {
          const userId = resolveUserId(caller, args.user_id);
          const held = await this.entitlements.getUserEntitlementsByUserId(
            userId,
            caller.isService ? caller.serviceId : undefined,
          );
          const match = held.find((e) => e.key === args.key && e.status === 'active');
          return {
            granted: Boolean(match),
            key: args.key,
            user_id: userId,
            expires_at: match?.expiresAt ?? null,
            source: match?.source ?? null,
          };
        },
      },
      {
        name: 'list_entitlements',
        title: 'List entitlements',
        description: 'Everything a customer is currently entitled to.',
        readOnly: true,
        inputSchema: {
          user_id: z.string().optional().describe('Customer id. Required with a service key.'),
        },
        handler: async (args, caller) => {
          const userId = resolveUserId(caller, args.user_id);
          const held = await this.entitlements.getUserEntitlementsByUserId(
            userId,
            caller.isService ? caller.serviceId : undefined,
          );
          return { user_id: userId, entitlements: held };
        },
      },
      {
        name: 'get_credit_balance',
        title: 'Get credit balance',
        description:
          'How many credits a customer has left. Balances are per currency of account — one per service, plus the platform-wide one.',
        readOnly: true,
        inputSchema: {
          user_id: z.string().optional().describe('Customer id. Required with a service key.'),
        },
        handler: async (args, caller) => {
          const userId = resolveUserId(caller, args.user_id);
          if (caller.isService && caller.serviceId) {
            const balance = await this.credits.getBalance(userId, caller.serviceId);
            return {
              user_id: userId,
              balance: balance.balance,
              total_granted: balance.totalGranted,
              total_used: balance.totalUsed,
            };
          }
          const balances = await this.credits.getUserBalances(userId);
          return {
            user_id: userId,
            balances: balances.map((b) => ({
              service_id: b.serviceId,
              balance: b.balance,
              total_granted: b.totalGranted,
              total_used: b.totalUsed,
            })),
          };
        },
      },
      {
        name: 'consume_credits',
        title: 'Charge credits',
        description:
          'Debit a customer for work done. Pass an idempotency_key: agents retry, and a retry must not charge twice. Returns success=false with the remaining balance when there are not enough credits, rather than failing the call.',
        readOnly: false,
        inputSchema: {
          user_id: z.string().optional().describe('Customer id. Required with a service key.'),
          amount: z.number().int().positive().optional().describe('Flat number of credits.'),
          feature_code: z
            .string()
            .optional()
            .describe('Metered feature to charge against, instead of a flat amount.'),
          units: z.number().positive().optional().describe('Units of the metered feature.'),
          description: z.string().optional().describe('What the customer is being charged for.'),
          idempotency_key: z
            .string()
            .optional()
            .describe('Repeat this on a retry and the charge happens once.'),
        },
        handler: async (args, caller) => {
          const userId = resolveUserId(caller, args.user_id);
          const result = await this.credits.consume({
            userId,
            serviceId: caller.isService ? caller.serviceId : undefined,
            amount: args.amount,
            featureCode: args.feature_code,
            units: args.units,
            description: args.description,
            idempotencyKey: args.idempotency_key,
            metadata: { via: 'mcp' },
          });
          return {
            user_id: userId,
            success: result.success,
            remaining_balance: result.remainingBalance,
            error: result.error ?? null,
          };
        },
      },
      {
        name: 'list_catalog',
        title: 'List what is for sale',
        description:
          'Products and their prices. A service key sees its own catalogue; a user token sees everything on offer.',
        readOnly: true,
        inputSchema: {
          product_code: z.string().optional().describe('Narrow to one product.'),
        },
        handler: async (args, caller) => {
          const serviceId = caller.isService ? caller.serviceId : undefined;
          const [products, prices] = await Promise.all([
            this.catalog.getProducts(serviceId),
            this.catalog.getPrices(args.product_code, serviceId),
          ]);
          return { products, prices };
        },
      },
      {
        name: 'create_checkout_session',
        title: 'Open a checkout',
        description:
          'Start a purchase and get back a URL to send the customer to. This is the answer when check_entitlement says no or consume_credits reports an empty balance.',
        readOnly: false,
        inputSchema: {
          price_code: z.string().describe('Which price to sell.'),
          mode: z.enum(['PAYMENT', 'SUBSCRIPTION']).describe('One-off or recurring.'),
          user_id: z.string().optional().describe('Customer id. Required with a service key.'),
          success_url: z.string().optional(),
          error_url: z.string().optional(),
          idempotency_key: z
            .string()
            .optional()
            .describe('Repeat this on a retry and one session is created, not two.'),
        },
        handler: async (args, caller) => {
          const userId = resolveUserId(caller, args.user_id);
          return this.checkout.createSession(
            userId,
            {
              priceCode: args.price_code,
              mode: args.mode,
              successUrl: args.success_url,
              errorUrl: args.error_url,
            } as any,
            args.idempotency_key,
            undefined,
            caller.isService ? caller.serviceId : undefined,
          );
        },
      },
      {
        name: 'list_subscriptions',
        title: 'List subscriptions',
        description: 'A customer’s subscriptions and where each one is in its lifecycle.',
        readOnly: true,
        inputSchema: {
          user_id: z.string().optional().describe('Customer id. Required with a service key.'),
        },
        handler: async (args, caller) => {
          const userId = resolveUserId(caller, args.user_id);
          const subs = await this.subscriptions.getUserSubscriptions(
            userId,
            caller.isService ? caller.serviceId : undefined,
          );
          return { user_id: userId, subscriptions: subs };
        },
      },
    ];
  }

  /**
   * Run a tool and shape the result the way MCP expects.
   *
   * A failure comes back as tool content with `isError`, not as a protocol
   * error: the model is supposed to read it and decide what to do — open a
   * checkout, ask the user, give up — and a JSON-RPC error would just abort the
   * turn. Unexpected failures are logged here and reported without their
   * internals.
   */
  async call(name: string, args: Record<string, any>, caller: McpCaller) {
    const tool = this.list().find((t) => t.name === name);
    if (!tool) {
      return this.errorResult(`No such tool: ${name}`);
    }

    try {
      const result = await tool.handler(args ?? {}, caller);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result as Record<string, unknown>,
      };
    } catch (error: any) {
      const message = error?.response?.message ?? error?.message ?? 'Tool failed';
      this.logger.warn(`MCP tool ${name} failed for ${caller.userId}: ${message}`);
      return this.errorResult(message);
    }
  }

  private errorResult(message: string) {
    return {
      content: [{ type: 'text' as const, text: message }],
      isError: true,
    };
  }
}
