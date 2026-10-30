# Open products

An open product is one billing product that a service sells many things
through. The service names the amount and title of each sale when it opens
the checkout, so it does not need a billing product for every item. lava.top
calls the same thing an offer with a dynamic price.

inite.education is the first service to use one: it sells every generated
course through `education-open` instead of keeping a product per course.

## The product

An open product has `type: open`, belongs to one service, and carries its
rules in `metadata`:

```json
{
  "open": {
    "currencies": {
      "USD": { "min": "1.00", "max": "50.00" },
      "BRL": { "min": "5.00", "max": "250.00" }
    }
  },
  "entitlementTemplate": "education:course:{ref}",
  "itemParams": { "ref": "^[a-z0-9][a-z0-9-]{0,79}$" }
}
```

- `open.currencies` lists the currencies the product takes. Each one has a
  `min` and a `max` for the unit amount, written as decimal strings.
- `entitlementTemplate` is optional. It must start with the owning service's
  code, followed by a colon, and its only placeholder is `{ref}`. A bare
  `course:{ref}` is refused, because it could collide with another service's
  key. Without a template, a sale grants nothing, and the service fulfils the
  order from the `billing.payment.succeeded` webhook, the way goods are
  fulfilled.
- `itemParams.ref` is optional. When present, it narrows the ref beyond the
  global safe pattern `^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`.

The service's daily volume is capped per currency in **the service's**
`metadata.openDailyCap`, for example `{ "USD": "500.00" }`. A currency with
no cap is not sold open: the setting fails closed.

An open product never appears in `GET /v1/products`, `/v1/products/prices` or
the storefront.

## Selling

`POST /v1/service-checkout/sessions` takes a service token with scope
`billing:checkout`. An open sale is a single line:

```json
{
  "userId": "did:key:z6Mk… | education:<guest-id>",
  "lines": [{
    "productCode": "education-open",
    "amount": "2.00",
    "currency": "USD",
    "title": "AI for beginners",
    "ref": "ai-basics",
    "quantity": 1
  }],
  "successUrl": "…", "errorUrl": "…",
  "metadata": { "clientReference": "edu-ord-1" }
}
```

The answer is `{ sessionId, checkoutUrl, x402Url?, amount, currency, rails,
entitlementKey? }`. `rails` lists the payment rails that can take this
amount.

Billing checks each line as follows. A refusal is a 4xx, and it is written to
the audit trail.

| Check | Refused with |
|---|---|
| The product exists, is `open`, is active, and belongs to the caller's service. | 404, the same answer as for an unknown product |
| The amount is a decimal string within the currency's `min`/`max`. | 400 |
| The title, after NFC normalisation, has controls, zero-width and bidi-override characters and `<` `>` removed and whitespace collapsed, and is 1–120 characters long. | 400 |
| The ref matches the safe pattern and the product's own pattern. | 400 |
| A line that grants an entitlement has quantity 1. | 400 |
| The service's open orders in this currency over the last 24 hours, counting those being paid or paid, plus this sale, stay within the cap. | 400 |
| At least one active rail takes the currency and this amount. | 422 |
| An open line is the only line in the order. A catalogue line never carries an amount. | 400 |

The order keeps what was sold. `metadata.open` and `snapshot.open` both hold
`{ productCode, title, ref, unitAmount, quantity, lineAmount, entitlementKey }`.
The line also goes into `metadata.cart`, so the hosted page and the receipt
list the title. On payment, the orchestrator grants
`entitlementTemplate` with the ref put in. This is the same per-item grant that
item products already get (`metadata.item`), and a refund revokes it.
`GET /v1/service-checkout/sessions/:id` returns `productCode`, `title`, `ref`,
`quantity` and `entitlementKey` along with the status.

Each order hangs on an internal price, `<product>-open-<currency>`, with an
amount of 0. Billing creates it on the first sale in that currency. Nothing
can buy it by its code: `CatalogService.getPriceByCode` refuses it, which
covers ordinary checkout, carts, promo validation and MCP. An admin stops a
currency by deactivating its anchor price.

Promo codes do not apply to an open line.

## Provider minimums

Each rail declares the smallest amount it takes per currency
(`capabilities().minAmounts`). An admin can add a minimum that a provider has
but does not publish, as `PaymentProvider.config.minAmounts`
(`{ "USD": "1.00" }`). The higher of the two applies. For an open order:

- the session's `rails` and the hosted page leave out any rail whose minimum
  is above the amount;
- `pay` with such a rail named directly is refused before the provider is
  called;
- when no rail is left, the session is refused with 422 before an order is
  made.

Fixed-price orders are not filtered: their behaviour is unchanged.

| Rail | Arbitrary amounts | Minimum |
|---|---|---|
| LAVA (cards, СБП, PayPal) | Yes, through the provider's dynamic-price default offer (`config.defaultOfferId`), with the amount sent per invoice. An open order always goes through that offer, never through a fixed-price offer. | Not published in lava.top's API spec (`gate.lava.top/docs/documentation.yaml`). Set `config.minAmounts` if lava.top refuses small amounts. |
| HODLE (PIX) | Yes, the deposit is for the exact amount. Takes BRL only. | R$1.00, declared (the adapter refuses below it). |
| CRYPTO (stablecoins) | Yes, a unique-amount invoice converted at the current rate. | None. |
| x402 (USDC on Base) | Yes, the amount of the invoice. | None. The relayer's gas is capped per transfer and per day, not per amount. |

## Abuse limits

- **Daily cap:** per service and currency, as described above. It is checked
  when the session opens and again when payment starts. Sessions that are only
  opened (`created`) do not count, so a flood of abandoned sessions cannot use
  up a service's day. Two payments that start in the same instant can both
  pass, so the cap can be exceeded by at most one sale.
- **Audit:** `billing.open_sale_audit` gets one row for every open sale a
  service asks for. An opened sale is written in the same transaction as its
  order. A refused one is written with its reason. Each row holds the service,
  the auth client, the product, the order, the buyer, the amount, currency,
  quantity, title, ref and entitlement key. It holds ids rather than foreign
  keys, so it outlives what it describes.
- The route stays throttled at 20 per minute per caller.

## Goods sold for a merchant (inite.shop): design only

Shop wants to sell storefront goods through an open product, with one line
per shop order:

```text
productCode shop-open, ref = <shop order id>, no entitlement template
```

Fulfilment would come from the `billing.payment.succeeded` webhook, matched by
billing session id. A per-merchant namespace could be written as
`shop:<merchantId>:order:{ref}`, but that is a fulfilment key, not an
entitlement: goods grant no access.

**Where the money goes decides whether this can be built.** Today shop takes
no online payment at all. A payment method on a storefront (`cod`,
`bank-transfer`, `stripe`, `yookassa`) is a name that is stored on the order.
The merchant's Stripe or YooKassa keys are saved, but nothing charges them,
and payments are recorded by hand in the back office. Shop does not use
billing.

Billing settles every sale into INITE's own provider accounts: the lava.top
account, the Hodle account and the crypto wallets. It has:

- no per-merchant balance;
- no split payment;
- no connected or sub-merchant accounts;
- no merchant payout.

The only payout machinery it has is affiliate commission payouts and the
treasury's USDC payouts for wallet top-ups.

**(a) Billing as the merchant's own checkout.** The money would go to the
merchant. This needs things billing does not have:

- per-merchant provider credentials, or connected accounts per merchant
  (Stripe Connect, lava.top sub-accounts if it offers them, a Hodle account
  per merchant), chosen per order;
- a merchant identity below the service (`Service` → merchant), with
  KYC/onboarding state;
- per-merchant caps, bounds and an audit scope;
- refunds and chargebacks routed to the merchant's account;
- webhooks and fulfilment per merchant.

**(b) INITE as merchant of record, paying merchants later.** This needs:

- a merchant ledger: gross, INITE's fee, provider fees, refunds and
  chargebacks, and the net owed;
- payout runs per merchant, for example by extending `PayoutProvider` and the
  affiliate payout flow;
- reserves for chargebacks.

The legal and tax side, which must be settled before any code:

- INITE becomes the seller of third-party goods. It would then answer for
  consumer law, returns and product liability.
- Revenue is taxed on gross, not on INITE's fee. INITE would also have to
  invoice in each buyer's jurisdiction.
- Taking money for others and paying it out later can be regulated payment
  activity: a payment facilitator or agent, or money transmission, depending
  on the country. It also brings KYC/AML duties for merchants.
- Providers' terms may forbid it. lava.top is built for digital creators'
  own products, and reselling third-party physical goods through it may be
  outside its terms. Hodle and the card acquirers have their own rules.
- Chargebacks on goods INITE never held land on INITE's accounts.

**Owner's decisions needed:** (a) or (b). For (a), which rails each merchant
connects. For (b), the legal entity and the jurisdictions, the fee, the
payout schedule and reserve, and confirmation from lava.top and Hodle that
they allow marketplace sales. Until then, the shop side is not built.
