import { signOutboxDelivery, verifyOutboxDelivery } from '../src/workers/outbox-signature';

/**
 * Outbox deliveries are HMAC-signed so consumers can authenticate billing events
 * (and reject forged/replayed ones). Pins the wire format and the verify contract.
 */
describe('outbox HMAC signing', () => {
  const secret = 'svc_api_key_123';
  const timestamp = '1754680000';
  const body = JSON.stringify({ type: 'billing.payment.succeeded', eventId: 'evt_1' });

  it('produces a stable sha256=<hex> signature', () => {
    const sig = signOutboxDelivery(secret, timestamp, body);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    // Deterministic for the same inputs.
    expect(signOutboxDelivery(secret, timestamp, body)).toBe(sig);
  });

  it('verifies a genuine signature', () => {
    const signature = signOutboxDelivery(secret, timestamp, body);
    expect(
      verifyOutboxDelivery({ secret, timestamp, body, signature, nowSeconds: Number(timestamp) }),
    ).toBe(true);
  });

  it('rejects a tampered body', () => {
    const signature = signOutboxDelivery(secret, timestamp, body);
    expect(
      verifyOutboxDelivery({
        secret,
        timestamp,
        body: body.replace('succeeded', 'refunded'),
        signature,
        nowSeconds: Number(timestamp),
      }),
    ).toBe(false);
  });

  it('rejects the wrong secret', () => {
    const signature = signOutboxDelivery('other_secret', timestamp, body);
    expect(
      verifyOutboxDelivery({ secret, timestamp, body, signature, nowSeconds: Number(timestamp) }),
    ).toBe(false);
  });

  it('rejects a stale timestamp (replay protection)', () => {
    const signature = signOutboxDelivery(secret, timestamp, body);
    expect(
      verifyOutboxDelivery({
        secret,
        timestamp,
        body,
        signature,
        nowSeconds: Number(timestamp) + 10_000,
      }),
    ).toBe(false);
  });
});
