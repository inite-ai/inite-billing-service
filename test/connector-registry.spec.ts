import { Test } from '@nestjs/testing';
import { DiscoveryModule } from '@nestjs/core';
import { ConnectorRegistry } from '../src/common/connectors/connector-registry.service';
import { PrismaService } from '../src/common/services/prisma.service';
import { RAILS, isRail, isVirtualRail, ALL_RAILS } from '../src/common/connectors/rail';
import { OneAdapter } from '../src/adapters/one/one.adapter';
import { LavaAdapter } from '../src/adapters/lava/lava.adapter';
import { StripeAdapter } from '../src/adapters/stripe/stripe.adapter';
import { CryptoAdapter } from '../src/adapters/crypto/crypto.adapter';
import { AppleIAPAdapter } from '../src/adapters/apple-iap/apple-iap.adapter';
import { GooglePlayAdapter } from '../src/adapters/google-play/google-play.adapter';

/**
 * The registry must auto-discover every @RegisterConnector() adapter via
 * DiscoveryService with zero static wiring — this is the "add a rail = one
 * self-registering class" contract. It also cross-checks active providers so a
 * mis-typed code is loud at boot instead of failing silently at charge time.
 */
describe('ConnectorRegistry auto-discovery', () => {
  let registry: ConnectorRegistry;
  let findMany: jest.Mock;

  beforeAll(async () => {
    findMany = jest.fn().mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      imports: [DiscoveryModule],
      providers: [
        { provide: PrismaService, useValue: { paymentProvider: { findMany } } },
        OneAdapter,
        LavaAdapter,
        StripeAdapter,
        CryptoAdapter,
        AppleIAPAdapter,
        GooglePlayAdapter,
        ConnectorRegistry,
      ],
    }).compile();
    await moduleRef.init(); // fires onModuleInit -> discover + validate
    registry = moduleRef.get(ConnectorRegistry);
  });

  it('discovers all six real payment rails', () => {
    const rails = registry.rails().sort();
    expect(rails).toEqual(
      [
        RAILS.APPLE_IAP,
        RAILS.CRYPTO,
        RAILS.GOOGLE_PLAY,
        RAILS.LAVA,
        RAILS.ONE,
        RAILS.STRIPE,
      ].sort(),
    );
  });

  it('does NOT register the virtual PROMO rail (no adapter)', () => {
    expect(registry.has(RAILS.PROMO)).toBe(false);
    expect(isVirtualRail(RAILS.PROMO)).toBe(true);
  });

  it('each connector reports its rail and capabilities', () => {
    for (const rail of registry.rails()) {
      const connector = registry.get(rail)!;
      expect(connector.rail()).toBe(rail);
      const caps = connector.capabilities!();
      expect(caps.supportedModes.length).toBeGreaterThan(0);
    }
  });

  it('IAP rails are client-side and expose a subscription anchor resolver', () => {
    const apple = registry.get(RAILS.APPLE_IAP)!;
    expect(apple.capabilities!().isClientSide).toBe(true);
    expect(apple.subscriptionAnchorId!({ originalTransactionId: 'orig-1' })).toBe('orig-1');

    const google = registry.get(RAILS.GOOGLE_PLAY)!;
    expect(google.subscriptionAnchorId!({}, { providerIntentId: 'token-1' })).toBe('token-1');
  });

  it('validates active providers against the registry at boot', () => {
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isActive: true } }));
  });
});

describe('rail identity helpers', () => {
  it('isRail recognises every known rail and rejects unknowns', () => {
    for (const rail of ALL_RAILS) expect(isRail(rail)).toBe(true);
    expect(isRail('PAYPAL')).toBe(false);
    expect(isRail('apple')).toBe(false); // the old lowercase drift
  });
});
