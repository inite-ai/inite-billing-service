import { readFileSync } from 'fs';
import { join } from 'path';
import { ForbiddenException } from '@nestjs/common';
import { of } from 'rxjs';
import {
  assertNotDemo,
  assertNotDemoSubscriber,
  DEMO_ORG_ID,
  DEMO_SUBSCRIBER,
  isDemoClaims,
  isDemoSubscriber,
} from '../src/common/demo';
import { orgSubscriber } from '../src/common/validators/is-user-id';
import { DemoReadOnlyInterceptor, isDemoRequest } from '../src/common/demo-read-only.interceptor';
import { JwtStrategy } from '../src/auth/strategies/jwt.strategy';
import { mayManage, visibleSubscribers } from '../src/subscriptions/subscribers';
import { AdminStatsService } from '../src/admin/services/admin-stats.service';
import { SubscriptionExpirerScheduler } from '../src/workers/subscription-expirer.scheduler';
import { SubscriptionRenewalsService } from '../src/subscription-lifecycle/renewals.service';
import { OutboxService } from '../src/outbox/outbox.service';
import { FunnelService } from '../src/funnel/funnel.service';
import { CreditsService } from '../src/credits/credits.service';
import { OutreachService } from '../src/outreach/outreach.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { ContactCaptureInterceptor } from '../src/notifications/contact-capture.interceptor';

/**
 * The family demo (owner, 2026-11): «Atlântica Group (demo)», one tenant in
 * INITE Auth, read-only in every product. In billing a demo session reads the
 * demo tenant's fixtures, keyed `org:<DEMO_ORG_ID>`, and nothing it does or
 * that is done for the demo tenant moves money, sends a message, emits an
 * event or counts in a total.
 */

const token = (claims: Record<string, unknown>) =>
  `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;

describe('the demo tenant id', () => {
  it('is the one INITE Auth fixes (inite-auth-service src/organizations/demo-tenant.ts)', () => {
    // Source of truth: INITE Auth. inite-shared repeats it as DEMO_ORG_ID in
    // @inite/auth/demo; this public repository pins it instead of importing.
    expect(DEMO_ORG_ID).toBe('a7a71c00-de00-4000-8000-000000000001');
    expect(DEMO_SUBSCRIBER).toBe('org:a7a71c00-de00-4000-8000-000000000001');
    expect(DEMO_SUBSCRIBER).toBe(orgSubscriber(DEMO_ORG_ID));
  });

  it('is the same in the frontend, which cannot import the backend', () => {
    const fe = readFileSync(join(__dirname, '../frontend/lib/demo.ts'), 'utf8');
    expect(fe).toContain(`DEMO_ORG_ID = '${DEMO_ORG_ID}'`);
  });
});

describe('demo claims and owners', () => {
  it('knows a demo token by its flag or by its organisation', () => {
    expect(isDemoClaims({ demo: true })).toBe(true);
    expect(isDemoClaims({ org_id: DEMO_ORG_ID.toUpperCase() })).toBe(true);
    expect(isDemoClaims({ org_id: '11111111-1111-4111-8111-111111111111' })).toBe(false);
    expect(isDemoClaims({ demo: 'true' })).toBe(false);
    expect(isDemoClaims(null)).toBe(false);
  });

  it('refuses the demo tenant and a demo caller with 403 demo_read_only', () => {
    expect(() => assertNotDemoSubscriber(DEMO_SUBSCRIBER)).toThrow(ForbiddenException);
    expect(() => assertNotDemo({ demo: true, userId: 'did:key:z6Mk' })).toThrow(ForbiddenException);
    try {
      assertNotDemoSubscriber(DEMO_SUBSCRIBER);
    } catch (e: any) {
      expect(e.getStatus()).toBe(403);
      expect(e.getResponse().error).toBe('demo_read_only');
    }
    expect(() => assertNotDemoSubscriber('did:key:z6MkReal')).not.toThrow();
    expect(isDemoSubscriber('org:11111111-1111-4111-8111-111111111111')).toBe(false);
  });
});

describe('a demo session resolves to the demo tenant', () => {
  const strategy = new JwtStrategy({
    get: (k: string) => ({ JWT_SECRET: 'unit-test-placeholder-secret', NODE_ENV: 'test' })[k],
  } as any);

  it('reads as org:<DEMO_ORG_ID>, keeps its role there, and is never an admin', async () => {
    const user: any = await strategy.validate({
      sub: 'did:key:z6MkAnaDemo',
      email: 'ana@demo.invalid',
      email_verified: true,
      roles: ['admin'],
      org_id: DEMO_ORG_ID,
      org_role: 'OWNER',
      demo: true,
      scope: 'openid profile billing:read',
    } as any);
    expect(user).toMatchObject({
      userId: DEMO_SUBSCRIBER,
      personId: 'did:key:z6MkAnaDemo',
      demo: true,
      roles: [],
      emailVerified: false,
      orgId: DEMO_ORG_ID,
      orgRole: 'owner',
      scopes: ['openid', 'profile', 'billing:read'],
    });
  });

  it('leaves a real token as it was', async () => {
    const user: any = await strategy.validate({ sub: 'did:key:z6MkReal', roles: ['admin'] } as any);
    expect(user.userId).toBe('did:key:z6MkReal');
    expect(user.demo).toBeUndefined();
    expect(user.roles).toEqual(['admin']);
  });

  it('sees the tenant once and may move none of its plans', () => {
    const caller = { userId: DEMO_SUBSCRIBER, orgId: DEMO_ORG_ID, orgRole: 'owner', demo: true };
    expect(visibleSubscribers(caller)).toEqual([DEMO_SUBSCRIBER]);
    expect(mayManage(caller, DEMO_SUBSCRIBER)).toBe(false);
  });
});

describe('DemoReadOnlyInterceptor', () => {
  const run = (req: any) => {
    const handle = jest.fn(() => of('handled'));
    const ctx: any = { getType: () => 'http', switchToHttp: () => ({ getRequest: () => req }) };
    let error: any = null;
    try {
      new DemoReadOnlyInterceptor().intercept(ctx, { handle });
    } catch (e) {
      error = e;
    }
    return { handle, error };
  };

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('refuses a demo %s before the handler', (method) => {
    const { handle, error } = run({ method, user: { userId: DEMO_SUBSCRIBER, demo: true } });
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.getResponse().error).toBe('demo_read_only');
    expect(handle).not.toHaveBeenCalled();
  });

  it('lets a demo session read', () => {
    expect(run({ method: 'GET', user: { demo: true } }).handle).toHaveBeenCalled();
  });

  it('refuses a write on an unguarded route when the cookie is a demo token', () => {
    const req = { method: 'POST', cookies: { access_token: token({ sub: 'x', demo: true }) } };
    expect(isDemoRequest(req)).toBe(true);
    expect(run(req).error).toBeInstanceOf(ForbiddenException);
    const bearer = {
      method: 'POST',
      headers: { authorization: `Bearer ${token({ org_id: DEMO_ORG_ID })}` },
    };
    expect(run(bearer).error).toBeInstanceOf(ForbiddenException);
  });

  it('lets everyone else write', () => {
    expect(run({ method: 'POST', user: { userId: 'did:key:z6MkReal' } }).handle).toHaveBeenCalled();
    expect(
      run({ method: 'POST', cookies: { access_token: 'not-a-jwt' } }).handle,
    ).toHaveBeenCalled();
  });
});

describe('the demo tenant counts in no total', () => {
  it('leaves it out of the admin dashboard figures and the triage queues', async () => {
    const sum = { _sum: { amount: null, totalAmount: null } };
    const prisma: any = {
      order: {
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue(sum),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      subscription: { count: jest.fn().mockResolvedValue(0) },
      affiliate: { count: jest.fn().mockResolvedValue(0) },
      affiliateCommission: {
        aggregate: jest.fn().mockResolvedValue(sum),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      affiliatePayout: {
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue(sum),
      },
      riskAssessment: { count: jest.fn().mockResolvedValue(0) },
      webhookEvent: { count: jest.fn().mockResolvedValue(0) },
      outboxEvent: { count: jest.fn().mockResolvedValue(0) },
    };
    const stats = new AdminStatsService(prisma);
    await stats.getStats();
    await stats.getTriage();
    const calls = [
      ...prisma.order.count.mock.calls,
      ...prisma.order.aggregate.mock.calls,
      ...prisma.order.groupBy.mock.calls,
      ...prisma.subscription.count.mock.calls,
    ];
    expect(calls.length).toBe(7);
    for (const [args] of calls) expect(args.where.userId).toEqual({ not: DEMO_SUBSCRIBER });
  });
});

describe('nothing runs for the demo tenant', () => {
  it('the expirer never ends its plans', async () => {
    const prisma: any = { subscription: { findMany: jest.fn().mockResolvedValue([]) } };
    const lock: any = { runWithLock: (_k: string, _t: number, fn: () => Promise<void>) => fn() };
    await new SubscriptionExpirerScheduler(prisma, {} as any, lock).sweep();
    expect(prisma.subscription.findMany.mock.calls[0][0].where.userId).toEqual({
      not: DEMO_SUBSCRIBER,
    });
  });

  it('renewals open no order or link for it', async () => {
    const prisma: any = { subscription: { findMany: jest.fn().mockResolvedValue([]) } };
    const service = new SubscriptionRenewalsService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { get: () => undefined } as any,
    );
    await service.runSweep(new Date());
    expect(prisma.subscription.findMany.mock.calls[0][0].where.userId).toEqual({
      not: DEMO_SUBSCRIBER,
    });
  });

  it('no outbox event, so no webhook, is ever about it', async () => {
    const prisma: any = { outboxEvent: { create: jest.fn() } };
    const outbox = new OutboxService(prisma);
    await outbox.emit(
      'billing.payment.succeeded',
      { user_id: DEMO_SUBSCRIBER },
      { serviceId: 's' },
    );
    await outbox.emit(
      'billing.subscription.ended',
      { userId: DEMO_SUBSCRIBER },
      { serviceId: 's' },
    );
    expect(prisma.outboxEvent.create).not.toHaveBeenCalled();
    await outbox.emit(
      'billing.payment.succeeded',
      { user_id: 'did:key:z6MkReal' },
      { serviceId: 's' },
    );
    expect(prisma.outboxEvent.create).toHaveBeenCalledTimes(1);
  });

  it('no notice, mail or outreach is ever for it', async () => {
    const prisma: any = {
      notification: { create: jest.fn() },
      outreachMessage: { create: jest.fn() },
    };
    const queue: any = { add: jest.fn() };
    const contacts: any = { getContact: jest.fn(), touch: jest.fn() };
    const notifications = new NotificationsService(
      prisma,
      { get: () => undefined } as any,
      contacts,
      queue,
    );
    await expect(
      notifications.notify({
        userId: DEMO_SUBSCRIBER,
        type: 'billing' as any,
        channels: ['in_app', 'email'],
        title: 't',
        body: 'b',
      }),
    ).resolves.toEqual([]);
    const outreach = new OutreachService(
      prisma,
      { get: () => 'true' } as any,
      notifications,
      contacts,
      {} as any,
      {} as any,
      queue,
    );
    await expect(
      outreach.enqueue({ trigger: 'dunning', triggerKey: 'k', userId: DEMO_SUBSCRIBER }),
    ).resolves.toBe(false);
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(prisma.outreachMessage.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
    expect(contacts.getContact).not.toHaveBeenCalled();
  });

  it('a demo session leaves no contact to write to', () => {
    const contacts: any = { touch: jest.fn() };
    const ctx: any = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { userId: DEMO_SUBSCRIBER, demo: true, email: 'ana@demo.invalid' },
          headers: {},
        }),
      }),
    };
    new ContactCaptureInterceptor(contacts).intercept(ctx, { handle: () => of(null) });
    expect(contacts.touch).not.toHaveBeenCalled();
  });

  it('it never enters the funnel', async () => {
    const prisma: any = { funnelEvent: { create: jest.fn() } };
    await new FunnelService(prisma, {} as any).track({
      userId: DEMO_SUBSCRIBER,
      eventType: 'x',
      stage: 'y',
    });
    expect(prisma.funnelEvent.create).not.toHaveBeenCalled();
  });

  it('its credits are neither granted, charged, reset nor adjusted', async () => {
    const prisma: any = {
      $transaction: jest.fn(),
      creditBalance: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    };
    const credits = new CreditsService(prisma);
    const userId = DEMO_SUBSCRIBER;
    await expect(credits.grant({ userId, amount: 100 })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(credits.consume({ userId, amount: 1 })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      credits.resetForPeriod({ userId, newBalance: 1, resetsAt: new Date() }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(credits.revokeGrant({ userId, amount: 1, orderId: 'o' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      credits.adminAdjust({ userId, amount: 1, description: 'd' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.creditBalance.findUnique).not.toHaveBeenCalled();
  });
});
