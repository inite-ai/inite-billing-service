# Development Environment

## Quick Start

```bash
# Start PostgreSQL and Redis in Docker
./start-dev.sh

# Or manually
docker-compose -f docker-compose.dev.yml up -d

# Then run service locally
npm install
npm run prisma:generate
npm run prisma:migrate
npm run start:dev
```

## Services

- **PostgreSQL**: `localhost:5433`
- **Redis**: `localhost:6380`
- **Billing Service**: `http://localhost:3000`
- **Swagger API Docs**: `http://localhost:3000/api`

## Environment Variables

Copy `.env.dev` to `.env`:
```bash
cp .env.dev .env
```

Or create `.env` manually:

```env
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/inite_billing?schema=billing
REDIS_URL=redis://redis:6379
JWT_SECRET=dev-jwt-secret-key-change-in-production
SERVICE_API_KEY=dev-service-api-key
ONE_API_KEY=test-key
ONE_API_SECRET=test-secret
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
```

## Database Setup

The service automatically runs migrations on startup. To manually run:

```bash
docker exec inite-billing-service-dev npx prisma migrate deploy
```

## View Logs

```bash
# All services
docker-compose -f docker-compose.dev.yml logs -f

# Billing service only
docker-compose -f docker-compose.dev.yml logs -f billing
```

## Stop Services

```bash
docker-compose -f docker-compose.dev.yml down

# Remove volumes (clean database)
docker-compose -f docker-compose.dev.yml down -v
```

## Development Workflow

1. Code changes are automatically reloaded (hot reload)
2. Database migrations run on startup
3. Swagger docs available at `/api`
4. Check logs for errors: `docker-compose -f docker-compose.dev.yml logs billing`

## Testing

```bash
# Run e2e tests (requires test database)
npm run test:e2e

# Run unit tests
npm test
```
