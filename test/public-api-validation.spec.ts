import 'reflect-metadata';
import { ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { publicApiValidation } from '../src/common/pipes/public-api-validation.pipe';
import { ConsumeCreditsDto } from '../src/credits/dto/credits.dto';

const meta: ArgumentMetadata = { type: 'body', metatype: ConsumeCreditsDto };

/**
 * These routes are a published contract other services already call. Adding
 * validation must not start rejecting callers who send a field we do not know
 * about — the global pipe's `forbidNonWhitelisted` would do exactly that.
 */
describe('publicApiValidation', () => {
  it('accepts an unknown field instead of 400ing a caller', async () => {
    const result = await publicApiValidation().transform(
      { userId: '550e8400-e29b-41d4-a716-446655440000', amount: 5, somethingNew: 'from v3' },
      meta,
    );

    expect(result.amount).toBe(5);
    // Unknown fields are still stripped, so they cannot be mass-assigned onward.
    expect((result as Record<string, unknown>).somethingNew).toBeUndefined();
  });

  it('still rejects a known field that is invalid', async () => {
    await expect(
      publicApiValidation().transform(
        { userId: '550e8400-e29b-41d4-a716-446655440000', amount: -5 },
        meta,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('still rejects fractional credits', async () => {
    await expect(
      publicApiValidation().transform(
        { userId: '550e8400-e29b-41d4-a716-446655440000', amount: 1.5 },
        meta,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('coerces string-form numerics the way the global pipe does', async () => {
    const result = await publicApiValidation().transform(
      { userId: '550e8400-e29b-41d4-a716-446655440000', amount: '7' },
      meta,
    );
    expect(result.amount).toBe(7);
  });
});
