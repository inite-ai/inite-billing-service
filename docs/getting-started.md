# Getting started

Local development setup for the INITE Billing Service. Node 22+, Docker, and
an Anthropic API key (for the assistant) are expected.

## 1. Install

```bash
git clone git@github.com:inite-ai/inite-billing-service.git
cd inite-billing-service
npm install                    # postinstall runs prisma generate
```

## 2. Infrastructure

```bash
docker compose up -d postgres redis
```

This starts:

| Service | Image | Host port |
|---|---|---|
| PostgreSQL | `pgvector/pgvector:pg15` | 5433 |
| Redis | `redis:7-alpine` | 6380 |

> **pgvector is required.** The embeddings migration runs
> `CREATE EXTENSION vector` — a plain `postgres` image will fail to migrate.

## 3. Environment

```bash
cp env.example .env
$EDITOR .env
```

Key groups (see `env.example` for the full annotated list):

| Group | Variables | Notes |
|---|---|---|
| Core | `DATABASE_URL`, `REDIS_URL`, `PORT` | defaults match docker-compose |
| Auth | `JWT_SECRET` **or** `JWT_PUBLIC_KEY` | RS256 via JWKS from auth.inite.ai in prod |
| Anthropic | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | model defaults to `claude-sonnet-4-5` |
| Email | `RESEND_API_KEY`, `EMAIL_FROM`, `NOTIFICATIONS_EMAIL_ENABLED` | email is **off** by default |
| Outreach | `OUTREACH_ENABLED`, `OUTREACH_TRIGGERS`, `OUTREACH_MAX_PER_USER_7D` | off by default |
| Embeddings | `OPENAI_API_KEY`, `EMBEDDINGS_ENABLED` | off by default; ILIKE fallback |
| Risk | `RISK_BLOCKING_ENABLED`, `RISK_*` thresholds | monitor-only by default |

Payment-provider credentials are **not** env variables — they live in the
database (`payment_providers.config`) and are configured through the admin UI.

## 4. Migrate & run

```bash
npm run prisma:migrate         # dev migration (creates/applies)
npm run start:dev              # hot-reloading backend on :3000
```

- Swagger: http://localhost:3000/api (non-production only)
- Health: http://localhost:3000/health

## 5. Frontend

```bash
cd frontend
npm install
npm run dev                    # Next.js on :3001
```

The frontend authenticates against auth.inite.ai via OAuth PKCE; locale
switcher (EN/RU) sets the `locale` cookie which the backend captures for
localized notifications.

## Running tests

```bash
npm test          # spins throwaway dockerized PG (pgvector) + Redis via scripts/test.sh
npm run test:ci   # jest only — expects DATABASE_URL/REDIS_URL of a prepared test DB
npm run eval      # AI golden-dialog evals (needs ANTHROPIC_API_KEY; costs tokens)
```

`scripts/test.sh` uses host ports **5433** (postgres) and **6381** (redis).
If those ports are taken on your machine, point the suite at your own
containers instead:

```bash
TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:<pg-port>/inite_billing_test?schema=billing" \
TEST_REDIS_URL="redis://localhost:<redis-port>" \
npx jest --forceExit --runInBand
```

(`test/setup-e2e.ts` honors `TEST_DATABASE_URL` / `TEST_REDIS_URL` overrides.)

## Everyday commands

```bash
npm run start:dev            # dev server (watch)
npm run build                # compile
npm run lint                 # eslint --fix over src+test
npm run prisma:studio        # DB browser
npm run prisma:migrate       # create/apply a dev migration
npx prisma migrate deploy    # apply committed migrations (prod-style)
```

## Troubleshooting

- **Migration fails with `type "vector" does not exist`** — your postgres has
  no pgvector; use the `pgvector/pgvector:pg15` image from docker-compose.
- **`npm test` fails to bind :5433/:6381** — another container owns the port;
  use the `TEST_*` override above.
- **Assistant returns 404 from Anthropic** — check `ANTHROPIC_MODEL`; use the
  `claude-sonnet-4-5` alias or a valid dated snapshot.
- If setup breaks in any other way, **file an issue** — that usually means
  this doc is wrong.
