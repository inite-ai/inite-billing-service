# ADR 0001: billing owns subscriptions

Status: accepted in principle. Milestone 1 is being built; each red-zone change
in it is approved on its own issue before it merges.

## Decision

A subscription is a contract billing keeps: plan, price, period, one invoice
per period, a collection method, entitlements. A storefront says only "this
plan, this buyer". Billing decides how money is collected from what each rail
adapter declares. Providers move money; billing decides what is owed.

There are three collection strategies, and all of them pay the same kind of
invoice:

| Strategy | Who starts a charge | Examples |
|---|---|---|
| `provider_managed` | the provider, on its clock | app stores, existing lava.top subscriptions |
| `merchant_initiated` | billing, on a saved method | the INITE wallet, later card tokens and Pix mandates |
| `buyer_approved` | the buyer, each period | PIX QR, crypto, a one-off card page |

We extend this service instead of adopting a subscription engine: crypto, the
wallet, x402, credits, commissions and organisation subscribers already live
here, and an engine tied to one provider could not collect on the others.

## Rules that bind every change

1. **An attempt is not an invoice.** A `PaymentIntent` ending changes the
   attempt. A renewal order ends by its own clock, a cancel, a plan change or
   an admin, never because one QR code or one timer ran out.
2. **An attempt's end never changes an order that is paid** or that another
   live attempt may still pay.
3. **Money that arrives is never dropped.** It pays the order it was sent for,
   or it is recorded as unapplied for a person to settle. It never grants twice.
4. **A charge has one identity**, taken from the provider, the same whether it
   came by webhook, poll or reconciliation. Our own period is not an identity.
5. **A renewal records what was charged**, in the currency it was charged in,
   for the provider's period when the provider owns the clock.
6. **A refund acts on the period its order paid for**, found by the order's
   link to its subscription.
7. **Periods are counted from an anchor**, in UTC, with the day clamped to the
   month: 31 January, 28 February, 31 March.
8. **A rail is offered only if it would take the order.** Each adapter answers
   `quote` without a network call, and a contract test holds that answer to
   what the adapter does.
9. **Money is an exact decimal with a currency**, converted to minor units by
   one helper that knows currencies without cents.
10. **Locks are taken in one order**: subscription, order, intent.
11. Schema changes are additive and short; existing rows keep working on the
    code that wrote them, and responses of `/v1/*` only grow.

## Milestones

1. Plans payable correctly on the rows and rails that exist. Storefronts do
   not change.
2. The engine: invoices with typed periods, one clock, ledger, balance,
   refunds, reconciliation, portal, per-service migration.
3. Rails that hold a method, and country policy.

Work in milestone 1 is built so that milestone 2 replaces the sweepers, not
the rules above.
