# Security model + known limitations

This service is the money gateway for the INITE ecosystem. Anything that
lands here — orders, payment webhooks, credit balances, refunds,
subscriptions — moves or grants real value. The list below is the running
ledger of security-relevant features that ship today and the properties we
know we have NOT yet bought.

## What ships today

| Surface | Status |
|---|---|
| Helmet (CSP / HSTS / X-Frame / Referrer-Policy) | ✓ |
| RS256 JWT verification via JWKS (auth.inite.ai) | ✓ (HS256 fallback for dev) |
| Service-to-service auth via per-service API keys | ✓ (`x-api-key`, DB-backed, revocable) |
| IDOR guards on user-scoped endpoints (`userId` from JWT, never body) | ✓ (C3/C4 fixes) |
| Conversation/message ownership checks | ✓ (H1/H2 fixes) |
| Provider webhook amount/currency validation | ✓ (mismatch → payment failed) |
| Resend delivery-webhook signature verification (svix HMAC, replay window) | ✓ |
| SSRF guard on outbox webhook delivery (private-IP block) | ✓ |
| Global + per-endpoint throttling | ✓ (60/min global; chat 10/min; checkout 5-10/min; insights 5/min) |
| Assistant prompt-injection guardrails | ✓ (system prompt + tool descriptions) |
| Assistant write-actions require explicit UI confirmation | ✓ (CAS-gated, role re-checked at confirm time, TTL, audit trail) |
| Assistant tool output role-gating (admin tools behind `admin` role) | ✓ |
| No PII sent to LLMs in outreach generation | ✓ (context is product/amount data only) |
| LLM output link stripping + server-side CTA substitution | ✓ |
| Payment risk scoring (velocity / outlier / failed-burst heuristics) | ✓ (monitor-only by default) |
| Idempotency: checkout (`idempotency-key`), outreach (`triggerKey`), email (Resend `Idempotency-Key`) | ✓ |
| Money as `Decimal(19,4)`, credits as integers — never floats | ✓ |
| Append-only Prisma migrations | ✓ |
| Secret scanning in CI (gitleaks) | ✓ |

## Known limitations

- **Risk scoring is heuristic and monitor-only by default.** Enable blocking
  with `RISK_BLOCKING_ENABLED=true` only after reviewing flag precision in
  `/admin/risk` — false positives block real checkouts.
- **Provider credentials live in the database** (`payment_providers.config`),
  not a secret manager. DB access equals provider-credential access.
- **The assistant reads real billing data.** Admin-role tools expose revenue
  and other users' orders; the role claim comes from the auth service JWT —
  compromise of auth is compromise of this surface.
- **No per-user encryption at rest** beyond what the database provides.

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub's
[private vulnerability reporting](../../security/advisories/new) for this
repository, or email the maintainer. Include reproduction steps and impact.
You will get an acknowledgement within 72 hours. Please allow a reasonable
disclosure window before publishing.

## Scope notes for researchers

- Test against your own local deployment (`docker-compose up`), never
  against `billing.inite.ai` production.
- Rate-limit bypass, IDOR between users/services, webhook forgery, credit
  balance manipulation, and assistant privilege escalation (user → admin
  tools, or executing actions without UI confirmation) are all in scope and
  considered high severity.
