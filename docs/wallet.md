# INITE wallet

A person's own USDC on Base, opened from their INITE ID account. Billing opens
it and shows it; only the person's passkey can move money out of it. The full
design, with agents, is in `docs/design/agent-wallet.md`.

## Who holds what

| What | Where | Who can use it |
|---|---|---|
| The wallet's key | Turnkey, in a sub-organization of our organization | Only the sub-organization's root user: the person's passkey |
| The passkey | The person's devices (RP ID `inite.ai`) | The person |
| Billing's Turnkey key | Billing's database (`x402_relayer_keys`) | Billing, in our organization only: open a sub-organization, relay signed USDC authorizations |

Turnkey keeps sub-organizations apart, so billing's key has no standing
inside a wallet. The wallet is opened with no email, SMS or OTP sign-in:
there is no way in but the passkey.

## What the person does (INITE ID → account)

- **Open.** The browser makes a passkey for `inite.ai`; billing asks Turnkey
  for a sub-organization with that passkey as its only root user and one
  Ethereum account. Turnkey is not told who the person is.
- **Top up.**
  - From any wallet or exchange: USDC on Base to the address.
  - By PIX: billing opens a Hodle deposit with `asset: USDC, network: base`
    and the wallet's address. Hodle converts the reais and delivers USDC to
    the address. Its webhooks (`externalId` starting with `wallet-`) are only
    recorded; there is no order to settle.
  - Card top-ups come later, through an on-ramp that also delivers to the
    address.
- **Withdraw.** Billing prepares a USDC `transferWithAuthorization` from the
  wallet and the Turnkey request that signs it. The browser stamps that exact
  request with the passkey; billing passes it to Turnkey unchanged, gets the
  signature and sends it through the relayer, which pays the network fee.
  The wallet needs no ETH.

Billing never receives the money and has no key that can spend it.

## API

`/v1/wallet`, with the person's INITE access token. A token an agent holds for
the person (`act` in it) is refused: agents pay within their grant, they do
not manage the wallet.

| Request | What it does |
|---|---|
| `GET /v1/wallet` | The wallet, balance, recent top-ups and withdrawals; `canOpen`, `canWithdraw`, `topups.pix` |
| `POST /v1/wallet` | Open, with `{ passkey: { challenge, credentialId, clientDataJson, attestationObject, transports } }` (base64url) |
| `POST /v1/wallet/topups/pix` | `{ amount }` in reais, R$5–5 000; returns the PIX code |
| `GET /v1/wallet/topups/:id` | The top-up as Hodle reports it |
| `POST /v1/wallet/withdrawals` | `{ to, amount }`; returns `request` to stamp and the passkey's `credentialId` |
| `POST /v1/wallet/withdrawals/:id/confirm` | `{ stamp }`: the `X-Stamp-WebAuthn` value for `request` |

A withdrawal waits 15 minutes for the passkey. At most 10 withdrawals a day
per wallet, at least 0.01 USDC each; relayer fees count towards the x402 daily
budget.

## Setup

Nothing beyond x402's Turnkey setup (docs/x402.md): the same organization,
API user and key, plus the **INITE wallets** policy from the admin page. PIX
top-ups need the Hodle rail active, and Hodle delivery of USDC on Base to
external addresses enabled on our Hodle account.
