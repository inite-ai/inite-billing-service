import { ForbiddenException } from '@nestjs/common';
import { CreditsController } from '../src/credits/credits.controller';
import { RequestUser } from '../src/auth/decorators/user.decorator';

/**
 * Write-access IDOR guard for the credits API. A service key must only ever act
 * within its OWN service scope: /consume and /adjust must derive serviceId from
 * the authenticated key, never from a caller-supplied body.serviceId — otherwise
 * one service could mint or drain credits booked under another service's scope
 * (same class as the entitlement IDOR fixed in #90, but with write access).
 */
describe('CreditsController — service scope is authoritative (IDOR)', () => {
  let controller: CreditsController;
  let creditsService: { consume: jest.Mock; adminAdjust: jest.Mock };

  const serviceUser = (serviceId: string): RequestUser => ({
    userId: 'svc',
    roles: [],
    isService: true,
    serviceId,
  });
  const jwtUser = (userId: string): RequestUser => ({ userId, roles: [] });

  beforeEach(() => {
    creditsService = {
      consume: jest.fn().mockResolvedValue({ success: true, remainingBalance: 0 }),
      adminAdjust: jest.fn().mockResolvedValue({}),
    };
    controller = new CreditsController(creditsService as any, {} as any);
  });

  it('consume: a service caller cannot target another service via body.serviceId', async () => {
    await controller.consumeCredits(serviceUser('service-A'), {
      userId: 'user-1',
      serviceId: 'service-B', // attacker tries to drain under service B
      amount: 10,
    });
    expect(creditsService.consume).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', serviceId: 'service-A' }),
    );
  });

  it('adjust: a service caller cannot mint under another service via body.serviceId', async () => {
    await controller.adjustCredits(serviceUser('service-A'), {
      userId: 'user-1',
      serviceId: 'service-B', // attacker tries to mint under service B
      amount: 1000,
    });
    expect(creditsService.adminAdjust).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', serviceId: 'service-A' }),
    );
  });

  it('adjust: non-service callers are forbidden', async () => {
    await expect(
      controller.adjustCredits(jwtUser('user-1'), { userId: 'user-1', amount: 5 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(creditsService.adminAdjust).not.toHaveBeenCalled();
  });

  it('consume: a user caller acts only on their own userId', async () => {
    await controller.consumeCredits(jwtUser('user-1'), {
      userId: 'user-2', // ignored — forced to the JWT subject
      amount: 5,
    });
    expect(creditsService.consume).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
    );
  });
});
