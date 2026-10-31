import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * docs/catalog/family-subscriptions-2026-10.json is the reviewed list of
 * catalogue changes for family subscriptions. It is applied by hand, never by
 * a migration; this keeps it true to the owner's rules (30.10.2026) while it
 * is reviewed: yearly = 10x monthly, trials 14 days for company plans and 7
 * for personal ones, and nothing priced among the services kept off sale.
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

  it('gives company plans 14 days of trial and personal plans 7', () => {
    for (const change of onSale) {
      expect([change.product, change.trialDays]).toEqual([
        change.product,
        change.kind === 'company' ? 14 : 7,
      ]);
    }
  });

  it('fixes health in dollars at $49 and $129', () => {
    const monthly = (product: string) =>
      doc.changes
        .find((c: any) => c.product === product)
        .prices.find((p: any) => p.interval === 'month');
    expect(monthly('inite-health-starter')).toMatchObject({ currency: 'USD', amount: 49 });
    expect(monthly('inite-health-professional')).toMatchObject({ currency: 'USD', amount: 129 });
  });

  it('sells nothing for services, club, fund and brain', () => {
    const off = doc.offSale.map((o: any) => o.service);
    expect(off).toEqual(expect.arrayContaining(['services', 'club', 'fund', 'brain']));
    for (const service of off) {
      expect(doc.changes.filter((c: any) => c.service === service)).toEqual([]);
    }
  });
});
