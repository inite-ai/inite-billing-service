# Merchant-own payment accounts

Decided by the owner on 30.10.2026. A service such as inite.shop sells for its
merchants. Each merchant connects **its own** provider account, and the
buyer's money goes straight to that account. Billing creates the payment on
the merchant's account and records the order and its status. **INITE is not
the merchant of record and never holds merchant funds.** This is option (a) of
[open-product.md](open-product.md#goods-sold-for-a-merchant-inite-shop-design-only).

## Model

- **Merchant** (`billing.merchants`): owned by one service (`serviceId`) and
  keyed by the merchant's tenant org in INITE Auth (`orgId`, unique per
  service; shop uses `shop:<companyId>` until a company has an org). A
  service never sees another service's merchant: it gets 404, not 403.
- **MerchantConnection** (`billing.merchant_connections`): one per merchant
  per rail. Its credentials are sealed with `KEY_SEAL_SECRET` (AES-256-GCM,
  `src/common/key-seal.ts`), and the AAD is the connection id, so a blob
  copied onto another row does not open. Status is `pending`, `verified`,
  `failed` or `disconnected`. The row also keeps non-secret `hints` (last
  four, account id, addresses), `verifiedAt` and `lastError` (redacted).
  Disconnecting wipes the sealed blob.
- **MerchantAuditLog**: one row for every create, credential save, verify,
  disconnect, fee change and refund. Each row names the service and its auth
  client, or the admin. It holds hints only.
- **Order** gains nullable `merchantId` and `merchantConnectionId`. Both are
  null on every INITE sale.

## Rails

| Rail | What the merchant brings | Ownership check (`verify`) | Webhook | Refund |
|---|---|---|---|---|
| lava.top | its own creator API key, webhook key, dynamic-price offer | `GET /api/v2/products`: the offer must be the account's | `X-Api-Key` = the merchant's webhook key (not the API key) | in the lava.top dashboard; billing records the `refund.success`/`chargeback` webhook |
| YooKassa | `shopId` + secret key (new adapter, `src/adapters/yookassa/`) | `GET /v3/me`: `account_id` must equal `shopId` | unsigned, so billing reads the payment back from the API with the merchant's credentials, and the status is the API's | `POST /v3/refunds` |
| Stripe | its own secret or restricted key (+ `whsec_` signing secret) | `GET /v1/account` | `Stripe-Signature` with the merchant's `whsec_` | `POST /v1/refunds` |
| Crypto | its own receiving addresses, no keys | each address must parse on its network | none; billing's watcher sees the chain | not possible (on-chain) |

Follow-ups:
- **Stripe Connect Standard** (OAuth, `connectAccountId`): the field is
  reserved and refused for now. It is the only rail that can take an
  `application_fee` natively.
- **PIX**: through the merchant's own provider. Hodle only fits if the
  merchant has its own Hodle account. Otherwise Mercado Pago or Stripe BR.

**Rails that cannot carry a merchant's money**, because on each of them INITE
would hold it: x402 and the INITE wallet, the treasury, Apple and Google IAP,
and INITE's own Hodle and lava.top accounts. A merchant's order is refused on
x402 and on pay-from-wallet.

## Routing

`POST /v1/service-checkout/sessions` with `merchantId` sells one open line
(`productCode` `shop-open`, `ref` = shop order id, no entitlement template).
`metadata.clientReference` is set to the ref. The order is offered only the
merchant's **verified** connections whose rail takes the currency and meets
the provider's minimum. There is no currency conversion and no markup on a
merchant's account. If no connection qualifies, the answer is 422. **Nothing
ever falls back to INITE's own provider accounts.** On payment, the rail's
adapter is bound to the merchant's credentials (`Connector.withCredentials`).
It reads no `PaymentProvider` row. The open product's daily cap for the
service still applies, and promo codes do not.

Every later read of a merchant's payment uses the merchant's connection,
never INITE's. That covers webhooks, the checkout page's "has it gone
through", refunds and admin refunds.

## Webhooks

- Provider to billing: `POST /v1/webhooks/merchant/:connectionId`. The request
  is verified with that connection's own secret, or by reading the payment
  back from the provider. It is stored under `MERCHANT:<connectionId>`. The
  processor matches it only to that merchant's orders. INITE's own
  `/webhooks/<rail>` never settles a merchant's order (crypto aside, where the
  evidence is the chain).
- Billing to the service: the existing signed outbox events. On a merchant's
  order they also carry `merchant_id`, `session_id`, `client_reference`,
  `amount` and `currency`.

## Refunds and chargebacks

`POST /v1/merchants/:merchantId/orders/:orderId/refund` goes through the
merchant's own connection only, and is serialised per order. The amount is
optional; leaving it out refunds the rest of the order. A full refund moves
the order to `refunded` through the orchestrator. A partial one leaves it
`paid` and is logged. Chargebacks happen on the merchant's account.
Billing records them when the provider reports them.

## Platform fee

`Merchant.platformFeeBps` defaults to 0. Only a billing admin can set it
(`PATCH /v1/admin/merchants/:id/platform-fee`), and it is shown in GET. No
rail deducts it today; only Stripe Connect could. Before a non-zero fee
means anything, the merchant must be told and a way to collect it must be
decided.

## KYC and ownership

The provider runs KYC on its own account holder. Billing proves that the
credentials open a live account (the `verify` call) and that its
notifications come from that account (per-connection secret or read-back).
Only a `verified` connection is routable or accepts webhooks. Replacing the
credentials resets the connection to `pending`.

## Security

- Credentials never leave billing. They are not in responses, logs or the
  audit log; a provider's error is redacted before it is stored.
- Everything is scoped to the calling service and the merchant. The service
  API needs an INITE Auth service token with the `billing:merchants` scope;
  checkout keeps `billing:checkout`.
- Activity is visible in `billing.merchant_audit_log`.
