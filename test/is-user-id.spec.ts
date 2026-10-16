import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdjustCreditsDto } from '../src/credits/dto/credits.dto';
import { CreateEntitlementDto } from '../src/admin/dto/entitlement.dto';

/**
 * Billing rows are keyed by the id INITE Auth puts in `sub` — a DID for
 * anyone who signed in through OAuth. A UUID-only validator refused them.
 */
const DID = 'did:key:zGfHq2tTVk9z4eXgyLRSrKMGg6ewT1mV8TSs3hEtFzR8oyFAb6iZayfx1zNJM';
const UUID = '36118524-1cad-48ce-9c1e-396eb700f088';

const errorsFor = async (cls: any, body: Record<string, unknown>) =>
  (await validate(plainToInstance(cls, body))).filter((e) => e.property === 'userId');

describe('userId on billing DTOs', () => {
  it.each([DID, UUID, 'did:web:auth.inite.ai:agents:42'])('accepts %s', async (userId) => {
    expect(await errorsFor(AdjustCreditsDto, { userId, amount: 10 })).toEqual([]);
    expect(await errorsFor(CreateEntitlementDto, { userId, key: 'access.pro' })).toEqual([]);
  });

  it.each(['', 'alice', 'did:', "did:key:x'; drop table", 'x'.repeat(300)])(
    'refuses %p',
    async (userId) => {
      expect((await errorsFor(AdjustCreditsDto, { userId, amount: 10 })).length).toBeGreaterThan(0);
    },
  );
});
