# INITE Billing — Frontend

The web UI for the [INITE Billing Service](../README.md): customer dashboard
(subscriptions, orders, credits, referrals) and the `/admin` console (catalog,
providers, funnel, risk, payouts). It talks to the NestJS backend over HTTP and
authenticates end users via OAuth Authorization Code + PKCE against the identity
provider.

## Stack

- **Next.js 16** (App Router, Turbopack) · **React 19**
- **Tailwind CSS v4**
- **next-intl** — English & Russian (`messages/{en,ru}.json`)
- **axios** API client

## Quick start

```bash
npm install
cp .env.example .env.local     # then edit values (see below)
npm run dev                    # http://localhost:3001
```

The backend must be running and reachable at `NEXT_PUBLIC_API_URL` (default
`http://localhost:3000`). See the [root README](../README.md#quick-start) for the
backend + Postgres + Redis setup.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Dev server on :3001 (Turbopack) |
| `npm run build` | Production build |
| `npm run start` | Serve the production build on :3001 |
| `npm run lint` | ESLint (next lint) |

## Environment

Copy `.env.example` → `.env.local`. Full descriptions live in that file; summary:

| Variable | Scope | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | browser | Billing backend API base URL |
| `NEXT_PUBLIC_SITE_URL` | browser | Canonical URL of this app (SEO/OG) |
| `NEXT_PUBLIC_AUTH_SERVICE_URL` | browser | Identity provider base (starts the login redirect) |
| `NEXT_PUBLIC_OAUTH_CLIENT_ID` | browser | OAuth client id |
| `AUTH_SERVICE_URL` | server | Identity provider base for the token/refresh routes (falls back to the `NEXT_PUBLIC_` value) |
| `OAUTH_CLIENT_ID` | server | OAuth client id for token exchange (falls back to the `NEXT_PUBLIC_` value) |
| `OAUTH_CLIENT_SECRET` | server | Confidential-client secret; leave empty for a public (PKCE-only) client |

`NEXT_PUBLIC_*` values are inlined into the browser bundle — never put secrets
there. `OAUTH_CLIENT_SECRET` and the other unprefixed values are read only by the
server-side routes under `app/api/auth/*`.

## Auth flow

1. `lib/oauth-client.ts` starts an Authorization Code + PKCE redirect to
   `NEXT_PUBLIC_AUTH_SERVICE_URL` using `NEXT_PUBLIC_OAUTH_CLIENT_ID`.
2. The provider redirects back to `/callback`.
3. The server routes `app/api/auth/token` and `app/api/auth/refresh` exchange the
   code (and later refresh tokens) with `{AUTH_SERVICE_URL}` — adding
   `OAUTH_CLIENT_SECRET` when the client is confidential.

To use your own identity provider, point `*_AUTH_SERVICE_URL` at it (it must
expose `/.well-known/jwks.json`, which the backend uses to verify the issued
JWTs) and set the matching client id/secret.

## Internationalization

UI strings live in `messages/en.json` and `messages/ru.json` — **always add keys
to both**. Components read them via `useTranslations`.
