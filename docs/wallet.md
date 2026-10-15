# INITE wallet

A person's own USDC on Base, opened from their INITE ID account. Billing opens
it and shows it. Only the person's passkey can move money out of it, and so
can their AI agents within the limits the person approved with that passkey. The full
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

## AI agents

An agent pays from the wallet only after two approvals by the person:

1. **In INITE Auth**, on the consent screen, with a passkey. The agent's MCP
   client asks for the scope `wallet:pay`, which Auth turns into an
   `inite_wallet` grant with the default limits. The token names the agent in
   `act` (its `did:web`) and is issued for `/mcp/wallet` (`aud`).
2. **In the wallet**, from the account page, with the wallet passkey. The
   agent's first call records it as `pending`. The person sets its limits,
   prefilled from the grant, and stamps two Turnkey requests in their
   sub-organization:
   - `CREATE_USERS_V4`: the agent's user, with an API key billing generated
     for it (`wallet_agents`);
   - `CREATE_POLICY_V3`: that user may sign only EIP-712
     `TransferWithAuthorization` for USDC on Base, with
     `eth.eip_712.message['value'] <= per-payment limit`.

### Paying (`/mcp/wallet`, tool `pay`)

1. Billing requests the URL for the agent: https only, public addresses only,
   no redirects, the answer capped at 256 KB.
2. On `402` it reads the x402 terms (v2 header or v1 body) and takes the
   `exact` scheme in USDC on Base.
3. It checks:
   - `maxAmount`;
   - the per-payment limit;
   - the allowed sites;
   - the balance;
   - and, under a per-agent lock, the day (rolling 24 h) and month (calendar
     month, UTC) limits.

   Then it records the payment.
4. The agent's key signs the authorization in the person's wallet. Turnkey
   enforces the policy.
5. Billing repeats the request with `PAYMENT-SIGNATURE` (v2) or `X-PAYMENT`
   (v1) and returns the site's answer. The seller settles on chain.

A payment the site refused stays counted until its authorization expires. After that, billing asks the chain whether it was used and marks it `paid` or `expired`.

### Stopping an agent

- **Revoke** in the account erases the agent's key in billing, so it can sign
  nothing from then on.
- Disconnecting the app in INITE Auth retires the agent's DID. Billing checks
  the DID document (cached for a minute) on every call and revokes on 410.

### Agent API (`/mcp/wallet`, MCP over streamable HTTP)

| Tool | |
|---|---|
| `wallet_balance` | Balance, limits, spent and left today and this month; while pending, where the person approves |
| `wallet_address` | Address on Base for top-ups |
| `pay` | `{ url, method?, headers?, body?, maxAmount }` |
| `payments` | The agent's last 20 payments |

`GET /.well-known/oauth-protected-resource/mcp/wallet` is the RFC 9728
metadata: INITE Auth as the authorization server, scope `wallet:pay`.

### Person API for agents

| Request | |
|---|---|
| `GET /v1/wallet/agents` | Agents, their requested and approved limits, spending |
| `POST /v1/wallet/agents/:id/approve` | `{ perPayment, daily, monthly, merchants? }` → the next request to stamp |
| `POST /v1/wallet/agents/:id/approve/confirm` | `{ stamp }` → the policy request next, then the active agent |
| `POST /v1/wallet/agents/:id/revoke` | Erase the agent's key |

## Setup

Nothing beyond x402's Turnkey setup (docs/x402.md): the same organization,
API user and key, plus the **INITE wallets** policy from the admin page. PIX
top-ups need the Hodle rail active, and Hodle delivery of USDC on Base to
external addresses enabled on our Hodle account.
