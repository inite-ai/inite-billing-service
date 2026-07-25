# INITE Billing Service

Payment-rail-agnostic billing gateway for the INITE platform: the single service for money, subscriptions, credits, and entitlements used by all product modules (club/events/education/health/shop/studio/estate). External modules authenticate service-to-service with `x-api-key` (`Service.apiKey`) via `JwtOrServiceGuard`; end users authenticate with JWTs issued by `auth.inite.ai` (JWKS).

## Stack

- Backend: NestJS 11 (Express 5), Prisma 5 (PostgreSQL, `multiSchema`, everything in schema `billing`), Redis + BullMQ, Swagger at `/api` (non-prod).
- Frontend: Next.js App Router in `frontend/` (React 19, Tailwind v4, `next-intl` EN/RU, axios). Runs on port 3001.
- AI: `@anthropic-ai/sdk` via the shared `AnthropicModule` (`src/common/anthropic/`) — inject `ANTHROPIC_CLIENT` + `AnthropicConfigService`; model/max_tokens/temperature come from env (`ANTHROPIC_MODEL`, default `claude-sonnet-4-5`). Never hardcode model IDs.

## Commands

```bash
npm run start:dev          # backend, port 3000
docker-compose up -d       # postgres (5433) + redis + service
npm test                   # unit + e2e; spins its own docker PG/Redis via scripts/test.sh
npm run test:ci            # jest only, assumes DB is up
npm run prisma:migrate     # create/apply dev migration
npm run prisma:generate    # regen client (also runs on postinstall)
cd frontend && npm run dev # frontend on 3001
```

All tests must pass before a task is considered done (see `.cursorrules`).

## Module map (`src/`)

- `payment-orchestrator/` — the state machine: `applyStateTransition(paymentIntent, status)` drives order/subscription/entitlement/credit side effects. All money movements go through it.
- `adapters/` — pluggable `PaymentRailAdapter` implementations: `one`, `stripe`, `lava`, `crypto` (multi-chain), `apple-iap`, `google-play`. Registered in `main.ts`. Provider credentials live in DB (`PaymentProvider.config`), not env.
- `checkout/` — 2-phase checkout: create session (order `created`) → pay session (transactional; promo application happens only inside `paySession`).
- `webhooks/` + `workers/webhook.processor.ts` — provider webhooks land in `WebhookEvent`, processed via BullMQ with amount/currency validation.
- `outbox/` + `workers/outbox.processor.ts` — transactional outbox: domain events (`billing.*`) broadcast by HTTP POST to every active `Service.webhookUrl` (SSRF-guarded).
- `credits/` — credit ledger: `CreditBalance` per (userId, serviceId?) + `CreditUsage` typed ledger. `consume` is atomic; external modules debit via `POST /v1/credits/consume`.
- `subscriptions/` + `workers/subscription-expirer.scheduler.ts` — lifecycle: trialing → active → past_due (grace = `Price.graceDays`) → ended.
- `funnel/` — `FunnelEvent` journey tracking (awareness → churned); 15-min cron detects abandoned checkouts and churning subscriptions; feeds admin analytics.
- `affiliates/` — multi-level referral program (`ReferralLevel` config, commissions, payouts).
- `assistant/` + `conversations/` — Claude-powered assistant: SSE streaming chat with a tool-use loop, role-gated tools, history in `Conversation`/`ChatMessage`.
- `admin/` — admin REST (`/v1/admin/*`, guarded by `JwtAuthGuard + RolesGuard + @Roles('admin')`); keep new admin surfaces in separate controllers, not in the 700-line `AdminController`.
- `auth/` — JWT strategy (HS256/RS256 via JWKS), guards: `JwtAuthGuard`, `ServiceAuthGuard`, `JwtOrServiceGuard`, `RolesGuard`. `RequestUser = { userId, roles[], email?, isService? }`.

## Domain concepts

- `Service` → `Product` → `Price` (interval, trialDays, graceDays); `Order` → `PaymentIntent` → `Subscription`/`Entitlement`/`Invoice`.
- Money is `Decimal(19,4)` — never float. Credits are integers on `CreditBalance`.
- Order statuses: `created → paid → completed / refunded / cancelled / failed`.
- Products carry `metadata.creditsPerPeriod` / `metadata.credits` — granted on payment, reset on renewal.

## Conventions

- DB: snake_case columns with `@map`, uuid PKs, `Timestamptz(6)`, every model has `@@schema("billing")`. Raw SQL must prefix tables with `billing.`.
- Prisma: use `$transaction` for multi-step writes; additive migrations only; backwards compatibility of public APIs is mandatory (external services depend on them).
- DTO validation with class-validator (global `ValidationPipe` is on).
- User-facing endpoints derive `userId` from the JWT (`@User()` decorator) — never from request params/body (IDOR).
- Follow `.cursorrules`: full implementations (no stubs/TODOs), no deleting files or simplifying logic without permission, SOLID/DRY/KISS.
- Frontend: pages are `'use client'`, i18n via `useTranslations` with keys in `frontend/messages/{en,ru}.json` (always add both), UI primitives in `frontend/components/ui/`.

## Testing patterns

- Unit specs in `test/*.spec.ts`, instantiate services directly with a hand-rolled mock Prisma; transaction mock: `$transaction: jest.fn((fn) => fn(mockTx))`.
- E2E specs in `test/*.e2e-spec.ts` use `test/test-app.module.ts` + `MockJwtAuthGuard` (`test/mocks/auth.mock.ts`, static `testUserId`/`testUserRoles`).
- `scripts/test.sh` runs docker PG (5433) / Redis (6381), migrates, runs jest, tears down.
- AI evals (golden dialogs) live in `test/eval/`, run explicitly with `npm run eval` (`RUN_AI_EVALS=1`) — never part of `npm test`.

## Env

See `env.example`. Key groups: `DATABASE_URL`, `REDIS_URL`, JWT (`JWT_SECRET`/`JWT_PUBLIC_KEY`), Anthropic (`ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`), feature kill-switches (notifications/outreach/risk/embeddings are all off by default and enabled per-env).
