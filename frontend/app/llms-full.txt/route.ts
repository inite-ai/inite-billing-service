import { SITE_URL, BRAND, ORG } from '@/lib/brand'

export const revalidate = 3600

const BODY = `# INITE Billing — Full Content Dump
> Payment-rail-agnostic, AI-first billing gateway for the INITE platform.
Source: ${SITE_URL}/
Locale: en
Organization: ${ORG.name} (${ORG.legalName}) — ${ORG.url}

---

## What INITE Billing is
INITE Billing is the single service for money, subscriptions, credits and entitlements used by product modules in the INITE ecosystem. It is payment-rail-agnostic: Stripe, native multi-chain crypto (ETH/SOL/TON/TRON), Apple IAP, Google Play, Lava and ONE all implement one adapter interface, so the core does not depend on which rail took the payment. Webhook verification and idempotent retries are built in.

## Subscriptions & metered credits
Full subscription lifecycle — trials, renewals, grace periods — plus a credit ledger with per-tier metering and windowed quotas with soft-cap warnings, built to bill AI usage (tokens / requests / generations).

## Multi-level referrals
A configurable N-level referral engine: qualification criteria per level, automatic level shifting, real-time network-tree visualization, and automatic monthly payouts.

## Embedded AI assistant
A role-gated assistant with 19 tools over billing data: 14 read-only tools plus 5 write actions (cancel a subscription, adjust credits, propose a refund, …) that require confirmation in the UI before they execute. Users see only their own data; admins get revenue, funnel and ops tools.

## AI retention
LLM-generated dunning, win-back and abandoned-checkout outreach, plus next-best-offer recommendations and one-click AI funnel insights for operators. Localized and rate-capped; off by default behind kill switches.

## For developers
REST API with interactive Swagger docs, webhook notifications for payment/subscription/commission events, OAuth 2.0 + PKCE via INITE Identity (no passwords stored in billing), and per-service API keys for server-to-server calls.

## Pricing
Free to integrate. INITE takes no cut of revenue; you pay only your payment provider's standard processing fees.

## FAQ

### What is INITE Billing?
A payment-rail-agnostic, AI-first billing gateway: one backend for subscriptions, usage-metered credits, entitlements and multi-level referrals, with an embedded AI operator.

### Which payment methods does INITE Billing support?
Six rails behind one adapter interface: Stripe, crypto (ETH/SOL/TON/TRON), Apple IAP, Google Play, Lava and ONE. Adding a rail does not change your integration code.

### How much does INITE Billing cost?
Free to integrate — no platform cut of revenue. You only pay the standard processing fees charged by your payment provider.

### What can the AI assistant do?
It has 19 tools over your billing data — 14 read-only, plus 5 write actions (cancel a subscription, adjust credits, propose a refund) that require confirmation in the UI before they run.

---

## Entity & contact
- Product: INITE Billing (part of the INITE AI ecosystem)
- Organization: ${ORG.name} (${ORG.legalName}) — ${ORG.url}
- Founder: ${ORG.founder.name}, ${ORG.founder.jobTitle}
- Contact: ${BRAND.contactEmail}
- Source: ${BRAND.repo}
- API docs: ${BRAND.docs}
- Social: ${BRAND.sameAs.join(', ')}

## Content policy
Citation encouraged for AI answer engines; training-only crawlers are opt-out. See ${SITE_URL}/robots.txt
`

export async function GET() {
  return new Response(BODY, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  })
}
