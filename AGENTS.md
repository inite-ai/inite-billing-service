# AGENTS.md — working in inite-billing-service

The instructions for any AI coding agent (Claude Code, Cursor, Codex, Copilot,
Gemini CLI, Windsurf…) and the humans driving one. Everything here is checked
against the code and CI; if you find something untrue, fixing this file is a
welcome PR.

## What this is

A self-hosted, payment-rail-agnostic billing service: catalog, checkout,
subscriptions, a credit ledger, entitlements, affiliates, the INITE wallet and
x402 — behind one payment state machine, with each payment provider a
pluggable adapter. NestJS 11 + Prisma 5 (Postgres + pgvector, schema
`billing`) + Redis/BullMQ, a Next.js UI in `frontend/`, an npm MCP bridge in
`mcp/`.

It is one of the **INITE Triad**: INITE Auth issues the tokens, Billing and
Brain verify them. The rules between them are the Triad contract:
https://github.com/inite-ai/inite-triad/blob/main/docs/compatibility.md

## Ground rules (non-negotiable)

1. **Never edit an applied migration.** Schema changes are a new directory in
   `prisma/migrations/` (Prisma's `YYYYMMDDHHMMSS_name`). Prisma skips files it
   has already recorded, so an edit becomes silent drift between environments.
2. **Money is exact.** Amounts are `Decimal(19,4)`, credits are integers. No
   floats, no `parseFloat`/`Number()` on an amount that feeds a write.
3. **Every movement of money goes through the payment orchestrator**
   (`applyStateTransition`). No code path marks an order paid, grants credits
   or entitlements, or moves a wallet balance on its own.
4. **Don't weaken a check that protects money or identity**: webhook
   signature and amount/currency validation, `iss`/`aud` checks, role guards,
   tenant (`serviceId`) scoping, the SSRF guard on outbound webhooks,
   idempotency keys. Fail closed.
5. **`userId` comes from the verified token** (`@User()`), never from a
   request body, query or LLM tool argument — that is an IDOR.
6. **Public contracts stay backwards compatible.** Other INITE modules call
   `/v1/*` machine-to-machine. Responses may grow, never shrink or change
   meaning; new request fields are optional; a break needs a `/v2` route.
   Token claim handling follows the Triad contract — don't change it here.
7. **No secrets, no PII in logs, prompts or the repo.** Provider credentials
   live in the DB (`PaymentProvider.config`), private keys are sealed with
   `KEY_SEAL_SECRET`. `gitleaks` runs in CI; use obvious placeholders in tests.
8. **Gates green before you call it done** — all of [Commands](#commands).
   Never skip, `.only`, or loosen a coverage threshold to get there.
9. **Full implementations.** No stubs, placeholder TODOs, or quietly dropped
   fields/branches; don't delete files or simplify existing logic unless the
   task asks for it.
10. **New dependencies need a reason in the PR**, extra scrutiny for payment,
    crypto and templating libraries. Prefer plain `fetch` for simple HTTP APIs.

## Zones

| Path | What lives there | Zone |
|---|---|---|
| `prisma/schema.prisma`, `prisma/migrations/` | Schema; raw-SQL partial unique indexes that keep money correct | **red** |
| `src/payment-orchestrator/` | The order/payment state machine and its side effects | **red** |
| `src/adapters/`, `src/common/connectors/`, `src/common/interfaces/` | Payment-rail adapters, webhook signature verification | **red** |
| `src/webhooks/`, `src/workers/webhook*.ts`, `src/workers/reconcile-amount.ts` | Provider webhook intake, processing, amount reconciliation | **red** |
| `src/wallet/` (treasury, payouts, agent wallets, `x402-client.ts`), `src/common/key-seal.ts` | Wallet balances, treasury payouts, sealed private keys | **red** |
| `src/auth/` (`token-contract.ts`, strategies, guards) | Token verification — governed by the Triad contract | **red** |
| `src/checkout/`, `src/credits/`, `src/subscriptions/`, `src/entitlements/`, `src/affiliates/`, `src/crypto/`, `src/workers/` (other), `src/outbox/` | Money-adjacent flows | yellow |
| `src/mcp/`, `src/assistant/` (incl. `actions/`), `src/outreach/`, `src/risk/` | Agent/AI surfaces with role gates | yellow |
| `src/admin/`, `src/catalog/`, `src/orders/`, `src/notifications/`, `src/insights/`, `src/funnel/`, `src/recommendations/`, `src/rag/` | Admin REST, catalog, read models | yellow |
| `frontend/app/**` (incl. `admin/`), `frontend/components/`, `frontend/messages/` | UI pages, components, translations | green (yellow for `callback/`, `checkout/`, `lib/pkce.ts`, `lib/oauth-client.ts`) |
| `mcp/` | Stdio MCP bridge published as `@inite/billing-mcp` | yellow |
| `docs/`, `README*.md`, `test/` additions, `.github/ISSUE_TEMPLATE/` | Docs, new tests | green |
| `.github/workflows/`, `Dockerfile*`, `docker-compose*.yml` | CI, release, deploy | yellow |

- **green** — just do it, with tests where there is behaviour.
- **yellow** — needs tests (for money paths: the failure/abuse property, not
  only the happy path) and a "Zone: yellow" note in the PR explaining risk.
- **red** — propose first: open a *Product idea* issue with the spec; a
  maintainer (`@Mikefluff`, see `.github/CODEOWNERS`) approves the design
  before code. Link that issue in the PR.

## Setup

**One click:** open the repo in GitHub Codespaces (Code → Codespaces → Create)
or VS Code "Reopen in Container". `.devcontainer/` gives Node 22, Postgres
(pgvector) on `localhost:5433`, Redis on `localhost:6380`, all three
`npm ci`s, a `.env` with generated dev secrets, and migrations applied to the
dev DB (`inite_billing`) and the test DB (`inite_billing_test`). Ports 3000
(API) and 3001 (UI) are forwarded.

**Local:** Node ≥ 22 and Docker.

```bash
npm install                                   # postinstall runs prisma generate
npm --prefix mcp ci && (cd frontend && npm ci)
cp env.example .env                           # set JWT_SECRET; KEY_SEAL_SECRET=$(openssl rand -base64 32)
docker compose up -d postgres redis           # PG (pgvector) :5433, Redis :6380
npm run prisma:migrate:deploy                 # apply committed migrations
npm run db:seed                               # optional demo catalog
```

Payment-provider credentials are not env vars — add them in the admin UI.
Swagger is at `http://localhost:3000/api` outside production.

## Commands

CI is `.github/workflows/ci.yml` (jobs `build-test`, `frontend`, `docker`);
these are its exact steps. **Done = every one of these green.**

| What | Command |
|---|---|
| Install | `npm ci` · `npm --prefix mcp ci` · `cd frontend && npm ci` |
| Dev server | `npm run start:dev` (API :3000) · `cd frontend && npm run dev` (UI :3001) |
| Lint + format (backend) | `npx eslint "src/**/*.ts" "test/**/*.ts"` — prettier runs inside eslint; `npm run lint` is the same with `--fix` and also covers `mcp/src` |
| Format (write) | `npm run format` |
| Typecheck + build (backend) | `npx nest build` |
| MCP bridge | `npm --prefix mcp run build` (`npm --prefix mcp run typecheck`) |
| Unit tests | `npm run test:ci -- --coverage` (coverage floors in `package.json` are enforced) |
| One test file | `npx jest test/promo-release.spec.ts` |
| E2E | `npm run test:e2e` (one file: `npm run test:e2e -- checkout.e2e-spec.ts`) |
| Everything with throwaway DBs | `npm test` (`scripts/test.sh`: docker PG :5433 + Redis :6381, migrate, unit + e2e) |
| Frontend | `cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint && npm test && npm run build` |
| Audit | `npm audit --audit-level=high` · `cd frontend && npm audit --audit-level=high --omit=dev` |
| AI evals (opt-in, costs tokens) | `npm run eval` (needs `ANTHROPIC_API_KEY`; never part of CI) |

Notes:
- Jest always points at the **test** DB: `test/setup-e2e.ts` sets
  `DATABASE_URL` from `TEST_DATABASE_URL` (default
  `localhost:5433/inite_billing_test`) and `REDIS_URL` from `TEST_REDIS_URL`
  (default `localhost:6381`). The test DB must be migrated:
  `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/inite_billing_test?schema=billing npx prisma migrate deploy`.
- Without a database, 84 of 95 unit suites still pass; the DB-backed ones
  (treasury, wallet*, x402, key-seal, settlement, referral-levels,
  item-entitlements…) and every e2e suite need Postgres. CI runs them all.
- `npm test` and the dev compose both want port 5433 (issue #239); stop the
  compose Postgres first or use the `TEST_*` overrides.
- The husky pre-commit hook runs backend lint + build and frontend lint, test
  and build.
- CI also runs: gitleaks (`security.yml`), CodeQL, dependency review,
  Conventional-Commit PR title (`pr-title.yml`), devcontainer build
  (`devcontainer.yml`).

## Architecture map

```
request → main.ts (helmet, ValidationPipe) + global ThrottlerGuard (app.module.ts)
        → controller (src/<module>/*.controller.ts, routes under /v1/…)
        → guard: JwtAuthGuard (user JWT) | ServiceAuthGuard (x-api-key) | JwtOrServiceGuard | RolesGuard + @Roles('admin')
        → service → PrismaService ($transaction for multi-step writes)
        → PaymentOrchestratorService.applyStateTransition → order/subscription/entitlement/credit side effects
        → OutboxService (billing.* events) → workers/outbox.processor → POST to each Service.webhookUrl
```

- `payment-orchestrator/` — the state machine. Order statuses:
  `created → open → paid`, terminal `failed` / `refunded` / `expired`.
- `adapters/<rail>/` — `one`, `stripe`, `lava`, `hodle`, `crypto`
  (TRON/TON/Solana/EVM stablecoins), `apple-iap`, `google-play`. Each
  implements `PaymentRailAdapter` and self-registers with
  `@RegisterConnector(RAILS.X)`; the `ConnectorRegistry` discovers it.
- `webhooks/` + `workers/webhook.processor.ts` — provider webhooks land in
  `WebhookEvent`, are processed via BullMQ with amount/currency validation.
- `checkout/` — 2-phase: create session (order `created`) → `paySession`
  (transactional; promo codes apply only there). Also x402.
- `credits/` — `CreditBalance` per (userId, serviceId?) + `CreditUsage`
  ledger; `consume` is atomic (`POST /v1/credits/consume`).
- `subscriptions/` + `workers/subscription-expirer.scheduler.ts` —
  trialing → active → past_due (grace `Price.graceDays`) → ended.
- `wallet/` — INITE wallet (USDC on Base under a passkey), agent wallets and
  limits, pay-from-wallet, treasury and payouts. See `docs/wallet.md`.
- `crypto/` + `workers/crypto-watcher.scheduler.ts` — unique-amount crypto
  invoices, chain watchers, FX rates fixed on the invoice.
- `mcp/` (in `src/`) — MCP server at `/mcp` (tools in
  `mcp-tools.service.ts`); `/mcp/wallet` lives in `wallet/`. The `mcp/`
  package at the root is the stdio bridge to it.
- `assistant/` (+ `actions/`), `conversations/`, `outreach/`, `insights/`,
  `rag/`, `recommendations/`, `risk/`, `funnel/` — the AI surfaces. Claude is
  reached only through `src/common/anthropic/` (`ANTHROPIC_CLIENT`,
  `AnthropicConfigService`; model from `ANTHROPIC_MODEL`) — never hardcode a
  model id.
- `admin/` — `/v1/admin/*`; put new admin surfaces in their own controller,
  not the 700-line `AdminController`.

Where to add things:
- **Endpoint** — controller + DTO (class-validator, Swagger `@Api*`
  decorators) in the module, register in its `*.module.ts`, test in `test/`.
- **Payment rail** — new `src/adapters/<rail>/` (red zone; see
  `docs/operations.md#adding-a-payment-rail`).
- **MCP tool** — an entry in `McpToolsService.list()` (zod schema,
  `readOnly`, `serviceOnly`); tests in `test/mcp-tools.spec.ts`.
- **Migration** — edit `prisma/schema.prisma`, then
  `npx prisma migrate dev --name <what>` against a dev DB (devcontainer or
  compose); commit the new directory; red zone.
- **UI page** — `frontend/app/<route>/page.tsx` (`'use client'`), strings in
  all four `frontend/messages/{en,ru,pt,es}.json`, primitives from
  `frontend/components/ui/`, API calls through the axios instance in
  `frontend/lib/api.ts`. An admin page (`frontend/app/admin/<route>/`) also
  needs its entry in `frontend/components/layout/Sidebar.tsx`.

Deeper: `docs/architecture.md`, `docs/api.md`, `docs/ai-features.md`,
`docs/operations.md`, `docs/x402.md`, `docs/wallet.md`, `SECURITY.md`.

## From idea to PR

Run this loop with the human; explain each step in plain language.

1. **Restate** the idea in your own words; ask at most 3 clarifying questions.
2. **Locate** it: which modules, which [zone](#zones). Search open issues
   (`gh issue list --search "<words>"`) for an existing one.
3. **Spec** (short): problem · user-visible behaviour · API/UI change · data
   change · risks (money, auth, tenancy, compatibility) · out of scope.
   **Red zone → STOP.** File it as a *Product idea* issue
   (`.github/ISSUE_TEMPLATE/product-idea.yml`, paste the spec) and wait for a
   maintainer's approval.
4. **Plan** small steps, each leaving the tree green.
5. **Implement with tests** — test first where practical; money paths need a
   failure/abuse test.
6. **Run every gate** in [Commands](#commands) that your change can affect;
   CI runs the rest.
7. **Docs**: update `docs/*.md`, `env.example`, Swagger decorators, the
   rendered docs (`frontend/app/docs/*/page.mdx`), and this file if you changed how things work.
8. **Commit** with Conventional Commits — release-please derives the version
   and `CHANGELOG.md` from them: `feat(scope): …`, `fix(scope): …`, `docs:`,
   `test:`, `refactor:`, `chore:`, `ci:`; `!` (`feat!:`) or a
   `BREAKING CHANGE:` footer for breaks.
9. **Open a PR** (`gh pr create`) with `.github/PULL_REQUEST_TEMPLATE.md`
   filled in — including a summary a non-engineer can follow. Don't merge;
   a maintainer does.

## Conventions

- **Branches**: `feat/…`, `fix/…`, `docs/…`, `chore/…`. PRs squash-merge, so
  the **PR title** must be a Conventional Commit (checked by `pr-title.yml`).
  Commit subjects in this repo describe the outcome:
  `fix(treasury): card top-up payouts exactly once`. Keep PRs to one concern.
- **TypeScript**: prettier (single quotes, trailing commas, width 100, 2
  spaces) enforced through eslint; `any` is allowed at Prisma/provider
  boundaries; `_`-prefixed names for unused args. Frontend has its own eslint
  config (`--max-warnings 0`).
- **Comments** explain *why* — the history or failure a line guards against —
  not what the code does. Match that density.
- **Errors**: Nest HTTP exceptions (`BadRequestException`,
  `NotFoundException`, `ForbiddenException`…) at the edge; fail closed.
- **Logging**: `new Logger(Service.name)`; never log tokens, keys, provider
  secrets or personal data (redact provider payloads).
- **DB**: snake_case columns via `@map`, uuid PKs, `Timestamptz(6)`, every
  model `@@schema("billing")`; raw SQL prefixes tables with `billing.`;
  `$transaction` for multi-step writes.
- **DTOs** validated with class-validator (global `ValidationPipe`).
- **Feature flags default off** (`OUTREACH_ENABLED`, `RISK_BLOCKING_ENABLED`,
  `EMBEDDINGS_ENABLED`, `NOTIFICATIONS_EMAIL_ENABLED`…): new subsystems ship
  dark; document new env vars in `env.example`.
- **AI surfaces**: LLM-triggered writes go through `src/assistant/actions/`
  (confirm before execute); no PII in prompts; new assistant behaviour gets a
  golden dialog in `test/eval/golden/dialogs.json`.

## Testing

- Backend specs live flat in `test/`: unit `*.spec.ts` (jest config in
  `package.json`), e2e `*.e2e-spec.ts` (`test/jest-e2e.json`, uses
  `test/test-app.module.ts` + `MockJwtAuthGuard` from `test/mocks/auth.mock.ts`).
  Name the file after the property: `webhook-claim-race.spec.ts`,
  `checkout-tenant-scope.spec.ts`.
- Unit pattern: construct the service directly with hand-rolled mocks; a
  transaction is `$transaction: jest.fn((fn) => fn(mockTx))`. Good example:
  `test/promo-release.spec.ts` (a doc comment says what broke, then one
  `it` per property). DB-backed example: `test/treasury.spec.ts`.
- Fixtures: `test/fixtures/`, cleanup helpers: `test/helpers/`.
- Frontend: vitest, `frontend/test/*.test.ts` (setup `frontend/test/setup.ts`).
- Coverage floors are per directory in `package.json` (highest on
  `payment-orchestrator/`, `workers/`, `webhooks/`); they ratchet up, never down.
- `test/README.md` / `test/FIX-PLAN.md` are stale (issue #234) — trust this file.

## When to ask a human

- Anything in a red zone, before writing code.
- A change to a public `/v1` response, an outbox event shape, or the MCP tool
  contract.
- A new dependency, a new env var that is required in production, or a
  coverage threshold that would have to move.
- Anything touching real provider credentials, keys, or production data.
- Tests that fail on `main` before your change, or a gate you cannot run.
- When the idea conflicts with a rule above — say so instead of working
  around it.

## Help

- Starter work: issues labelled
  [`good first issue`](https://github.com/inite-ai/inite-billing-service/issues?q=is%3Aopen+label%3A%22good+first+issue%22).
- Questions and ideas: GitHub issues (*Product idea* form for proposals).
- Humans: [CONTRIBUTING.md](CONTRIBUTING.md). Vulnerabilities: privately, per
  [SECURITY.md](SECURITY.md) — never in a public issue.
