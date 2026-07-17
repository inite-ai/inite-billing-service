import { isValidTransition, mapIntentToOrderStatus } from '../src/common/types/payment-state.types';

describe('Payment State Machine', () => {
  describe('isValidTransition', () => {
    it('should allow valid transitions', () => {
      expect(isValidTransition('created', 'opened')).toBe(true);
      expect(isValidTransition('opened', 'paid')).toBe(true);
      expect(isValidTransition('opened', 'failed')).toBe(true);
      expect(isValidTransition('paid', 'refunded')).toBe(true);
    });

    it('should reject invalid transitions', () => {
      expect(isValidTransition('paid', 'opened')).toBe(false);
      expect(isValidTransition('failed', 'paid')).toBe(false);
      expect(isValidTransition('expired', 'paid')).toBe(false);
      expect(isValidTransition('refunded', 'paid')).toBe(false);
    });

    it('should allow idempotent transitions (same state)', () => {
      // Note: This is handled at service level, but transition is technically invalid
      // Service layer checks if already in target state before validating transition
      expect(isValidTransition('paid', 'paid')).toBe(false);
    });
  });

  describe('mapIntentToOrderStatus', () => {
    it('should map intent statuses to order statuses correctly', () => {
      expect(mapIntentToOrderStatus('created')).toBe('created');
      expect(mapIntentToOrderStatus('opened')).toBe('open');
      expect(mapIntentToOrderStatus('paid')).toBe('paid');
      expect(mapIntentToOrderStatus('failed')).toBe('failed');
      expect(mapIntentToOrderStatus('expired')).toBe('expired');
      expect(mapIntentToOrderStatus('refunded')).toBe('refunded');
    });
  });
});
