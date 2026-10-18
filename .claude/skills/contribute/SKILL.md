---
name: contribute
description: Take an idea for inite-billing-service from plain words to a pull request — restate it, find where it fits, write a short spec, stop for approval on risky areas (payments, migrations, wallets, auth), then implement with tests, run the CI gates and open a PR. Use when someone says "I have an idea", "I want to add / change / fix something in billing", or "/contribute".
---

# /contribute — idea to PR in inite-billing-service

You are pairing with someone who may not be an engineer. AGENTS.md (repo root)
is the source of truth — read it first and follow its ground rules. Explain
what you are doing in plain language at each step, and keep questions short.

## 1. Understand

- Restate the idea in one or two plain sentences ("So you want customers to…").
- Ask at most 3 clarifying questions, only the ones that change the design
  (who uses it, what they see, what must never happen).
- Check for existing work: `gh issue list --search "<key words>" --state all`
  and `gh pr list --search "<key words>"`. If an issue exists, use it.
- New contributor with no idea yet? Offer
  `gh issue list --label "good first issue"`.

## 2. Find the zone

Using the Zones table in AGENTS.md, name the modules involved and the zone:

- **red** — `prisma/` (schema, migrations), `src/payment-orchestrator/`,
  `src/adapters/` and webhook signature checks (`src/common/connectors/`,
  `src/webhooks/`, `src/workers/webhook*.ts`), wallet balances / treasury /
  payouts / sealed keys (`src/wallet/`, `src/common/key-seal.ts`), token
  verification (`src/auth/`, governed by the INITE Triad contract).
- **yellow** — checkout, credits, subscriptions, entitlements, affiliates,
  crypto, workers, outbox, MCP, assistant, admin, `mcp/`, CI files.
- **green** — frontend pages/components/translations, docs, new tests.

Tell the person the zone and what it means for them.

## 3. Spec

Write it in the conversation, short:

- **Problem** — what is hard or impossible today.
- **Behaviour** — what a user/admin/integrating service will see.
- **API / UI change** — routes, DTO fields, MCP tools, pages.
- **Data change** — schema/migration, or "none".
- **Risks** — money correctness, auth, tenant (`serviceId`) scoping,
  backwards compatibility of `/v1`, PII.
- **Out of scope**.

**If any part is red: STOP here.** Offer to file the spec as an issue
(`/spec-idea` does exactly that, using `.github/ISSUE_TEMPLATE/product-idea.yml`,
label `idea`). Explain that a maintainer approves red-zone designs before
code is written. Do not write code until the issue is approved.

## 4. Plan

Small steps, each leaving the tree green. Say which files each step touches.

## 5. Implement, tests first where practical

- Work on a branch: `git switch -c feat/<short-name>` (or `fix/`, `docs/`).
- Backend tests go flat in `test/` (`*.spec.ts` unit, `*.e2e-spec.ts` e2e);
  copy the shape of `test/promo-release.spec.ts`. Money paths need a test
  for the failure/abuse property, not only the happy path.
- Frontend tests: `frontend/test/*.test.ts` (vitest). New UI strings go in
  all four `frontend/messages/{en,ru,pt,es}.json`.
- Follow AGENTS.md Conventions (Decimal money, `@User()` for userId, DTOs with
  class-validator, flags default off, no secrets/PII in logs).

## 6. Gates

Run what the change can affect (exact CI commands, from AGENTS.md):

```bash
npx eslint "src/**/*.ts" "test/**/*.ts"
npx nest build
npm --prefix mcp run build
npx jest test/<your>.spec.ts            # DB-free specs run anywhere
npm run test:ci -- --coverage            # needs the migrated test DB (devcontainer has it)
npm run test:e2e                         # needs the test DB
cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint && npm test && npm run build
```

Ask before running `npm test` — it starts Docker containers. If a DB-backed
gate can't run here, say so; CI runs it on the PR. Never weaken a test,
threshold or check to get green.

## 7. Docs

Update whatever describes the changed behaviour: `docs/*.md`, `env.example`,
Swagger decorators, the rendered docs in `frontend/app/docs/*/page.mdx`, AGENTS.md.

## 8. Commit

Conventional Commits (release-please builds the changelog from them):
`feat(scope): …`, `fix(scope): …`, `docs: …`, `test: …`; `!` for a breaking
change. Describe the outcome, not the edit.

## 9. Pull request

`gh pr create` with `.github/PULL_REQUEST_TEMPLATE.md` filled in: a
plain-language summary, the zone (link the approved issue for red), the gates
you ran, tests added, and "AI-assisted: yes — Claude Code". The PR title must
be a Conventional Commit. Then watch CI (`gh pr checks --watch`) and fix what
fails. Don't merge — tell the person a maintainer reviews and merges.
