import { AdminProvidersService } from '../src/admin/services/admin-providers.service';

/**
 * Provider credentials must not leave the server.
 *
 * `PaymentProvider.config` holds the live secret key and the webhook signing
 * secret; the admin list endpoint serialised the whole row, so those reached
 * the browser on every page load — devtools, screen shares, and anything that
 * ever runs script on the page. The UI never displayed them: it only needed to
 * know which keys were set, and it merged into them so that saving one field
 * did not wipe the other. Both of those are the server's job now.
 */
describe('admin provider secrets', () => {
  const provider = {
    id: 'prov-1',
    code: 'stripe',
    name: 'Stripe',
    isActive: true,
    config: { apiKey: 'sk_live_51HxYzABCDEF', apiSecret: 'whsec_9f8e7d6c5b4a', mode: 'live' },
  };

  const build = (row: any = provider) => {
    const prisma: any = {
      paymentProvider: {
        findMany: jest.fn().mockResolvedValue([row]),
        findUnique: jest.fn().mockResolvedValue(row),
        create: jest.fn().mockResolvedValue(row),
        update: jest.fn().mockImplementation(({ data }: any) => ({ ...row, ...data })),
        delete: jest.fn().mockResolvedValue(row),
      },
      payoutProvider: {
        findMany: jest.fn().mockResolvedValue([row]),
        findUnique: jest.fn().mockResolvedValue(row),
        update: jest.fn().mockImplementation(({ data }: any) => ({ ...row, ...data })),
      },
    };
    return { prisma, service: new AdminProvidersService(prisma) };
  };

  it('never sends the config in a list', async () => {
    const { service } = build();
    const [listed] = await service.getPaymentProviders();

    expect(listed).not.toHaveProperty('config');
    expect(JSON.stringify(listed)).not.toContain('sk_live_51HxYzABCDEF');
    expect(JSON.stringify(listed)).not.toContain('whsec_9f8e7d6c5b4a');
  });

  it('says which credentials are stored, and shows only their tail', async () => {
    const { service } = build();
    const [listed] = (await service.getPaymentProviders()) as any[];

    expect(listed.configuredKeys).toEqual(['apiKey', 'apiSecret', 'mode']);
    expect(listed.configPreview).toEqual({
      apiKey: '••••CDEF',
      apiSecret: '••••5b4a',
      // Four characters or fewer are masked whole rather than shown whole.
      mode: '••••',
    });
  });

  it('keeps a credential the form never saw', async () => {
    // The edit form submits only what was typed. Merging on the client is what
    // used to require handing it the secrets in the first place.
    const { prisma, service } = build();
    await service.updatePaymentProvider('prov-1', { config: { apiKey: 'sk_live_ROTATED' } });

    expect(prisma.paymentProvider.update.mock.calls[0][0].data.config).toEqual({
      apiKey: 'sk_live_ROTATED',
      apiSecret: 'whsec_9f8e7d6c5b4a',
      mode: 'live',
    });
  });

  it('deletes a credential when it is submitted as null', async () => {
    const { prisma, service } = build();
    await service.updatePaymentProvider('prov-1', { config: { apiSecret: null } });

    expect(prisma.paymentProvider.update.mock.calls[0][0].data.config).toEqual({
      apiKey: 'sk_live_51HxYzABCDEF',
      mode: 'live',
    });
  });

  it('leaves the config alone when the update does not mention it', async () => {
    const { prisma, service } = build();
    await service.updatePaymentProvider('prov-1', { isActive: false });

    expect(prisma.paymentProvider.update.mock.calls[0][0].data.config).toBeUndefined();
  });

  it('redacts the update response too', async () => {
    const { service } = build();
    const updated: any = await service.updatePaymentProvider('prov-1', { name: 'Stripe EU' });

    expect(updated).not.toHaveProperty('config');
    expect(updated.name).toBe('Stripe EU');
  });

  it('applies the same rules to payout providers', async () => {
    const { prisma, service } = build();
    const [listed] = (await service.getPayoutProviders()) as any[];
    expect(listed).not.toHaveProperty('config');

    await service.updatePayoutProvider('prov-1', { config: { apiKey: 'rotated' } });
    expect(prisma.payoutProvider.update.mock.calls[0][0].data.config).toMatchObject({
      apiKey: 'rotated',
      apiSecret: 'whsec_9f8e7d6c5b4a',
    });
  });

  it('refuses to treat a prototype key as a credential name', async () => {
    // The config is built from a request body, and `base['__proto__'] = value`
    // on a plain object sets its prototype rather than a field.
    const { prisma, service } = build();
    await service.updatePaymentProvider('prov-1', {
      config: JSON.parse('{"__proto__": {"polluted": true}, "constructor": "x", "apiKey": "ok"}'),
    });

    const written = prisma.paymentProvider.update.mock.calls[0][0].data.config;
    expect(written.apiKey).toBe('ok');
    expect(Object.keys(written)).not.toContain('constructor');
    expect(({} as any).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(written)).toBe(Object.prototype);
  });

  it('handles a provider with no config at all', async () => {
    const { service } = build({ ...provider, config: null });
    const [listed] = (await service.getPaymentProviders()) as any[];
    expect(listed.configuredKeys).toEqual([]);
  });
});
