<!--
Thanks for contributing! Please read CONTRIBUTING.md first.
-->

## What & why

What does this change and why?

## Type

- [ ] Bug fix
- [ ] Feature
- [ ] Hardening / security
- [ ] Docs
- [ ] Refactor / chore

## Checklist

- [ ] `npm run build` passes
- [ ] `npm test` passes (added/updated tests for behavior changes)
- [ ] Money paths (checkout, webhooks, credits, refunds) have a test for the
      failure/abuse property, not just the happy path
- [ ] Public API contracts stay backwards compatible (external INITE modules
      call `/v1/credits/*`, `/v1/checkout/*` service-to-service)
- [ ] New migrations are append-only (`prisma/migrations/NNNN_*`)
- [ ] No secrets committed (`gitleaks detect --config .gitleaks.toml`)
- [ ] Commit messages explain the *why*

## Related issues

Closes #
