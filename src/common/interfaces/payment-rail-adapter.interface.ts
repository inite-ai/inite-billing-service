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

