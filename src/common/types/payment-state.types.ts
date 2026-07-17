/**
 * Unified payment intent status state machine
 * All payment rails map to these statuses
 */
export type IntentStatus = 'created' | 'opened' | 'paid' | 'failed' | 'expired' | 'refunded';

export type OrderStatus = 'created' | 'open' | 'paid' | 'failed' | 'refunded' | 'expired';

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'ended';

export type EntitlementStatus = 'active' | 'revoked' | 'expired';

export type InvoiceStatus = 'open' | 'paid' | 'void' | 'failed' | 'refunded';

/**
 * Valid state transitions for payment intents
 */
export const VALID_INTENT_TRANSITIONS: Record<IntentStatus, IntentStatus[]> = {
  created: ['opened', 'paid', 'failed', 'expired'],
  opened: ['paid', 'failed', 'expired', 'refunded'],
  paid: ['refunded'],
  failed: [],
  expired: [],
  refunded: [],
};

/**
 * Check if a state transition is valid
 */
export function isValidTransition(from: IntentStatus, to: IntentStatus): boolean {
  return VALID_INTENT_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Maps intent status to order status
 */
export function mapIntentToOrderStatus(intentStatus: IntentStatus): OrderStatus {
  const mapping: Record<IntentStatus, OrderStatus> = {
    created: 'created',
    opened: 'open',
    paid: 'paid',
    failed: 'failed',
    expired: 'expired',
    refunded: 'refunded',
  };
  return mapping[intentStatus];
}
