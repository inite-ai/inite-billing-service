# Commitments: money held against a promise

A commitment is money a person puts up against their own promise ("I will
run three times a week for a month"). Billing takes the payment, holds it,
and at the end either gives it back or hands it to a charity the person
chose. The product that runs the promise (Break3 first) only judges whether
it was kept.

Owner decisions, 29.10.2026: a lost stake goes to charity, INITE takes no
cut of it; billing holds the money; on a win the person chooses money back
to their INITE wallet or INITE credits; tiers $5/10/25/50/100, at most $300
at stake per person, a referee or proof above $25, auto-release 7 days after
the end when no verdict arrives; any fee is configurable and disclosed before
payment. TON and Break3's own contracts are dropped.

## Who owns what

| Billing | The product (Break3) |
|---|---|
| Payment on every rail (card, INITE wallet, x402 USDC on Base) | The challenge, its criteria, check-ins, proof |
| The hold, release, forfeit, refund on cancel | The referee: invite, confirm, dispute |
| The ledger, the $300 cap, tiers, the fee policy | The verdict and its dispute window |
| The charity registry, payout batches, the public forfeit ledger | The release choice screen, the transparency page |
| Auto-release when the product goes silent | Telling billing the verdict |

Billing never decides whether a promise was kept. The product never touches
money: it never marks a stake paid and it never moves funds. What it may do
is name the outcome, within the rules below.

## The model

`commitments`, one row per stake:

| Field | Meaning |
|---|---|
| `service_id`, `external_ref` | The product and its own id for the promise (unique together) |
| `user_id` | The person's DID, as INITE Auth names them |
| `order_id` | The billing order that pays for it (unique) |
| `product_code`, `price_code` | The catalogue entry the stake was bought from |
| `stake_amount`, `fee_amount`, `currency` | `Decimal(19,4)`, USD. The fee is never part of the stake |
| `credits_bonus_pct`, `credits_per_usd`, `credits_service_id` | The credits offer, copied from the policy at creation |
| `charity_id` | Where a forfeit goes. Fixed at creation |
| `verification` | `{ referee: bool, proof: bool }`, as promised at creation |
| `ends_at`, `auto_release_at` | The promise's end; `ends_at + 7 days` |
| `status` | See states |
| `release_as` | `money` or `credits`, once released |
| `held_at`, `settled_at`, `version` | Timestamps; optimistic version for admin edits |

`commitment_transitions` is the journal: one row per change of state, with
`from`, `to`, `actor` (`system`, `service`, `admin`), `actor_id`, `reason`,
and an `idempotency_key` unique per commitment. Repeating a call with the
same key returns the first result and changes nothing.

`commitment_ledger` is double-entry: every transition writes lines whose
debits equal its credits, in one transaction with the state change. Accounts:

| Account | Holds |
|---|---|
| `payments_in` | What the rail delivered for the order (stake + fee) |
| `held` | Money currently held against promises |
| `fee_income` | INITE's disclosed fee, when a policy sets one |
| `owed_to_user` | Released money waiting for its USDC payout to the person's wallet |
| `paid_to_user` | Paid out (treasury tx hash on the payout) |
| `credits_issued` | Stakes turned into credits (credits carry their own journal too) |
| `charity_payable:<code>` | Forfeits not yet handed over |
| `charity_paid:<code>` | Handed over, by payout batch |
| `refunded` | Returned on cancel through the card provider |

The balance of `held` always equals the sum of `stake_amount` over rows in
`held` and `disputed`; a test checks it.

## States and transitions

```
pending_payment ──paid──▶ held ──release(money)──▶ released_money
      │                    │  ├─release(credits)─▶ released_credits
      │ order failed/      │  ├─forfeit─────────▶ forfeited
      ▼ expired            │  ├─cancel──────────▶ refunded_on_cancel
     void                  │  ├─(auto)──────────▶ auto_released
                           │  └─dispute─────────▶ disputed
                           │                        │ admin: any of the above, or back to held
                           │                        └─(backstop, ends_at+30d)─▶ auto_released
```

| Transition | Who | When allowed | Ledger |
|---|---|---|---|
| create → `pending_payment` | service | tier, charity, verification and the cap all pass | none |
| `pending_payment` → `held` | system, in the order-paid transaction | the order's amount equals stake + fee; otherwise the row goes to `disputed` with reason `amount_mismatch` | Dr `payments_in` / Cr `held` (stake), Cr `fee_income` (fee) |
| `pending_payment` → `void` | system, in the order failed/expired transaction | | none |
| `held` → `released_money` | service | any time after `held` | Dr `held` / Cr `owed_to_user`; then the payout: Dr `owed_to_user` / Cr `paid_to_user` |
| `held` → `released_credits` | service | any time after `held` | Dr `held` / Cr `credits_issued`, and a credit grant of `stake × credits_per_usd × (1 + bonus)` |
| `held` → `forfeited` | service | only after `ends_at` | Dr `held` / Cr `charity_payable:<code>` |
| `held` → `refunded_on_cancel` | service (the person asked) | within 24 h of `held_at`, before the promise starts, at most 2 per person per 30 days | Dr `held` + Dr `fee_income` / Cr `refunded` (card) or Cr `owed_to_user` (wallet, x402) |
| `held` → `disputed` | service (the referee or the person disputes) | before settlement | none: money stays in `held` |
| `held` → `auto_released` | system scheduler | `auto_release_at` passed with no verdict | as `released_money` |
| `disputed` → any settled state, or `held` | admin, with a reason | | as the target state |
| `disputed` → `auto_released` | system | `ends_at + 30 days` passed and no admin decision | as `released_money` |

Settled states (`released_*`, `forfeited`, `auto_released`,
`refunded_on_cancel`, `void`) are final. A transition is one database
transaction that locks the row (`SELECT … FOR UPDATE`), checks the state,
writes the journal line, the ledger lines and the outbox event, or does
nothing.

**Forfeit is only after the end.** A product cannot take the money early.
**Release is any time**: giving a person their own money back early harms
nobody but the promise.

## Money back

- **To the INITE wallet (money, auto-release, cancel on wallet or x402).**
  The treasury sends USDC on Base to the person's INITE wallet, exactly
  once per order, through the existing `treasury_payouts` path (per-transfer
  policy in Turnkey, the daily limit in billing, a held payout for an admin
  when over it). A person with no INITE wallet yet keeps the money in
  `owed_to_user`; the payout goes as soon as the wallet exists. The product
  says so on screen.
- **As credits.** A credit grant on the commitment's credit scope
  (`credits_service_id`; null means platform-wide INITE credits). Credits do
  not come back as money.
- **Card refunds** are used only for `refunded_on_cancel` on a rail whose
  connector refunds programmatically (Stripe today); stake and fee go back
  in full. Every other rail returns the cancel to the INITE wallet.
- The stake order itself stays `paid`. It is not refunded through the
  orchestrator: the commitment owns the money after payment, and its ledger
  says where it went.

## The fee policy, from the catalogue

The policy is product metadata, never code. One product per stake offer
(a campaign is another product with its own policy):

```json
{
  "commitment": {
    "tiers": ["5", "10", "25", "50", "100"],
    "feePct": "0",
    "creditsBonusPct": "0",
    "creditsPerUsd": 100,
    "creditsServiceCode": null,
    "maxActivePerUser": "300",
    "verificationAbove": "25",
    "autoReleaseDays": 7,
    "cancelWindowHours": 24
  }
}
```

`POST /v1/admin/commitments/products/:code/sync` writes one price per tier,
code `<product>-usd-<tier>`, amount `tier × (1 + feePct/100)` rounded to the
cent, `metadata.commitment = { stake, fee }`. Creation refuses a price whose
amount no longer matches its policy, so a fee can never change behind a
disclosed quote. `GET /v1/commitments/quote` and the create response both
return `{ stake, fee, total, feePct, creditsBonusPct, credits }`; the product
shows that before the person pays. Default is 0% fee and 0% bonus.

## Limits

Billing is the source of truth. At creation, under an advisory lock on the
person:
- the tier must be one of the policy's tiers;
- `stake > verificationAbove` needs `verification.referee` or
  `verification.proof`;
- the sum of `stake_amount` over the person's rows in `held`, `disputed`,
  and `pending_payment` younger than 2 hours, plus the new stake, must not
  exceed `maxActivePerUser`. Older unpaid rows are not counted; if one is
  paid late it is still held (the money arrived).
- `ends_at` must be at least 24 h and at most 180 days away.

## Charities and payouts

- `charities`: `code`, `name`, `url`, `description` (i18n), `payout_method`
  (text: how INITE pays them), `is_active`. Admin-managed. A person picks one
  at creation from the active list; it never changes afterwards.
- `charity_payouts`: a batch for one charity, `amount`, `currency`,
  `period_from/to`, `reference` (a transfer id or receipt), `status`
  (`recorded`, `sent`), `created_by`. Creating a batch picks every
  `forfeited` commitment of that charity not yet in a batch, up to
  `period_to`, links them (`charity_payout_id`) and writes
  Dr `charity_payable:<code>` / Cr `charity_paid:<code>`. INITE sends the
  money by hand (bank or USDC) and records the reference.
- **Public transparency**: `GET /v1/commitments/charities` (no auth) lists
  each active charity with totals forfeited, paid out and still owed;
  `GET /v1/commitments/charities/:code/ledger` lists forfeits (date, amount,
  a short hash of the commitment id, never a person) and payouts (date,
  amount, reference). Break3's transparency page renders this.

## The API

Service calls carry an INITE Auth `client_credentials` token:
`aud = <billing>/v1/services`, scope `billing:commitments` (stakes) or
`billing:checkout` (ordinary purchases such as supplements). Billing
verifies the signature against INITE Auth's JWKS, `iss`, `aud`, the scope,
that `sub` is not a person (`did:`), and maps `client_id` to the `Service`
through `services.auth_client_id`. A service sees only its own commitments.
No API key is accepted here, and no endpoint below changes state without
one of these tokens or an admin session.

| Method | Path | Who |
|---|---|---|
| GET | `/v1/commitments/quote?product=&tier=` | service |
| POST | `/v1/commitments` | service. Body: `userId`, `externalRef`, `productCode`, `tier`, `charityCode`, `endsAt`, `verification`, `successUrl`, `errorUrl`, `locale`. Header `idempotency-key`. Returns the commitment, the quote, `checkoutUrl`, `x402Url` |
| POST | `/v1/commitments/:id/pay-from-wallet` | service. Pays the stake order from the person's INITE wallet (409 `needs_approval` + `approveUrl`) |
| GET | `/v1/commitments/:id`, `/v1/commitments?userId=&externalRef=` | service |
| POST | `/v1/commitments/:id/release` | service. `{ as: money\|credits, reason }` |
| POST | `/v1/commitments/:id/forfeit` | service. `{ reason }` |
| POST | `/v1/commitments/:id/cancel` | service. `{ reason }` |
| POST | `/v1/commitments/:id/dispute` | service. `{ by: user\|referee, reason }` |
| GET | `/v1/commitments/charities`, `/charities/:code/ledger` | public |
| GET | `/v1/commitments/mine` | the person (JWT) |
| GET, POST | `/v1/admin/commitments…` (list, override, charities, payouts, sync) | admin |
| POST | `/v1/service-checkout/sessions`, `GET …/:id`, `POST …/:id/pay-from-wallet` | service, `billing:checkout` |

Every mutating service call takes an `idempotency-key` header (required).

## Webhooks to the product

Through the existing outbox, addressed to the commitment's service, signed
`x-billing-signature: sha256=HMAC(apiKey, ts.body)` with
`x-billing-timestamp`. The product verifies the signature and a 5-minute
window, and treats events as idempotent by `commitment_id` + `status`:

`billing.commitment.held`, `.released` (with `release_as`), `.forfeited`,
`.refunded`, `.disputed`, `.auto_released`, `.void`. Payload:
`{ commitment_id, external_ref, user_id, status, stake, fee, currency,
release_as?, charity }`. The product also reads `GET /v1/commitments/:id`
on return from checkout and never trusts a redirect alone.

## Timeouts

- Unpaid: stops counting against the cap after 2 hours; becomes `void` when
  its order fails or expires.
- Cancel window: 24 h after `held`, before the promise starts.
- Dispute window (Break3): 48 h after `ends_at` before a failure is sent.
- Auto-release: `ends_at + 7 days` without a verdict, every 10 minutes,
  one instance (distributed lock).
- Disputed backstop: `ends_at + 30 days` without an admin decision.
- Release to a person with no wallet: waits in `owed_to_user`, no expiry.

## Fraud and abuse

- **Refund loops** (pay by card, cancel, get USDC): cancel refunds go back
  on the card when the rail refunds; to the wallet otherwise; at most 2
  cancels per person per 30 days, only within 24 h. Releases for card-paid
  stakes go through the treasury's limits, and the risk service's score is
  recorded at checkout as for every order.
- **Self-referee**: the referee is a different Break3 account, invited by
  link, who must sign in; Break3 refuses the owner as referee and refuses
  a referee account created after the challenge. Billing records only
  `verification.referee = true`; a stake above $25 without a referee or
  proof is refused by billing, not only by the UI.
- **Early forfeit**: refused before `ends_at`.
- **Product goes rogue or silent**: it can only release (to the person),
  forfeit after the end (to the chosen charity), or dispute. It can never
  send money anywhere else. Silence auto-releases.
- **Forged webhooks**: signed; the product re-reads state from billing
  before acting on a payout-relevant event.
- **Promo codes** do not apply to commitment prices: a hold whose order
  amount is short goes to `disputed`.
- **No affiliate commission** is paid on a stake order.

## Break3

- **Creation.** One collapsible "Put money on it" section in the new
  creation flow: tier buttons ($5–100), the charity picker from
  `GET /v1/commitments/charities`, the quote (stake, fee, total, credits
  bonus), and above $25 a required referee invite or a proof type. Needs the
  person signed in with INITE (their DID). Create → billing → pay.
- **Payment.** Three buttons: INITE wallet (`pay-from-wallet`, passkey on
  billing when asked), USDC x402 (the `x402Url` for agents and wallets),
  card (`checkoutUrl`). On return the backend reads the commitment.
- **Check-ins and proof.** Self-reported check-ins as today. A proof
  check-in (photo, or steps/sleep numbers) for habits that have one; the
  coach checks it on the cheap model tier, only for signed-in people, never
  for anonymous ones, and falls back to "unchecked" rather than a paid call.
  The referee sees check-ins and can confirm or dispute each one.
- **Verdict.** The existing criteria evaluation at `ends_at`. Success →
  ask the person "money or credits" (default money after 3 days) → release.
  Failure → a 48 h dispute window, then forfeit. A dispute by the person or
  the referee → billing `dispute`; an admin decides. The person can no longer
  declare their own success on a staked challenge ("Завершить" only ends an
  unstaked one).
- **Transparency page.** `/transparency`: each charity, forfeited, paid,
  owed, and the payout references, from billing's public endpoints.
- **Removed.** BlockchainService, the contracts, TON, wallet linking, the
  unverified `updateStaking` write, the mock payment service, and the web3
  packages in the frontend.

## Security

- No unauthenticated mutation anywhere: billing's public routes are reads of
  aggregate charity data; Break3's staking resolvers need the session and
  the owner.
- Service to service only through INITE Auth tokens with a scope and an
  audience (family rule); no shared static key is accepted for commitments.
- Webhooks verified by HMAC with a timestamp window.
- `userId` on a service call is the DID the product got from that person's
  own INITE sign-in; a person reaching billing directly sees only their own
  rows (`/mine`).

## Legal notes (not legal advice)

- This is a **commitment contract**, not a wager: the person can only get
  their own money back or lose it to a charity they chose. There is no
  prize, no pool, no payout from anyone else's loss, and INITE takes nothing
  from a forfeit. The outcome depends on the person's own conduct.
- Disclose before payment: the amount at stake, the fee (if any) and that
  it is not refunded on a loss, the charity, how the verdict is reached and
  disputed, the auto-release, that money returns to the INITE wallet in
  USDC (or as credits, by choice), and that forfeits are handed over in
  periodic batches published on the transparency page.
- A forfeit is not a tax-deductible donation by the person: INITE hands it
  over. Say so.
- Crypto rails stay off where crypto payment is not allowed; billing already
  chooses rails per country.
- Open: the charity list and the exact disclosure text need the owner and,
  ideally, a lawyer.
