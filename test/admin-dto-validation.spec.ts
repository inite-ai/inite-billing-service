import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreatePromoCodeDto } from '../src/admin/dto/create-promo-code.dto';
import {
  CreateReferralLevelDto,
  UpdateReferralLevelDto,
} from '../src/admin/dto/referral-level.dto';
import { CreatePriceDto, UpdatePriceDto } from '../src/admin/dto/price.dto';
import { CreateServiceDto } from '../src/admin/dto/service.dto';
import { CreateProductDto } from '../src/admin/dto/product.dto';
import { UpdateAffiliateDto } from '../src/admin/dto/affiliate-admin.dto';
import { AdminAdjustCreditsDto } from '../src/admin/dto/credits-admin.dto';
import { CreatePayoutProviderDto } from '../src/admin/dto/provider.dto';

/**
 * These admin bodies were inline TS interfaces, so the global ValidationPipe
 * (whitelist + forbidNonWhitelisted + transform) skipped them entirely —
 * negative/huge/fractional money values and mass-assigned fields got through.
 * Validate with the SAME options the global pipe uses.
 */
const PIPE_OPTS = { whitelist: true, forbidNonWhitelisted: true } as const;
const check = (cls: any, plain: any) => {
  const dto = plainToInstance(cls, plain, { enableImplicitConversion: false });
  return validateSync(dto as object, PIPE_OPTS);
};
const ok = (cls: any, plain: any) => expect(check(cls, plain)).toHaveLength(0);
const fails = (cls: any, plain: any) => expect(check(cls, plain).length).toBeGreaterThan(0);

describe('CreatePromoCodeDto', () => {
  const valid = {
    code: 'SUMMER',
    name: 'Summer sale',
    discountType: 'percentage',
    discountValue: 20,
    validFrom: '2026-06-01T00:00:00.000Z',
  };

  it('accepts a valid minimal payload (matches the admin UI)', () => ok(CreatePromoCodeDto, valid));

  it('coerces a string-form numeric (UI sends discountValue as a string)', () =>
    ok(CreatePromoCodeDto, { ...valid, discountValue: '20' }));

  it('rejects a negative discount', () =>
    fails(CreatePromoCodeDto, { ...valid, discountValue: -5 }));

  it('rejects a non-numeric discount', () =>
    fails(CreatePromoCodeDto, { ...valid, discountValue: 'lots' }));

  it('rejects sub-cent fractional overflow (> 4 dp)', () =>
    fails(CreatePromoCodeDto, { ...valid, discountValue: 1.234567 }));

  it('rejects an unknown discountType', () =>
    fails(CreatePromoCodeDto, { ...valid, discountType: 'bogus' }));

  it('rejects a bad validFrom', () =>
    fails(CreatePromoCodeDto, { ...valid, validFrom: 'yesterday' }));

  it('forbids mass-assigned fields (forbidNonWhitelisted)', () =>
    fails(CreatePromoCodeDto, { ...valid, isAdmin: true, usedCount: 9999 }));
});

describe('CreateReferralLevelDto', () => {
  const valid = {
    serviceId: '550e8400-e29b-41d4-a716-446655440000',
    level: 1,
    commissionRate: 0.1,
    name: 'Tier 1',
  };

  it('accepts a valid payload', () => ok(CreateReferralLevelDto, valid));

  it('coerces string-form level/commissionRate', () =>
    ok(CreateReferralLevelDto, { ...valid, level: '2', commissionRate: '0.25' }));

  it('rejects commissionRate above 1', () =>
    fails(CreateReferralLevelDto, { ...valid, commissionRate: 5 }));

  it('rejects a negative commissionRate', () =>
    fails(CreateReferralLevelDto, { ...valid, commissionRate: -0.1 }));

  it('rejects level below 1 and non-integer level', () => {
    fails(CreateReferralLevelDto, { ...valid, level: 0 });
    fails(CreateReferralLevelDto, { ...valid, level: 1.5 });
  });

  it('rejects a non-uuid serviceId', () =>
    fails(CreateReferralLevelDto, { ...valid, serviceId: 'not-a-uuid' }));

  it('forbids mass-assigned fields', () =>
    fails(CreateReferralLevelDto, { ...valid, totalRate: 999 }));
});

describe('UpdateReferralLevelDto', () => {
  it('accepts a partial update', () => ok(UpdateReferralLevelDto, { commissionRate: 0.2 }));
  it('accepts an empty body', () => ok(UpdateReferralLevelDto, {}));
  it('still rejects an out-of-range commissionRate', () =>
    fails(UpdateReferralLevelDto, { commissionRate: 2 }));
});

describe('CreatePriceDto', () => {
  const valid = {
    productId: '550e8400-e29b-41d4-a716-446655440000',
    code: 'pro-monthly',
    currency: 'USD',
    amount: 19.99,
    interval: 'month',
  };

  it('accepts exactly what the admin price form sends', () => {
    ok(CreatePriceDto, { ...valid, trialDays: 14, graceDays: 3 });
  });

  it('accepts a one-time price with no interval', () => {
    const { interval: _interval, ...oneTime } = valid;
    ok(CreatePriceDto, oneTime);
  });

  it('rejects negative, non-numeric and over-precise money', () => {
    fails(CreatePriceDto, { ...valid, amount: -1 });
    fails(CreatePriceDto, { ...valid, amount: 'free' });
    // Decimal(19,4) — anything finer is silently rounded on the way in.
    fails(CreatePriceDto, { ...valid, amount: 1.123456 });
  });

  it('rejects an interval calculatePeriodEnd does not understand', () => {
    // Its `default` branch bills monthly, so 'monthly' would turn a typo into a
    // billing decision instead of an error.
    fails(CreatePriceDto, { ...valid, interval: 'monthly' });
    fails(CreatePriceDto, { ...valid, interval: 'forever' });
  });

  it('accepts every interval it does understand', () => {
    for (const interval of ['day', 'week', 'month', 'year']) {
      ok(CreatePriceDto, { ...valid, interval });
    }
  });

  it('rejects a malformed productId or currency', () => {
    fails(CreatePriceDto, { ...valid, productId: 'not-a-uuid' });
    fails(CreatePriceDto, { ...valid, currency: 'DOLLARS' });
  });

  it('rejects mass-assigned fields', () => {
    fails(CreatePriceDto, { ...valid, isActive: true });
  });
});

describe('UpdatePriceDto', () => {
  it('accepts an empty body', () => {
    ok(UpdatePriceDto, {});
  });

  it('still bounds money', () => {
    fails(UpdatePriceDto, { amount: -5 });
    fails(UpdatePriceDto, { amount: 1.123456 });
  });
});

describe('CreateServiceDto', () => {
  const valid = { code: 'club', name: 'INITE Club' };

  it('accepts what the admin service form sends', () => ok(CreateServiceDto, valid));

  it('rejects a code that is not a slug', () => {
    // `code` is the identifier external modules scope against and that lands in
    // URLs and log lines.
    fails(CreateServiceDto, { ...valid, code: 'Club Service!' });
    fails(CreateServiceDto, { ...valid, code: '' });
  });
});

describe('CreateProductDto', () => {
  const valid = { code: 'pro', name: 'Pro', moduleScope: 'club', type: 'subscription' };

  it('accepts what the admin product form sends', () =>
    ok(CreateProductDto, { ...valid, serviceId: '550e8400-e29b-41d4-a716-446655440000' }));

  it('rejects a type outside the ProductType enum', () => {
    // Prisma would reject it at write time; this turns that 500 into a 400.
    fails(CreateProductDto, { ...valid, type: 'lifetime' });
  });
});

describe('UpdateAffiliateDto', () => {
  it('accepts the status toggle the affiliates page sends', () =>
    ok(UpdateAffiliateDto, { status: 'active' }));

  it('rejects an unknown status', () => fails(UpdateAffiliateDto, { status: 'vip' }));

  it('rejects a commissionRate above 1', () => {
    // 15 meaning "15%" would pay 1500% of every order.
    fails(UpdateAffiliateDto, { commissionRate: 15 });
    fails(UpdateAffiliateDto, { commissionRate: -0.1 });
  });
});

describe('AdminAdjustCreditsDto', () => {
  const valid = { userId: '550e8400-e29b-41d4-a716-446655440000', amount: 100 };

  it('accepts what the admin credits page sends', () =>
    ok(AdminAdjustCreditsDto, { ...valid, description: 'goodwill' }));

  it('accepts a negative adjustment (a burn)', () =>
    ok(AdminAdjustCreditsDto, { amount: -50, userId: valid.userId }));

  it('rejects fractional credits', () => {
    // Credits are integers on CreditBalance.
    fails(AdminAdjustCreditsDto, { ...valid, amount: 10.5 });
  });

  it('rejects an operator typo of an extra digit', () =>
    fails(AdminAdjustCreditsDto, { ...valid, amount: 100_000_000 }));
});

describe('CreatePayoutProviderDto', () => {
  const valid = { code: 'wise', name: 'Wise' };

  it('accepts what the payout-providers form sends', () =>
    ok(CreatePayoutProviderDto, {
      ...valid,
      currencies: ['USD', 'EUR'],
      minAmount: 10,
      feePercent: 0.02,
      feeFixed: 0.5,
    }));

  it('rejects a feePercent given as a percentage', () => {
    // The UI divides by 100 before posting; 2 here would mean 200%.
    fails(CreatePayoutProviderDto, { ...valid, feePercent: 2 });
  });

  it('rejects a negative minimum', () =>
    fails(CreatePayoutProviderDto, { ...valid, minAmount: -1 }));
});
