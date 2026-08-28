export interface CreateIntentInput {
  orderId: string;
  amount: number;
  currency: string;
  mode: 'PAYMENT' | 'SUBSCRIPTION';
  successUrl?: string;
  errorUrl?: string;
  metadata?: Record<string, any>;
  method?: string; // pix, card, crypto, etc
  cryptoChainId?: string;
  cryptoToken?: string;
  receiverAddress?: string; // For crypto
}

export interface CreateIntentResult {
  providerIntentId: string;
  providerCheckoutId?: string;
  checkoutUrl?: string;
  expiresAt?: Date;
  metadata?: Record<string, any>;
}

export interface IntentStatusResult {
  status: 'created' | 'opened' | 'paid' | 'failed' | 'expired' | 'refunded';
  metadata?: Record<string, any>;
  providerData?: Record<string, any>;
  /**
   * The amount the provider actually settled, NORMALIZED to major currency units
   * (the same scale as Order.amount — e.g. dollars, not cents). Adapters populate
   * this when the settled amount is known so the webhook processor can reconcile
   * it against the order. Leave undefined when the rail does not expose a
   * reliable amount (the processor then skips the amount check rather than
   * comparing mismatched units).
   */
  amount?: number;
  /** ISO currency of {@link amount} (case-insensitive), for reconciliation. */
  currency?: string;
  /**
   * Set when the adapter has itself established that the settled amount is the
   * one that was owed — an app store that only ever charges its own configured
   * price, or a rail whose adapter checks the on-chain transfer against the
   * intent before reporting `paid`.
   *
   * It exists so that "no amount" stops meaning "amount is fine". Without a
   * normalized {@link amount} and without this flag, the processor has no
   * evidence the customer paid what the order says, and marking it paid on that
   * basis is how an underpayment settles in full.
   */
  amountVerifiedByAdapter?: boolean;
}

export interface PaymentMethod {
  id: string;
  type: string; // pix, card, crypto, bank_transfer
  name: string;
  metadata?: Record<string, any>;
}

export interface WebhookParseResult {
  webhookId?: string;
  eventType: string;
  entityId: string;
  rail?: string;
  payload: Record<string, any>;
}

/**
 * Payment Rail Adapter interface - allows easy extension to new payment providers
 */
export interface PaymentRailAdapter {
  /**
   * Returns the rail identifier (e.g., "ONE", "CRYPTO", "X402")
   */
  rail(): string;

  /**
   * Creates a payment intent with the provider
   */
  createPaymentIntent(input: CreateIntentInput): Promise<CreateIntentResult>;

  /**
   * Fetches the current status of a payment intent from the provider
   */
  getIntentStatus(providerIntentId: string): Promise<IntentStatusResult>;

  /**
   * Optional: List available payment methods
   */
  listMethods?(): Promise<PaymentMethod[]>;

  /**
   * Optional: Parse webhook payload from provider
   * Used when provider pushes webhooks (e.g., ONE)
   */
  handleWebhook?(rawPayload: any): Promise<WebhookParseResult>;
}
