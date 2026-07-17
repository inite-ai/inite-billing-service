# Development environment

Moved — see **[docs/getting-started.md](docs/getting-started.md)** for local
setup, environment variables, migrations, and running tests.

Quick reference:

```bash
docker compose up -d postgres redis   # pgvector postgres :5433, redis :6380
npm install && npm run prisma:migrate && npm run start:dev   # backend :3000, Swagger /api
cd frontend && npm install && npm run dev                    # frontend :3001
```
