import 'reflect-metadata';
import { PaymentRailAdapter } from '../interfaces/payment-rail-adapter.interface';
import { Rail } from './rail';

/**
 * What a connector can do, declared once on the connector itself instead of
 * living only as columns on `PaymentProvider`. The registry can filter by these
 * without a DB round-trip (e.g. "which rails support refunds?").
 */
export interface ConnectorCapabilities {
  /** Checkout modes the rail can fulfil. */
  supportedModes: Array<'PAYMENT' | 'SUBSCRIPTION'>;
  /** The purchase originates on the client (IAP) — no server-side intent creation. */
  isClientSide?: boolean;
  /** Checkout needs a provider-hosted redirect (vs. inline / client-driven). */
  requiresRedirect?: boolean;
  /** Provider refunds can be issued programmatically. */
  supportsRefund?: boolean;
  /** Provider subscriptions can be cancelled programmatically. */
  supportsCancel?: boolean;
  /** Optional allow-lists; empty/undefined means "no restriction declared". */
  currencies?: string[];
  countries?: string[];
}

/**
 * A payment connector: the existing {@link PaymentRailAdapter} plus a capability
 * declaration and (optionally) the provider-side refund / cancel / subscription
 * anchoring the DB-only flows are still missing. New methods are optional so the
 * six existing adapters satisfy the type as-is; they are filled in per rail.
 */
export interface Connector extends PaymentRailAdapter {
  /** Static capability declaration for this rail. */
  capabilities?(): ConnectorCapabilities;

  /** Issue a provider-side refund for a paid intent. Only when `supportsRefund`. */
  refund?(input: { providerIntentId: string; amount?: number; currency?: string }): Promise<{
    refunded: boolean;
    providerRefundId?: string;
  }>;

  /** Cancel a provider-side subscription. Only when `supportsCancel`. */
  cancelSubscription?(input: {
    providerSubscriptionId: string;
    atPeriodEnd?: boolean;
  }): Promise<{ cancelled: boolean }>;

  /**
   * Resolve the stable subscription anchor id from a paid intent's snapshot —
   * the structural version of the per-rail logic in the orchestrator switch.
   */
  subscriptionAnchorId?(snapshot: Record<string, any>, intent?: any): string | null;

  /**
   * Verify an inbound webhook. MUST fail closed (return false) when the required
   * secret/token is missing or empty — an absent secret is attacker-forgeable.
   * Return a boolean; do not throw for an ordinary bad signature.
   */
  verifyWebhook?(input: WebhookVerifyInput): Promise<boolean> | boolean;

  /**
   * Transform the raw request body into the representation to persist on the
   * WebhookEvent (e.g. Google decodes its base64 Pub/Sub envelope). Defaults to
   * the raw body when a connector doesn't override it.
   */
  webhookStoragePayload?(rawPayload: any): any;
}

/** Everything a connector needs to authenticate an inbound webhook. */
export interface WebhookVerifyInput {
  /** Exact request bytes (req.rawBody) — signatures are computed over these. */
  rawBody: Buffer;
  /** Lower-cased request headers. */
  headers: Record<string, string | undefined>;
  /** The provider's stored config (PaymentProvider.config), or {} if absent. */
  config: Record<string, any>;
  /** The parsed request body. */
  payload: any;
}

/** Reflect-metadata key marking a provider class as a payment connector. */
export const CONNECTOR_METADATA = 'billing:connector';

/**
 * Marks an adapter class for auto-discovery by the {@link ConnectorRegistry}.
 * Apply alongside `@Injectable()`. Adding a rail then means writing one
 * self-registering class — no edits to main.ts / adapters.module / webhooks.
 */
export function RegisterConnector(rail: Rail): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(CONNECTOR_METADATA, rail, target);
  };
}

/** Reads the rail a class was registered for, or undefined if not a connector. */
export function connectorRailOf(target: any): Rail | undefined {
  if (!target) return undefined;
  return Reflect.getMetadata(CONNECTOR_METADATA, target) as Rail | undefined;
}
