<h1 align="center">INITE Billing Service</h1>

<p align="center">
  <b>Payment-rail-agnostic, AI-first billing gateway — subscriptions, metered credits, entitlements, affiliates.</b><br>
  One deployable service that is the single source of truth for money across the INITE ecosystem:<br>
  Stripe, crypto (ETH/SOL/TON/TRON), Apple/Google IAP and regional rails behind one state machine,<br>
  with an embedded Claude assistant, AI dunning/win-back outreach, and usage metering for AI products.
</p>

<p align="center">
  <a href="https://github.com/inite-ai/inite-billing-service/actions/workflows/ci.yml"><img src="https://github.com/inite-ai/inite-billing-service/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License: AGPL-3.0"></a>
  <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs welcome"></a>
  <img src="https://img.shields.io/badge/TypeScript-3178c6.svg" alt="TypeScript">
  <img src="https://img.shields.io/badge/NestJS-e0234e.svg" alt="NestJS">
  <img src="https://img.shields.io/badge/AI--first-Claude-8b5cf6.svg" alt="AI-first">
</p>

<p align="center">
  <a href="https://billing.inite.ai">Website</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="docs/architecture.md">Architecture</a> ·
  <a href="docs/api.md">API</a> ·
  <a href="docs/ai-features.md">AI features</a> ·
  <a href="docs/operations.md">Operations</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

---

## Why INITE Billing

Most billing stacks make you choose: a SaaS gateway that owns your money flow
(Stripe Billing, Chargebee) or a bare payments library that leaves
subscriptions, entitlements and dunning to you. INITE Billing is a single
self-hostable service that ships the **entire money lifecycle** — catalog,
checkout, subscriptions, credits, entitlements, affiliate program, retention
automation — behind one payment-agnostic state machine, with the payment
provider reduced to a pluggable adapter.

- **Rail-agnostic by design** — Stripe, ONE, Lava, Apple IAP, Google Play
  RTDN, and native multi-chain crypto (ETH/SOL/TON/TRON) implement one
  `PaymentRailAdapter` interface; the orchestrator state machine
  (`created → paid → completed/refunded`) doesn't know which rail paid.
- **AI-first, not AI-bolted-on** — an embedded Claude assistant with
  role-gated tools and a confirm-before-execute action layer; LLM-generated
  dunning / win-back / abandoned-checkout outreach; semantic catalog search
  (pgvector); next-best-offer recommendations; AI funnel insights for admins.
  See [docs/ai-features.md](docs/ai-features.md).
- **Built to meter AI products** — credits are not a flat bucket: a metered
  feature registry with per-model-tier rates (tokens/requests/generations),
  windowed quotas with soft-cap warnings, and a backwards-compatible
  service-to-service `consume` API.
- **Platform hub** — INITE modules (club/events/education/health/shop/studio/
  estate) call it machine-to-machine with per-service API keys; domain events
  fan out via a transactional outbox to per-service webhooks.
- **Complete revenue toolkit** — multi-level affiliate program with NET-15
  payouts, promo codes, conversion funnel tracking with churn detection,
  heuristic payment-risk scoring, full admin UI (22 pages) + user dashboard
  in Next.js, EN/RU localized.
- **Operable and audited** — append-only migrations, IDOR-hardened endpoints,
  webhook signature verification, SSRF-guarded outbox, idempotency at every
  boundary, secret scanning and CodeQL in CI. See [SECURITY.md](SECURITY.md).

## Quick start

```bash
git clone git@github.com:inite-ai/inite-billing-service.git
cd inite-billing-service
npm install

cp env.example .env           # fill in secrets (ANTHROPIC_API_KEY for the assistant)
docker compose up -d postgres redis

npm run prisma:migrate        # apply schema (pgvector image required)
npm run start:dev             # backend on :3000, Swagger at /api

cd frontend && npm install && npm run dev   # UI on :3001
```

Verify:

```bash
curl http://localhost:3000/health
open http://localhost:3000/api        # Swagger
```

Full walkthrough (test DB, docker profiles, troubleshooting):
[docs/getting-started.md](docs/getting-started.md).

## What ships in the box

| Surface | What you get |
|---|---|
| **Catalog & checkout** | Products/prices per service, 2-phase checkout (session → pay), promo codes, idempotency keys |
| **Payments** | 6 rail adapters, provider-credential storage in DB, webhook validation (amount/currency), BullMQ processing |
| **Subscriptions** | Trials, grace periods, renewal/expiry crons, lifecycle webhooks (`billing.subscription.*`) |
| **Credits & metering** | Ledger (grant/consume/reset/refund), metered feature registry, model-tier rates, windowed quotas, usage analytics |
| **Entitlements** | Access rights granted on payment, revoked on refund/expiry, queryable per user |
| **AI assistant** | Claude chat (AI SDK v6 streaming) with 17 tools, confirm-gated write actions, tool telemetry, 👍/👎 feedback, eval harness |
| **Retention automation** | Funnel event tracking, abandoned-checkout / dunning (day 0-2-5) / win-back / trial-ending outreach: LLM-personalized email + in-app, EN/RU |
| **Notifications** | Resend email (delivery webhooks, unsubscribe, suppression) + in-app notification center with preferences |
| **Affiliates** | Multi-level referral program, configurable commission levels, NET-15 payouts, payout providers |
| **Risk** | Velocity / outlier / failed-burst heuristics, monitor-only by default, admin review queue |
| **Admin UI** | 22 pages: funnel kanban + AI insights, outreach stats, metering, risk review, catalog/orders/subscriptions/credits CRUD |

## Documentation

| Doc | What's inside |
|---|---|
| [docs/getting-started.md](docs/getting-started.md) | Local setup, env variables, migrations, running tests |
| [docs/architecture.md](docs/architecture.md) | Module map, payment state machine, event flows, data model |
| [docs/api.md](docs/api.md) | Full REST surface, auth (JWT / service API keys), examples |
| [docs/ai-features.md](docs/ai-features.md) | Assistant, action layer, outreach, metering, RAG, risk, insights |
| [docs/operations.md](docs/operations.md) | Deploy, feature flags & rollout order, adding a payment rail |
| [SECURITY.md](SECURITY.md) | Threat ledger, known limitations, vulnerability reporting |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Hard bars for PRs, conventions, release flow |
| [CLAUDE.md](CLAUDE.md) | Repo map for AI coding agents |

## Contributing

PRs land on `main` only through pull requests — CI (`build-test`) is a
required check, titles follow Conventional Commits (release-please cuts
versions and the changelog from them). Read [CONTRIBUTING.md](CONTRIBUTING.md)
for the hard bars: tests for money paths, exact `Decimal` arithmetic,
backwards-compatible public contracts, append-only migrations.

## License

[AGPL-3.0](LICENSE). Part of the INITE ecosystem — see also
[inite-auth-service](https://github.com/inite-ai/inite-auth-service) (identity)
and [inite-brain-service](https://github.com/inite-ai/inite-brain-service) (memory).
