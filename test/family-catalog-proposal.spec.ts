import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * docs/catalog/family-subscriptions-2026-10.json is the reviewed list of
 * catalogue changes for family subscriptions. It is applied by hand, never by
 * a migration (scripts/catalog/apply-family-subscriptions.sh); this keeps it
 * true to the owner's rules (30.10 and 31.10.2026): yearly = 10x monthly, no
 * trials, every plan sold to an organisation with its number of people as a
 * limit (never per seat), and nothing priced among the services kept off sale.
 */
describe('family subscriptions catalogue proposal', () => {
  const doc = JSON.parse(
    readFileSync(
      join(__dirname, '..', 'docs', 'catalog', 'family-subscriptions-2026-10.json'),
      'utf8',
    ),
  );
  const onSale = doc.changes.filter((c: any) => c.action !== 'off_sale');

  it('says it is a proposal', () => {
    expect(doc.status).toMatch(/^PROPOSAL/);
  });

  it('prices every yearly plan at ten months, in every currency', () => {
    for (const change of onSale) {
      const prices = change.prices.filter((p: any) => p.action !== 'deactivate');
      for (const yearly of prices.filter((p: any) => p.interval === 'year')) {
        const monthly = prices.find(
          (p: any) => p.interval === 'month' && p.currency === yearly.currency,
        );
        expect({ code: yearly.code, amount: yearly.amount }).toEqual({
          code: yearly.code,
          amount: monthly.amount * 10,
        });
      }
    }
  });

  it('starts no trial on any plan', () => {
    for (const change of onSale) {
      expect([change.product, change.trialDays]).toEqual([change.product, 0]);
    }
  });

  it('sells every plan to an organisation, ranked, with the entitlement of its tier', () => {
    for (const change of onSale) {
      expect([change.product, change.kind]).toEqual([change.product, 'company']);
      expect(Number.isInteger(change.rank) && change.rank > 0).toBe(true);
      const key = change.isAddon ? `:${change.tier}` : `:plan:${change.tier}`;
      expect(change.addEntitlements.some((k: string) => k.endsWith(key))).toBe(true);
    }
  });

  it('counts people as a limit, never as a priced seat', () => {
    for (const change of onSale) {
      for (const price of change.prices) {
        expect(price).not.toHaveProperty('perSeat');
        expect(price).not.toHaveProperty('quantity');
      }
    }
  });

  it('prices training and travel as the owner decided', () => {
    const monthly = (product: string) =>
      doc.changes
        .find((c: any) => c.product === product)
        .prices.find((p: any) => p.interval === 'month' && p.action !== 'deactivate').amount;
    expect(['training-starter', 'training-professional', 'training-ai-pack'].map(monthly)).toEqual([
      49, 129, 39,
    ]);
    expect(
      ['travel-starter', 'travel-pro', 'travel-enterprise', 'travel-concierge'].map(monthly),
    ).toEqual([49, 99, 199, 29]);
  });

  it('names an https return origin for every service it sells', () => {
    for (const service of new Set(onSale.map((c: any) => c.service))) {
      const origins = doc.allowedOrigins[service as string];
      expect([service, Array.isArray(origins) && origins.length > 0]).toEqual([service, true]);
      for (const o of origins) expect(new URL(o).origin).toBe(o);
      for (const o of origins) expect(o.startsWith('https://')).toBe(true);
    }
  });

  it('fixes health in dollars at $49 and $129', () => {
    const monthly = (product: string) =>
      doc.changes
        .find((c: any) => c.product === product)
        .prices.find((p: any) => p.interval === 'month' && p.action !== 'deactivate');
    expect(monthly('inite-health-starter')).toMatchObject({ currency: 'USD', amount: 49 });
    expect(monthly('inite-health-professional')).toMatchObject({ currency: 'USD', amount: 129 });
    // The EUR rows are switched off, never rewritten: orders and live
    // subscriptions point at them.
    const eur = doc.changes
      .filter((c: any) => c.service === 'inite-health')
      .flatMap((c: any) => c.prices)
      .filter((p: any) => p.currency === 'EUR');
    expect(eur.length).toBeGreaterThan(0);
    for (const p of eur) expect(p.action).toBe('deactivate');
  });

  it('sells nothing for services, club, fund and brain', () => {
    const off = doc.offSale.map((o: any) => o.service);
    expect(off).toEqual(expect.arrayContaining(['services', 'club', 'fund', 'brain']));
    for (const service of off) {
      expect(doc.changes.filter((c: any) => c.service === service)).toEqual([]);
    }
  });
});
