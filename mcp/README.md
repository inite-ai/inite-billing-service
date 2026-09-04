# @inite/billing-mcp

Billing for agents. Check what a customer is entitled to, charge them for the work, and hand back a payment link when they can't pay — as MCP tools.

```
check_entitlement  →  do the work  →  consume_credits
        │
        └── not granted → create_checkout_session → a URL to send them to
```

## Install

```jsonc
// Claude Desktop: ~/Library/Application Support/Claude/claude_desktop_config.json
// Cursor:         .cursor/mcp.json
{
  "mcpServers": {
    "inite-billing": {
      "command": "npx",
      "args": ["-y", "@inite/billing-mcp"],
      "env": {
        "INITE_API_KEY": "your service key"
      }
    }
  }
}
```

| Variable | |
|---|---|
| `INITE_API_KEY` | A service key. The module acts for its own customers and must name one (`user_id`). |
| `INITE_JWT` | A user token instead. Acts for that user only; a `user_id` argument is ignored. |
| `INITE_BILLING_URL` | Defaults to `https://billing.inite.ai`. Credentials are refused over plain HTTP unless the host is `localhost`. |

## Tools

| Tool | |
|---|---|
| `check_entitlement` | Does this customer hold `access.pro` right now? Answers `granted: false` rather than failing, so the agent can offer to sell instead of apologising. |
| `list_entitlements` | Everything they currently hold. |
| `get_credit_balance` | What is left. |
| `consume_credits` | Debit for work done. Takes `idempotency_key` — pass one. |
| `create_checkout_session` | Returns a URL to send the customer to. |
| `list_catalog` | What is for sale. |
| `list_subscriptions` | Their subscriptions and where each is in its lifecycle. |

### On `idempotency_key`

Agents retry. A model re-calls a tool whose answer it did not see; a transport times out and tries again. Without a key each of those is a second debit against a real customer. With one, the ledger records the charge once and every repeat returns the same balance.

Use something derived from the unit of work — the request id, the message id, a hash of the inputs — not a fresh random value per attempt, which defeats the point.

## What this process actually is

A bridge, not a second implementation. The tools live on the billing service and are served over HTTP at `/mcp`; this forwards stdio to that endpoint. Nothing is described in two places, so nothing drifts: a tool added to the service appears here on the next call, with the same schema and the same tenant scoping.

If you can reach the service over HTTP, you can skip this package entirely and point an MCP client straight at `https://billing.inite.ai/mcp` with the same credentials.

## Identity

Who the work is done for is decided by the credential, not the arguments:

- **User token** — acts for that user. A `user_id` argument is ignored rather than honoured, because an agent will pass one it read somewhere.
- **Service key** — must name the customer, and sees only its own service's entitlements, catalogue and balances.

## Licence

AGPL-3.0-or-later, same as the service.
