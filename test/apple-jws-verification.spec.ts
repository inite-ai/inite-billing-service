import { AppleIAPAdapter } from '../src/adapters/apple-iap/apple-iap.adapter';
import { verifyAppleSignedPayload } from '../src/adapters/apple-iap/apple-jws.util';
import {
  signAppleJws,
  TEST_ROOT,
  LEAF_DER_B64,
  INT_DER_B64,
  ROOT_DER_B64,
} from './fixtures/apple-jws.fixtures';

/**
 * Apple App Store Server Notifications V2 carry a signed JWS (`signedPayload`).
 * The old adapter did a presence-check only — an unauthenticated attacker could
 * POST a hand-crafted DID_RENEW/REFUND and mint free subscriptions/entitlements
 * or force refunds. Verification must require a genuine Apple-signed JWS:
 * a valid x5c chain to the pinned Apple Root CA G3 + a valid ES256 signature.
 */
describe('Apple JWS verification', () => {
  const notification = {
    notificationType: 'DID_RENEW',
    notificationUUID: 'uuid-1',
    data: { bundleId: 'ai.inite.app', signedTransactionInfo: 'x.y.z' },
  };

  describe('verifyAppleSignedPayload (against a test trust anchor)', () => {
    it('accepts a genuinely-signed JWS whose chain anchors to the pinned root', async () => {
      const jws = await signAppleJws(notification);
      const res = await verifyAppleSignedPayload(jws, { roots: [TEST_ROOT] });
      expect(res.verified).toBe(true);
      expect(res.payload.notificationType).toBe('DID_RENEW');
    });

    it('accepts a chain that also includes the root cert (leaf+int+root)', async () => {
      const jws = await signAppleJws(notification, [LEAF_DER_B64, INT_DER_B64, ROOT_DER_B64]);
      const res = await verifyAppleSignedPayload(jws, { roots: [TEST_ROOT] });
      expect(res.verified).toBe(true);
    });

    it('rejects a tampered payload (signature no longer matches)', async () => {
      const jws = await signAppleJws(notification);
      const [h, , s] = jws.split('.');
      const forgedPayload = Buffer.from(
        JSON.stringify({ ...notification, notificationType: 'REFUND' }),
      ).toString('base64url');
      const tampered = `${h}.${forgedPayload}.${s}`;
      const res = await verifyAppleSignedPayload(tampered, { roots: [TEST_ROOT] });
      expect(res.verified).toBe(false);
    });

    it('rejects a self-signed forgery that does not chain to the pinned root', async () => {
      // Present the leaf as its own single-cert chain — no path to the root.
      const jws = await signAppleJws(notification, [LEAF_DER_B64]);
      const res = await verifyAppleSignedPayload(jws, { roots: [TEST_ROOT] });
      expect(res.verified).toBe(false);
    });

    it('rejects a non-ES256 algorithm (alg-confusion guard)', async () => {
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', x5c: [LEAF_DER_B64] })).toString(
        'base64url',
      );
      const body = Buffer.from(JSON.stringify(notification)).toString('base64url');
      const res = await verifyAppleSignedPayload(`${header}.${body}.deadbeef`, {
        roots: [TEST_ROOT],
      });
      expect(res.verified).toBe(false);
    });

    it('enforces bundleId when provided', async () => {
      const jws = await signAppleJws(notification);
      expect(
        (await verifyAppleSignedPayload(jws, { roots: [TEST_ROOT], bundleId: 'ai.inite.app' }))
          .verified,
      ).toBe(true);
      expect(
        (await verifyAppleSignedPayload(jws, { roots: [TEST_ROOT], bundleId: 'com.evil.app' }))
          .verified,
      ).toBe(false);
    });

    it('rejects malformed input', async () => {
      expect((await verifyAppleSignedPayload(undefined)).verified).toBe(false);
      expect((await verifyAppleSignedPayload('not-a-jws')).verified).toBe(false);
      expect((await verifyAppleSignedPayload('a.b')).verified).toBe(false);
    });

    it('rejects when the leaf certificate is outside its validity window', async () => {
      const jws = await signAppleJws(notification);
      const past = Date.parse('2000-01-01T00:00:00Z');
      const res = await verifyAppleSignedPayload(jws, { roots: [TEST_ROOT], now: past });
      expect(res.verified).toBe(false);
    });
  });

  describe('AppleIAPAdapter.verifyWebhook (pinned to the REAL Apple root)', () => {
    const adapter = new AppleIAPAdapter({} as any);
    const input = (payload: any, config: any = {}) =>
      ({ rawBody: Buffer.from(''), headers: {}, config, payload }) as any;

    it('rejects a webhook with no signedPayload', async () => {
      expect(await adapter.verifyWebhook(input({ notificationType: 'DID_RENEW' }))).toBe(false);
    });

    it('rejects a fully self-consistent JWS that does not chain to Apple Root CA G3', async () => {
      // This JWS is validly signed and chains to the *test* root — but the adapter
      // pins Apple's real G3 root, so a forgery like this is rejected. This is the
      // exact attacker scenario the fix closes.
      const jws = await signAppleJws(notification, [LEAF_DER_B64, INT_DER_B64, ROOT_DER_B64]);
      expect(await adapter.verifyWebhook(input({ signedPayload: jws }))).toBe(false);
    });
  });
});
