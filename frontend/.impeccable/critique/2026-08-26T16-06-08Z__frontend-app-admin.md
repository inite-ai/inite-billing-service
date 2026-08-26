---
target: admin UI
total_score: 14
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 2
timestamp: 2026-08-26T16-06-08Z
slug: frontend-app-admin
---
Method: dual-agent (A: design review · B: detector + static evidence)

## Design Specificity Verdict
Category-interchangeable CRUD skin. 20 pages of PageHeader + Card + Table + row IconButtons + create-modal. Nothing in the composition knows it is moving money. prices/page.tsx (the money object) has no filter, no edit, no grouping — only delete. Deactivating a payment rail uses the same Eye/EyeOff gesture as hiding a product. Only referral-config:204 (total-commission warning above 50%) reasons about the domain.

## Design Health Score
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 2 | funnel:210 fires a success toast for actions that never call an API; affiliates:44 / webhooks:22 have no catch (skeleton spins forever) |
| 2 | Match System / Real World | 2 | Raw enums (reviewed_fraud, notify_only); tier pricing edited as raw JSON (metering:457) |
| 3 | User Control and Freedom | 1 | Zero undo across 9,379 lines; Modal has no Escape handler |
| 4 | Consistency and Standards | 1 | Five confirmation mechanisms for one class of action |
| 5 | Error Prevention | 1 | 12/12 confirm sites print the same sentence twice and never name the record; payment-providers:139 silently wipes apiSecret |
| 6 | Recognition Rather Than Recall | 1 | userId.slice(0,8)+'...' — uncopyable; UUID-only search |
| 7 | Flexibility and Efficiency | 1 | 0/22 tables sortable; no bulk select, no export, no shortcuts |
| 8 | Aesthetic and Minimalist Design | 3 | Tables genuinely dense; six identical stat cards on dashboard and funnel |
| 9 | Error Recovery | 1 | 22 hardcoded English toasts + 20 raw backend messages; failure disguised as emptiness |
| 10 | Help and Documentation | 1 | No inline help for softCapPct, overagePolicy, graceDays, tierRates |
| **Total** | | **14/40** | **Poor — core operator flows are broken** |

## Cognitive Load
6 of 8 checklist items fail. Decision points >4 options: sidebar System group (6), dashboard stats (6), funnel StatsBar (6), risk status filter (6, raw enums), promo-code form (11 flat fields), metering quota modal (7).

## What's Working
1. The three-state contract where wired (services:184): skeleton → ErrorState(retry) → EmptyState → table. Distinguishes failure from emptiness. Only on 6 of 20 pages.
2. referral-config:243 inline row editing — the only page that resists the modal reflex, and the one that most needed to.
3. credits:237 ledger disclosure — answers "why is this number 40" in place.

## Priority Issues

### [P0] Funnel action buttons do nothing but claim success
triggerAction = () => setToastMessage(t('actionTriggered')) (funnel:210); five buttons wired to onAction (funnel:728). No API call exists. VERIFIED IN SOURCE. Destroys trust in every other toast.
Fix: wire to the real endpoints (/v1/admin/outreach backs three of five) or delete the tab. Suggested: /impeccable harden

### [P0] An operator cannot find a record from anything a customer can give them
Every search is a UUID field; admin-orders.service.ts:20 matches userId exactly. No search by email, order id, external payment id. Truncated IDs are uncopyable.
Fix: omni-search (order id, PaymentIntent.externalId, referral code, email), copy-to-clipboard on ID cells, cross-links between orders/subs/credits. Suggested: /impeccable shape

### [P1] Destructive confirmations do not name the record, and there are five mechanisms
12/12 sites pass the same string as title and message. None names the record. risk:244 (mark fraud AND refund) has no confirmation at all. payouts:52 (money leaving) is variant 'default'.
Fix: ConfirmDialog takes {title, body, recordLabel, consequence}; kill window.confirm/prompt; danger variant on payout processing; type-the-code for irreversible actions. Suggested: /impeccable clarify

### [P1] Money mutations have no target context, no reversal, and one destroys credentials
payment-providers:139 — rotating only the API key writes apiSecret: '' while the placeholder promises "Leave empty to keep". VERIFIED IN SOURCE. Credit adjust modal shows neither whose balance nor the resulting balance; reason optional. PriceForm:57 takes currency as free text.
Fix: show target + computed new balance, require reason, merge config instead of replacing, Select for currency, undo toast for reversible mutations. Suggested: /impeccable audit

### [P2] There are no queues, only lists — the dashboard does not say what needs attention
Six all-time cumulative counters, no deltas, no thresholds. Never surfaces pending payouts, open risk flags, failed webhooks, past_due subs — all already available from the API. No bulk select, no sorting, no export anywhere.
Fix: triage panel of open items linking to prefiltered views; row checkboxes + bulk bar on payouts and risk; sortable Th; CSV export. Suggested: /impeccable shape

## Persona Red Flags
Alex (power user): 40-row payout run = ~120 interactions; no sort, no bulk, no export; native prompt() at payouts:68; no Escape in Modal.
Sam (screen reader): Modal has no role=dialog/aria-modal/focus trap; unlabelled close button; clickable <tr onClick> with no tabIndex — order/subscription/customer/affiliate detail is keyboard-unreachable; metering:255 bare button around a Badge toggles billing.
Riley (stress): credits catch { setBalances([]) } renders a failed load as "no balances"; risk has no catch at all — false all-clear on a fraud queue.

## Detector
8 findings, 4 false positives (gray-on-color in IconButton — hover states never coexist), 4 intentional (violet gradient identity). Browser visualization skipped: admin is auth-gated behind an ADMIN session and no backend was running. No overlay was produced.

## Minor Observations
- products has no edit action at all (delete-only) while ProductForm fully supports `initial`.
- Launching a paid product spans three pages and three modals with no continuity.
- outreach hand-rolls pagination six lines from the shared primitive; outreach and risk fetch beyond page 1 with no control to get there.
- Filter/page state is component-local everywhere: refresh or back-button drops to page 1 with filters cleared.
- 4 pages call load() and setPage(1) in the same tick — a wrong request followed by a right one.
- Nothing polls or auto-refreshes; the fraud queue is stale the moment it renders.

## Questions to Consider
1. If an operator only has a customer's email, what is the intended path?
2. What should the admin look like at 9am — which four things must be cleared today?
3. If every mutation wrote a visible, reversible entry, would you need any confirmation dialogs at all?
4. Why does the interface treat "hide a product" and "take a payment rail offline" as the same gesture?
5. Which of these 20 pages would an operator actually visit in a week?
