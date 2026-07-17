/**
 * AI eval harness: replays golden dialogs against the real Anthropic API
 * with a fixture-backed Prisma stub. Never part of `npm test` — run with
 * `npm run eval` (requires RUN_AI_EVALS=1 and ANTHROPIC_API_KEY).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { AssistantService } from '../../src/assistant/assistant.service';
import { ActionRegistryService } from '../../src/assistant/actions/action-registry';
import { AssistantActionsService } from '../../src/assistant/actions/assistant-actions.service';
import { AnthropicConfigService } from '../../src/common/anthropic/anthropic-config.service';

const goldenDialogs = JSON.parse(
  readFileSync(join(__dirname, 'golden', 'dialogs.json'), 'utf8'),
);

const runEvals =
  process.env.RUN_AI_EVALS === '1' && !!process.env.ANTHROPIC_API_KEY;
const describeEval = runEvals ? describe : describe.skip;

// ─── Fixtures ─────────────────────────────────────────────────

const SUB_ID = '11111111-1111-4111-8111-111111111111';
const PRICE_ID = '22222222-2222-4222-8222-222222222222';
const ORDER_ID = '33333333-3333-4333-8333-333333333333';

const product = {
  id: 'aaaa1111-0000-4000-8000-000000000001',
  code: 'pro-plan',
  name: 'Pro Plan',
  type: 'subscription',
  serviceId: 'bbbb1111-0000-4000-8000-000000000001',
  isActive: true,
  metadata: { description: 'Monthly AI credits for power users', creditsPerPeriod: 1000 },
  service: { id: 'bbbb1111-0000-4000-8000-000000000001', code: 'studio', name: 'INITE Studio' },
  prices: [
    { id: PRICE_ID, code: 'pro-monthly', amount: 29, currency: 'USD', interval: 'month', isActive: true, productId: 'aaaa1111-0000-4000-8000-000000000001' },
  ],
};

const subscription = {
  id: SUB_ID,
  userId: 'eval-user',
  priceId: PRICE_ID,
  status: 'active',
  cancelAtPeriodEnd: false,
  currentPeriodStart: new Date('2026-07-01T00:00:00Z'),
  currentPeriodEnd: new Date('2026-08-01T00:00:00Z'),
  price: { ...product.prices[0], product },
};

const paidOrder = {
  id: ORDER_ID,
  userId: 'other-user',
  status: 'paid',
  amount: 29,
  currency: 'USD',
  mode: 'SUBSCRIPTION',
  createdAt: new Date('2026-07-10T00:00:00Z'),
  price: { ...product.prices[0], product },
};

// ─── Stubs ────────────────────────────────────────────────────

function buildPrismaStub(recordedActions: any[]) {
  let actionSeq = 0;
  return {
    conversation: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    order: {
      findMany: jest.fn().mockResolvedValue([paidOrder]),
      findUnique: jest.fn().mockResolvedValue(paidOrder),
      count: jest.fn().mockResolvedValue(12),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 1234 } }),
    },
    subscription: {
      findMany: jest.fn().mockResolvedValue([subscription]),
      findFirst: jest
        .fn()
        .mockImplementation(async (args: any) =>
          args?.where?.id === SUB_ID ? subscription : null,
        ),
      count: jest.fn().mockResolvedValue(5),
    },
    entitlement: { findMany: jest.fn().mockResolvedValue([]) },
    product: { findMany: jest.fn().mockResolvedValue([product]) },
    affiliate: {
      findFirst: jest.fn().mockResolvedValue({ id: 'aff-1', userId: 'eval-user', code: 'EVAL' }),
      count: jest.fn().mockResolvedValue(3),
    },
    referral: { count: jest.fn().mockResolvedValue(4) },
    affiliateCommission: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 120 } }),
    },
    service: { findMany: jest.fn().mockResolvedValue([product.service]) },
    promoCode: { findMany: jest.fn().mockResolvedValue([]) },
    funnelEvent: { findMany: jest.fn().mockResolvedValue([]) },
    assistantToolCall: { create: jest.fn().mockResolvedValue({}) },
    assistantAction: {
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        const row = {
          id: `action-${++actionSeq}`,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        recordedActions.push(row);
        return row;
      }),
      findUnique: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as any;
}

function buildConversationsStub() {
  const messages: Array<{ role: string; content: string }> = [];
  let messageSeq = 0;
  return {
    messages,
    getOrCreate: jest.fn().mockResolvedValue({ id: 'conv-eval', userId: 'eval-user' }),
    addMessage: jest.fn().mockImplementation(async (_id: string, role: string, content: string) => {
      messages.push({ role, content });
      return { id: `msg-${++messageSeq}`, role, content };
    }),
    getMessages: jest.fn().mockImplementation(async () => [...messages]),
  } as any;
}

interface TurnResult {
  text: string;
  toolNames: string[];
  actionParts: any[];
}

async function runTurn(
  service: AssistantService,
  userId: string,
  message: string,
  roles: string[],
): Promise<TurnResult> {
  let raw = '';
  for await (const chunk of service.chat(userId, message, undefined, roles)) {
    raw += chunk;
  }
  const parts = raw
    .split('\n\n')
    .map((block) => block.replace(/^data: /, '').trim())
    .filter((line) => line && line !== '[DONE]')
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean) as any[];

  return {
    text: parts
      .filter((p) => p.type === 'text-delta')
      .map((p) => p.delta)
      .join(''),
    toolNames: parts
      .filter((p) => p.type === 'tool-input-available')
      .map((p) => p.toolName),
    actionParts: parts.filter((p) => p.type === 'data-action').map((p) => p.data),
  };
}

const hasCyrillic = (s: string) => /[а-яё]/i.test(s);

// ─── Harness ──────────────────────────────────────────────────

describeEval('Assistant golden-dialog evals', () => {
  for (const dialog of goldenDialogs as any[]) {
    it(dialog.name, async () => {
      const recordedActions: any[] = [];
      const prisma = buildPrismaStub(recordedActions);
      const conversations = buildConversationsStub();
      const configService = { get: (key: string) => process.env[key] } as any;
      const anthropicConfig = new AnthropicConfigService(configService);
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      const funnelService = {
        getFunnelMetrics: jest.fn().mockResolvedValue({ stages: [], conversionRate: 0.42 }),
        getAbandonedCheckouts: jest.fn().mockResolvedValue({ items: [paidOrder], total: 1 }),
      } as any;
      const promoCodesService = {
        validatePromoCode: jest.fn().mockResolvedValue({ isValid: false, reason: 'Promo code not found' }),
        create: jest.fn(),
      } as any;
      const productSearchService = {
        semanticSearchProducts: jest.fn().mockResolvedValue([{ ...product, score: 0.91 }]),
        fuzzySearchOrders: jest.fn().mockResolvedValue({ items: [paidOrder], total: 1, page: 1, limit: 20 }),
      } as any;
      const recommendationsService = {
        getNextBestOffers: jest.fn().mockResolvedValue([
          {
            productId: product.id,
            code: product.code,
            name: product.name,
            serviceName: product.service.name,
            priceCode: 'pro-monthly',
            amount: '29',
            currency: 'USD',
            interval: 'month',
            reason: 'upgrade',
            score: 50,
          },
        ]),
      } as any;
      const subscriptionsService = { cancelSubscription: jest.fn(), resumeSubscription: jest.fn() } as any;
      const creditsService = { adminAdjust: jest.fn() } as any;
      const adminOrdersService = { refundOrder: jest.fn() } as any;

      const actionRegistry = new ActionRegistryService(
        prisma,
        subscriptionsService,
        promoCodesService,
        creditsService,
        adminOrdersService,
      );
      const actionsService = new AssistantActionsService(
        prisma,
        actionRegistry,
        anthropicConfig,
        conversations,
      );

      const service = new AssistantService(
        prisma,
        conversations,
        funnelService,
        promoCodesService,
        productSearchService,
        recommendationsService,
        actionRegistry,
        actionsService,
        anthropicConfig,
        client,
      );

      for (const turn of dialog.turns) {
        const result = await runTurn(
          service,
          'eval-user',
          turn.user,
          dialog.roles ?? [],
        );
        const expectSpec = turn.expect ?? {};

        for (const tool of expectSpec.toolsCalledIncludes ?? []) {
          expect(result.toolNames).toContain(tool);
        }
        if (expectSpec.toolsCalledAnyOf) {
          expect(
            result.toolNames.some((name: string) =>
              expectSpec.toolsCalledAnyOf.includes(name),
            ),
          ).toBe(true);
        }
        for (const tool of expectSpec.toolsCalledExcludes ?? []) {
          expect(result.toolNames).not.toContain(tool);
        }
        if (expectSpec.actionProposed) {
          const proposed = [
            ...recordedActions.map((a) => a.toolName),
            ...result.actionParts.map((a) => a.toolName),
          ];
          expect(proposed).toContain(expectSpec.actionProposed);
        }
        if (expectSpec.noExecutedActions) {
          // Structural guarantee: chat has no confirm path; every recorded
          // proposal must still be pending and domain writes untouched.
          expect(recordedActions.every((a) => a.status === 'pending')).toBe(true);
          expect(subscriptionsService.cancelSubscription).not.toHaveBeenCalled();
          expect(adminOrdersService.refundOrder).not.toHaveBeenCalled();
          expect(creditsService.adminAdjust).not.toHaveBeenCalled();
        }
        if (expectSpec.language === 'ru') {
          expect(hasCyrillic(result.text)).toBe(true);
        }
        if (expectSpec.language === 'en') {
          expect(hasCyrillic(result.text)).toBe(false);
        }
        if (expectSpec.responseMatches) {
          expect(result.text).toMatch(new RegExp(expectSpec.responseMatches, 'i'));
        }
        if (expectSpec.mustNotMatch) {
          expect(result.text).not.toMatch(new RegExp(expectSpec.mustNotMatch, 'i'));
        }
      }
    });
  }
});

if (!runEvals) {
  // Keep jest happy when the suite is skipped entirely
  describe('Assistant evals (skipped)', () => {
    it('requires RUN_AI_EVALS=1 and ANTHROPIC_API_KEY', () => {
      expect(true).toBe(true);
    });
  });
}
