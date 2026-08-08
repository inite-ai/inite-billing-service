import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreatePromoCodeDto } from '../src/admin/dto/create-promo-code.dto';
import {
  CreateReferralLevelDto,
  UpdateReferralLevelDto,
} from '../src/admin/dto/referral-level.dto';

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

  it('rejects a negative discount', () => fails(CreatePromoCodeDto, { ...valid, discountValue: -5 }));

  it('rejects a non-numeric discount', () =>
    fails(CreatePromoCodeDto, { ...valid, discountValue: 'lots' }));

  it('rejects sub-cent fractional overflow (> 4 dp)', () =>
    fails(CreatePromoCodeDto, { ...valid, discountValue: 1.234567 }));

  it('rejects an unknown discountType', () =>
    fails(CreatePromoCodeDto, { ...valid, discountType: 'bogus' }));

  it('rejects a bad validFrom', () => fails(CreatePromoCodeDto, { ...valid, validFrom: 'yesterday' }));

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
