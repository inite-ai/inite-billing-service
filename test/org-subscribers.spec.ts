import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { StartTrialDto } from '../src/subscriptions/dto/start-trial.dto';
import { CreateEntitlementDto } from '../src/admin/dto/entitlement.dto';
import { GetOrCreateConversationDto } from '../src/conversations/dto/conversations.dto';
import { SERVICE_BUYER_PATTERN, assertOwnGuestId } from '../src/service-api/buyer';
import { isGuestUserId } from '../src/checkout/checkout.service';
import { orgOf } from '../src/auth/strategies/jwt.strategy';
import { SubscriptionsService } from '../src/subscriptions/subscriptions.service';
import { SubscriptionsController } from '../src/subscriptions/subscriptions.controller';
import { PlanChangeService } from '../src/subscription-lifecycle/plan-change.service';
import {
  manageableSubscribers,
  mayManage,
  visibleSubscribers,
} from '../src/subscriptions/subscribers';

/**
 * A company's plan in the INITE family is held by its organisation at INITE
 * Auth, `org:<org_id>` (owner, 31.10.2026). Billing takes that id wherever a
 * subscriber is named, never mistakes it for a service's guest, and shows a
 * signed-in person their organisation's plans beside their own; only the
 * organisation's owner or admin (`org_role`) moves them.
 */
const ORG_ID = '7d0c1a52-3b8e-4f7e-9a51-2c6d8e4f1b90';
const ORG = `org:${ORG_ID}`;
const OTHER_ORG = 'org:0f5e2d1c-9b8a-4c7d-8e6f-5a4b3c2d1e0f';
const DID = 'did:key:z6Mkperson';

const errorsFor = async (cls: any, body: Record<string, unknown>) =>
  (await validate(plainToInstance(cls, body))).filter((e) => e.property === 'userId');

describe('org:<uuid> as a subscriber id', () => {
  it('is accepted by the trial and the entitlement DTOs', async () => {
    expect(await errorsFor(StartTrialDto, { priceCode: 'rent-pro-monthly', userId: ORG })).toEqual(
      [],
    );
    expect(await errorsFor(CreateEntitlementDto, { userId: ORG, key: 'rent:plan:pro' })).toEqual(
      [],
    );
  });

  it.each(['org:', 'org:acme', `org:${ORG_ID}x`, `org:${ORG_ID}:x`])('refuses %p', async (id) => {
    expect((await errorsFor(StartTrialDto, { priceCode: 'p', userId: id })).length).toBeGreaterThan(
      0,
    );
  });

  it('is not a conversation owner: a conversation is a person’s', async () => {
    expect((await errorsFor(GetOrCreateConversationDto, { userId: ORG })).length).toBeGreaterThan(
      0,
    );
    expect(await errorsFor(GetOrCreateConversationDto, { userId: DID })).toEqual([]);
  });

  it('is a buyer a service may name, and never its guest', () => {
    expect(SERVICE_BUYER_PATTERN.test(ORG)).toBe(true);
    expect(() => assertOwnGuestId(ORG, 'rent')).not.toThrow();
    expect(() => assertOwnGuestId('studio:abcdefgh', 'rent')).toThrow();
    // A guest order is handed to whoever opens it first; an organisation's
    // plan must not move to the person who opened its checkout.
    expect(isGuestUserId(ORG)).toBe(false);
    expect(isGuestUserId('rent:abcdefgh')).toBe(true);
  });
});

describe('the token’s organisation', () => {
  it('reads org_id and org_role, lower-case', () => {
    expect(orgOf({ org_id: ORG_ID.toUpperCase(), org_role: 'Admin' })).toEqual({
      orgId: ORG_ID,
      orgRole: 'admin',
    });
  });

  it('ignores a malformed org_id', () => {
    expect(orgOf({ org_id: 'acme', org_role: 'owner' })).toEqual({});
    expect(orgOf({})).toEqual({});
  });

  it('sees self and the org; moves the org’s plan only as owner or admin', () => {
    const owner = { userId: DID, orgId: ORG_ID, orgRole: 'owner' };
    const member = { userId: DID, orgId: ORG_ID, orgRole: 'member' };
    expect(visibleSubscribers(member)).toEqual([DID, ORG]);
    expect(visibleSubscribers({ userId: DID })).toEqual([DID]);
    expect(mayManage(owner, ORG)).toBe(true);
    expect(mayManage({ ...owner, orgRole: 'admin' }, ORG)).toBe(true);
    expect(mayManage(member, ORG)).toBe(false);
    expect(mayManage(member, DID)).toBe(true);
    expect(mayManage(owner, OTHER_ORG)).toBe(false);
    expect(manageableSubscribers(member)).toEqual([DID]);
  });
});

describe('the customer page with an organisation', () => {
  let prisma: any;
  let outbox: any;
  let orchestrator: any;
  let service: SubscriptionsService;

  const row = (userId: string, over: Record<string, unknown> = {}) => ({
    id: `sub-${userId}`,
    userId,
    priceId: 'price-1',
    status: 'active',
    cancelAtPeriodEnd: false,
    currentPeriodStart: new Date('2026-10-01T00:00:00Z'),
    currentPeriodEnd: new Date('2099-01-01T00:00:00Z'),
    price: { amount: 50, currency: 'USD', product: { serviceId: 'svc-1', name: 'Rent Pro' } },
    ...over,
  });

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn((cb: any) => cb(prisma)),
      service: { findUnique: jest.fn().mockResolvedValue({ id: 'svc-1', code: 'rent' }) },
      price: { findMany: jest.fn().mockResolvedValue([]) },
      subscription: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    };
    outbox = { emit: jest.fn() };
    orchestrator = { cancelProviderSubscription: jest.fn() };
    service = new SubscriptionsService(
      prisma,
      outbox,
      {} as any,
      { track: jest.fn() } as any,
      orchestrator,
    );
  });

  it('lists the person’s own plans and their organisation’s, marked', async () => {
    prisma.subscription.findMany.mockResolvedValue([row(DID), row(ORG)]);
    const subs = await service.getSubscriptionsFor({
      userId: DID,
      orgId: ORG_ID,
      orgRole: 'member',
    });
    expect(prisma.subscription.findMany.mock.calls[0][0].where).toEqual({
      userId: { in: [DID, ORG] },
    });
    expect(subs.map((s) => [s.userId, s.heldBy, s.canManage])).toEqual([
      [DID, 'self', true],
      [ORG, 'organization', false],
    ]);
  });

  it('scopes the page to one service by its code', async () => {
    prisma.subscription.findMany.mockResolvedValue([]);
    await service.getSubscriptionsFor({ userId: DID, orgId: ORG_ID }, 'rent');
    expect(prisma.subscription.findMany.mock.calls[0][0].where).toEqual({
      userId: { in: [DID, ORG] },
      price: { product: { serviceId: 'svc-1' } },
    });
  });

  it('lets an owner cancel the organisation’s plan', async () => {
    prisma.subscription.findFirst.mockResolvedValue(row(ORG));
    await service.cancelSubscription(
      { userId: DID, orgId: ORG_ID, orgRole: 'owner' },
      `sub-${ORG}`,
    );
    expect(prisma.subscription.findFirst.mock.calls[0][0].where).toEqual({
      id: `sub-${ORG}`,
      userId: { in: [DID, ORG] },
    });
    expect(orchestrator.cancelProviderSubscription).toHaveBeenCalled();
    expect(prisma.subscription.update).toHaveBeenCalled();
  });

  it('refuses a member: forbidden, and nothing is cancelled at the provider', async () => {
    prisma.subscription.findFirst.mockResolvedValue(row(ORG));
    await expect(
      service.cancelSubscription({ userId: DID, orgId: ORG_ID, orgRole: 'member' }, `sub-${ORG}`),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.resumeSubscription({ userId: DID, orgId: ORG_ID, orgRole: 'member' }, `sub-${ORG}`),
    ).rejects.toThrow(ForbiddenException);
    expect(orchestrator.cancelProviderSubscription).not.toHaveBeenCalled();
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('without an org claim, another organisation’s plan is not found', async () => {
    prisma.subscription.findFirst.mockResolvedValue(null);
    await expect(service.cancelSubscription(DID, `sub-${ORG}`)).rejects.toThrow(NotFoundException);
    expect(prisma.subscription.findFirst.mock.calls[0][0].where.userId).toEqual({ in: [DID] });
  });
});

describe('POST /v1/subscriptions/trial for an organisation', () => {
  const startTrial = jest.fn().mockResolvedValue({ id: 'sub-1' });
  const controller = new SubscriptionsController({ startTrial } as any);
  beforeEach(() => startTrial.mockClear());

  it('a service names the organisation', async () => {
    await controller.startTrial(
      { user: { isService: true, serviceId: 'svc-1' } },
      { priceCode: 'p', userId: ORG },
    );
    expect(startTrial).toHaveBeenCalledWith(ORG, 'p', 'svc-1');
  });

  it('a person starts one for their organisation as its owner or admin', async () => {
    await controller.startTrial(
      { user: { userId: DID, orgId: ORG_ID, orgRole: 'admin' } },
      { priceCode: 'p', userId: ORG },
    );
    expect(startTrial).toHaveBeenCalledWith(ORG, 'p', undefined);
  });

  it('a member, or another organisation, is refused', async () => {
    await expect(
      controller.startTrial(
        { user: { userId: DID, orgId: ORG_ID, orgRole: 'member' } },
        { priceCode: 'p', userId: ORG },
      ),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      controller.startTrial(
        { user: { userId: DID, orgId: ORG_ID, orgRole: 'owner' } },
        { priceCode: 'p', userId: OTHER_ORG },
      ),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      controller.startTrial(
        { user: { userId: DID } },
        { priceCode: 'p', userId: 'did:key:z6Mksomeoneelse' },
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(startTrial).not.toHaveBeenCalled();
  });
});

describe('a plan change on the organisation’s plan', () => {
  it('is refused to a member and allowed to an admin', async () => {
    const sub = {
      id: 'sub-1',
      userId: ORG,
      status: 'active',
      cancelAtPeriodEnd: true,
      price: { product: { serviceId: 'svc-1' } },
    };
    const prisma: any = {
      subscription: { findUnique: jest.fn().mockResolvedValue(sub) },
    };
    const planChange = new PlanChangeService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {
        get: () => undefined,
      } as any,
    );
    await expect(
      planChange.change(
        { userId: DID, orgId: ORG_ID, orgRole: 'member' },
        { subscriptionId: 'sub-1', priceCode: 'x' },
      ),
    ).rejects.toThrow(ForbiddenException);
    // An admin passes the ownership check and reaches the plan's own rules
    // (here: cancelled at period end, resume first).
    await expect(
      planChange.change(
        { userId: DID, orgId: ORG_ID, orgRole: 'admin' },
        { subscriptionId: 'sub-1', priceCode: 'x' },
      ),
    ).rejects.toThrow(/resume it first/);
    await expect(
      planChange.change({ userId: DID }, { subscriptionId: 'sub-1', priceCode: 'x' }),
    ).rejects.toThrow(NotFoundException);
  });
});
