<!--
Thanks for contributing! AGENTS.md is the rulebook (humans: CONTRIBUTING.md).
-->

## In plain words

What changes for a customer, an admin or an integrating service — written so
a non-engineer can follow it.

## What & why

What does this change technically, and why?

## Zone

- [ ] green
- [ ] yellow — risk note:
- [ ] red — approved design issue: #

(See the Zones table in [AGENTS.md](https://github.com/inite-ai/inite-billing-service/blob/main/AGENTS.md#zones).)

## Type

- [ ] Bug fix
- [ ] Feature
- [ ] Hardening / security
- [ ] Docs
- [ ] Refactor / chore

## Gates

Ran locally (the rest run in CI):

- [ ] `npx eslint "src/**/*.ts" "test/**/*.ts"`
- [ ] `npx nest build`
- [ ] `npm --prefix mcp run build` (if `mcp/` changed)
- [ ] `npm run test:ci` / `npm run test:e2e` (needs the test DB) or `npm test`
- [ ] Frontend: `npx tsc --noEmit -p tsconfig.json && npm run lint && npm test && npm run build` (if `frontend/` changed)

## Checklist

- [ ] Tests added/updated for behaviour changes — list them:
- [ ] Money paths (checkout, webhooks, credits, refunds, wallet) have a test for the
      failure/abuse property, not just the happy path
- [ ] Public API contracts stay backwards compatible (external INITE modules
      call `/v1/credits/*`, `/v1/checkout/*` service-to-service)
- [ ] New migrations are append-only (a new `prisma/migrations/<timestamp>_<name>/`)
- [ ] No secrets committed (`gitleaks detect --config .gitleaks.toml`)
- [ ] Commit messages explain the *why*; PR title is a Conventional Commit

## AI-assisted

- [ ] No
- [ ] Yes — agent/tool:

## Related issues

Closes #
