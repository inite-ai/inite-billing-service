import { Decimal } from '@prisma/client/runtime/library';
import type { CommitmentStatus } from '@prisma/client';
import {
  checkEndsAt,
  checkVerification,
  creditsFor,
  quote,
  readPolicy,
  tierPriceCode,
} from '../src/commitments/commitment-policy';
import { isBalanced, ledgerFor, mayTransition } from '../src/commitments/commitment-states';

/** The pure rules of commitments: the policy, the state table, the ledger. */
describe('commitment rules', () => {
  const policy = readPolicy({
    commitment: {
      tiers: ['5', '10', '25', '50', '100'],
      feePct: '5',
      creditsBonusPct: '20',
      creditsPerUsd: 100,
      maxActivePerUser: '300',
      verificationAbove: '25',
    },
  })!;

  it('is not a stake offer without a policy, and refuses a broken one', () => {
    expect(readPolicy({})).toBeNull();
    expect(() => readPolicy({ commitment: { tiers: [] } })).toThrow(/no tiers/);
    expect(() => readPolicy({ commitment: { tiers: ['5'], feePct: 'ten' } })).toThrow(/feePct/);
  });

  it('quotes the fee on top, to the cent, and the credits with the bonus', () => {
    expect(quote('break3-stake', policy, '25')).toMatchObject({
      stake: '25.00',
      fee: '1.25',
      total: '26.25',
      credits: 3000,
    });
    expect(quote('break3-stake', policy, '5').fee).toBe('0.25');
    expect(() => quote('break3-stake', policy, '7')).toThrow(/one of/);
    expect(creditsFor(new Decimal('10'), 100, new Decimal('0'))).toBe(1000);
    expect(tierPriceCode('break3-stake', '25')).toBe('break3-stake-usd-25');
  });

  it('needs a referee or proof above the threshold, not at it', () => {
    expect(() => checkVerification(policy, new Decimal(25), {})).not.toThrow();
    expect(() => checkVerification(policy, new Decimal(50), {})).toThrow(/referee or proof/);
    expect(() => checkVerification(policy, new Decimal(50), { proof: true })).not.toThrow();
    expect(() => checkVerification(policy, new Decimal(100), { referee: true })).not.toThrow();
  });

  it('bounds the promise length', () => {
    const now = new Date('2026-10-30T00:00:00Z');
    const at = (h: number) => new Date(now.getTime() + h * 3_600_000);
    expect(() => checkEndsAt(policy, at(12), now)).toThrow();
    expect(() => checkEndsAt(policy, at(48), now)).not.toThrow();
    expect(() => checkEndsAt(policy, at(181 * 24), now)).toThrow();
  });

  it('lets the product only release, forfeit, cancel or dispute a held stake', () => {
    expect(mayTransition('held', 'released_money', 'service')).toBe(true);
    expect(mayTransition('held', 'forfeited', 'service')).toBe(true);
    expect(mayTransition('pending_payment', 'held', 'service')).toBe(false);
    expect(mayTransition('held', 'auto_released', 'service')).toBe(false);
    expect(mayTransition('disputed', 'forfeited', 'service')).toBe(false);
    expect(mayTransition('disputed', 'forfeited', 'admin')).toBe(true);
    expect(mayTransition('forfeited', 'released_money', 'admin')).toBe(false);
    expect(mayTransition('released_money', 'held', 'admin')).toBe(false);
  });

  it('writes balanced lines for every move, and never a zero line', () => {
    const stake = new Decimal('25');
    const fee = new Decimal('1.25');
    const moves: Array<[CommitmentStatus, CommitmentStatus, any?]> = [
      ['pending_payment', 'held'],
      ['pending_payment', 'disputed'],
      ['held', 'released_money'],
      ['held', 'released_credits'],
      ['held', 'forfeited'],
      ['held', 'auto_released'],
      ['held', 'refunded_on_cancel', 'card'],
      ['held', 'refunded_on_cancel', 'wallet'],
      ['disputed', 'forfeited'],
      ['held', 'disputed'],
    ];
    for (const [from, to, cancelRoute] of moves) {
      const lines = ledgerFor({ from, to, stake, fee, charityCode: 'gd', cancelRoute });
      expect(isBalanced(lines)).toBe(true);
      for (const l of lines) expect(l.debit.isZero() && l.credit.isZero()).toBe(false);
    }
    const forfeit = ledgerFor({ from: 'held', to: 'forfeited', stake, fee, charityCode: 'gd' });
    expect(forfeit.map((l) => l.account)).toEqual(['held', 'charity_payable:gd']);
    // A zero fee writes no fee line.
    const zero = ledgerFor({
      from: 'pending_payment',
      to: 'held',
      stake,
      fee: new Decimal(0),
      charityCode: 'gd',
    });
    expect(zero.map((l) => l.account)).toEqual(['payments_in', 'held']);
  });
});
