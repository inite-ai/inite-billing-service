# Contributing to INITE Billing Service

Thanks for opening this file — that's already most of the battle. This is a
production billing gateway, not a hobby project. For a payments service the
bar is higher than usual: a subtle bug here loses real money or grants access
that wasn't paid for. The standard for changes is "would I sign off on this
PR if I'd never met you, knowing it moves real users' money?" Here's what
that means concretely.

## Before you start

- **New here?** Browse [`good first issue`](../../issues?q=is%3Aopen+label%3A%22good+first+issue%22)
  and skim the [Code of Conduct](CODE_OF_CONDUCT.md). PRs of any size are welcome.
- **Read [CLAUDE.md](CLAUDE.md) and [SECURITY.md](SECURITY.md)** — the module
  map, domain concepts, and the security ledger answer most "why is it done
  this way" questions.
- **Skim the migrations** in `prisma/migrations/`. Numbered, append-only;
  every schema change lands as a new directory. They're a diary of what shipped.
- **Read the recent commit log.** Commit messages explain the *why* — they're
  the closest thing this repo has to ADRs.

## Setting up locally

```bash
git clone git@github.com:inite-ai/inite-billing-service.git
cd inite-billing-service
npm install

# Bring up Postgres (pgvector) + Redis
docker compose up -d postgres redis

# Copy + fill env (ANTHROPIC_API_KEY needed for the assistant)
cp env.example .env
$EDITOR .env

# Apply schema, then run
npm run prisma:migrate
npm run start:dev

# Frontend (separate terminal)
cd frontend && npm install && npm run dev
```

Node 22+ is expected. If something breaks at setup, **file an issue** — that
usually means the onboarding docs are wrong. Don't suffer in silence.

## The hard bars for a PR

### 1. Tests pass

```bash
npm test        # spins its own dockerized PG/Redis via scripts/test.sh
npm run eval    # AI golden-dialog evals (optional; needs ANTHROPIC_API_KEY)
```

Touching checkout, webhook processing, credits, refunds, subscriptions, or
the payment-orchestrator state machine? Add a test that exercises the
**failure/abuse** property, not just the happy path — e.g. "a webhook with a
smaller amount than the order fails the payment", "a double credit consume
under concurrency charges once", "a non-admin cannot confirm an admin-scoped
assistant action".

### 2. Money is exact

Money is `Decimal(19,4)`; credits are integers. Never floats, never
`parseFloat` on amounts that feed a write. Comparisons and arithmetic on
amounts happen in the database or via Decimal-safe code paths.

### 3. Public contracts are backwards compatible

External INITE modules call this service machine-to-machine
(`/v1/credits/consume`, checkout, entitlements). Response shapes may grow
(supersets), never shrink or change semantics. New request fields are
optional. Breaking changes need a `/v2` route and a migration story.

### 4. Migrations are append-only

`prisma/migrations/NNNN_description/` in numeric order. **Never edit a
shipped migration** — once applied, Prisma records it and silently skips the
file on other environments; your edit becomes drift.

### 5. No new dependencies without justification

Say why in the PR description. Be extra wary of payment, crypto and
templating libraries. Prefer plain `fetch` over SDK dependencies for simple
HTTP APIs (see `EmailService`, `EmbeddingsService`).

### 6. AI surfaces stay guarded

- LLM-triggered writes go through the action-confirmation layer
  (`src/assistant/actions/`) — never call a domain service directly from a
  tool handler.
- `userId` always comes from the JWT context, never from LLM parameters.
- No PII in prompts (see `OutreachGeneratorService`).
- New assistant behaviors get a golden dialog in `test/eval/golden/`.

### 7. No secrets

`gitleaks` runs in CI (`.gitleaks.toml`). Never commit keys, even in tests —
use obvious placeholders.

## Conventions

- Conventional Commit PR titles (`feat: ...`, `fix: ...`) — squash-merge uses
  the title, and release-please parses it for versioning.
- DB: snake_case columns with `@map`, uuid PKs, `Timestamptz(6)`,
  `@@schema("billing")`; raw SQL prefixes tables with `billing.`.
- Feature flags default **off** (`OUTREACH_ENABLED`, `RISK_BLOCKING_ENABLED`,
  `EMBEDDINGS_ENABLED`, ...) — new subsystems ship dark.
- i18n: every user-facing string lands in both `frontend/messages/en.json`
  and `ru.json`.

## Releases

`release-please` maintains the version and CHANGELOG from Conventional
Commits; a release cut builds the versioned Docker image automatically.
