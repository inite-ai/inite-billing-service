# INITE Billing Service

Production-ready payment-rail agnostic billing and subscriptions service built with NestJS.

## Overview

The INITE Billing Service is the single gateway for money, subscriptions, and entitlements across all INITE modules (club/events/education/health/shop/studio/estate). Product modules NEVER integrate with payment providers directly - they call this service.

### Key Features

- **Payment-Rail Agnostic**: Unified interface for multiple payment providers (ONE, Crypto, future: x402, etc.)
- **Extensible Adapter Pattern**: Easy to add new payment rails via `PaymentRailAdapter` interface
- **Unified State Machine**: All payment rails map to a single state machine
- **Idempotent Operations**: Safe retries for checkout creation, webhook processing, state transitions
- **Outbox Pattern**: Reliable event publishing via `billing.outbox_events`
- **Background Workers**: BullMQ-based webhook processing and outbox publishing
- **Entitlement Management**: Centralized entitlements based on subscriptions/orders
- **Subscription Lifecycle**: Full subscription management with grace periods and trials
- **Affiliate Program**: Self-service affiliate system with 50% commission on first payment, NET-15 payouts
- **Comprehensive Testing**: Unit tests and E2E tests with mocked payment providers

## Architecture

### Core Components

1. **Payment Rail Adapters**: Pluggable adapters for payment providers (ONE, Crypto stub, future: x402)
2. **Payment Orchestrator**: Coordinates adapters, applies state machine, manages entitlements
3. **Catalog Module**: Products and prices management
4. **Checkout Module**: Session creation and payment intent initialization
5. **Webhook Module**: Receives and stores webhook events from payment providers
6. **Workers Module**: Background processing for webhooks and outbox events
7. **Subscriptions Module**: Subscription lifecycle management
8. **Entitlements Module**: Access control based on purchases/subscriptions
9. **Affiliates Module**: Affiliate program with referral tracking, commissions, and automatic payouts

### State Machine

Unified payment intent states:
- `created` → `opened` → `paid` / `failed` / `expired`
- `paid` → `refunded`

All rails map their statuses to these unified states.

## Prerequisites

- Node.js 18+
- PostgreSQL 15+
- Redis 7+
- npm or yarn

## Quick Start

### 1. Clone and Install

```bash
cd inite-billing-service
npm install
```

### 2. Setup Database

Create the billing schema:

```sql
CREATE SCHEMA IF NOT EXISTS billing;
```

### 3. Configure Environment

Copy `env.example` to `.env` and configure:

```bash
cp env.example .env
```

Edit `.env` with your configuration:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/inite_billing?schema=billing
REDIS_URL=redis://localhost:6380
JWT_SECRET=your-jwt-secret
ONE_API_KEY=your-one-api-key
ONE_API_SECRET=your-one-api-secret
```

### 4. Run with Docker Compose

```bash
# Start PostgreSQL and Redis
docker-compose up -d

# Generate Prisma client
npm run prisma:generate

# Run migrations
npm run prisma:migrate

# Start development server
npm run start:dev
```

The service will be available at `http://localhost:3000`
Swagger documentation: `http://localhost:3000/api`

## Database Setup

### Create Schema

```sql
CREATE SCHEMA IF NOT EXISTS billing;
```

### Run Migrations

```bash
# Generate migration
npm run prisma:migrate

# Apply migrations (production)
npm run prisma:migrate:deploy
```

### Prisma Studio (optional)

```bash
npm run prisma:studio
```

## Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Yes | - |
| `REDIS_URL` | Redis connection string | Yes | `redis://localhost:6379` |
| `JWT_SECRET` | JWT secret key (HS256) | Yes* | - |
| `JWT_PUBLIC_KEY` | JWT public key (RS256) | Yes* | - |
| `SERVICE_API_KEY` | Service-to-service API key | No | - |
| `ONE_API_BASE_URL` | ONE API base URL | Yes (if using ONE) | `https://api.one.lat` |
| `ONE_API_KEY` | ONE API key | Yes (if using ONE) | - |
| `ONE_API_SECRET` | ONE API secret | Yes (if using ONE) | - |
| `BILLING_WEBHOOK_URLS` | Comma-separated webhook URLs | No | - |
| `FEATURE_CRYPTO_MODE` | Crypto adapter mode | No | `ONCHAIN_INVOICE` |
| `PORT` | Server port | No | `3000` |
| `NODE_ENV` | Environment | No | `development` |

*Either `JWT_SECRET` or `JWT_PUBLIC_KEY` is required

## API Endpoints

### Catalog

- `GET /v1/products` - List active products
- `GET /v1/prices?product_code=...` - List prices (optionally filtered)

### Checkout

- `POST /v1/checkout/session` - Create checkout session
  - Headers: `idempotency-key` (optional)
  - Body: `{ priceCode, mode, rail?, successUrl?, errorUrl?, metadata? }`

### Orders

- `GET /v1/orders/me?status=...` - Get user orders
- `GET /v1/orders/:id` - Get order by ID
- `GET /v1/payment-intents/:id` - Get payment intent by ID

### Subscriptions

- `GET /v1/subscriptions/me` - Get user subscriptions
- `POST /v1/subscriptions/cancel` - Cancel subscription
- `POST /v1/subscriptions/resume` - Resume subscription

### Entitlements

- `GET /v1/entitlements/me` - Get user entitlements
- `GET /v1/entitlements/:userId` - Get user entitlements (admin/service)

### Webhooks

- `POST /webhooks/one` - ONE payment webhook
- `POST /webhooks/crypto` - Crypto payment webhook (stub)

### Affiliates

- `POST /v1/affiliates` - Create or get affiliate account
- `GET /v1/affiliates/me` - Get current user affiliate account
- `GET /v1/affiliates/me/stats` - Get affiliate statistics
- `GET /v1/affiliates/me/referrals` - Get referrals
- `GET /v1/affiliates/me/commissions` - Get commissions
- `GET /v1/affiliates/me/payouts` - Get payouts

## Authentication

### User Requests (JWT)

```bash
curl -H "Authorization: Bearer <jwt-token>" \
  http://localhost:3000/v1/products
```

JWT payload should contain:
- `sub`: user ID (uuid)
- `roles`: array of role strings (optional)

### Service-to-Service (API Key)

```bash
curl -H "x-api-key: <service-api-key>" \
  http://localhost:3000/v1/entitlements/:userId
```

## Example Usage

### Create Checkout Session

```bash
curl -X POST http://localhost:3000/v1/checkout/session \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -H "idempotency-key: unique-key-123" \
  -d '{
    "priceCode": "club_member_monthly",
    "mode": "SUBSCRIPTION",
    "rail": "ONE",
    "successUrl": "https://app.inite.ai/success",
    "errorUrl": "https://app.inite.ai/error"
  }'
```

Response:
```json
{
  "orderId": "uuid",
  "paymentIntentId": "uuid",
  "checkoutUrl": "https://checkout.one.lat/..."
}
```

### Get User Entitlements

```bash
curl -H "Authorization: Bearer <jwt-token>" \
  http://localhost:3000/v1/entitlements/me
```

## Adding New Payment Rails

1. Implement `PaymentRailAdapter` interface:

```typescript
export class NewRailAdapter implements PaymentRailAdapter {
  rail(): string { return 'NEW_RAIL'; }
  
  async createPaymentIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    // Implementation
  }
  
  async getIntentStatus(providerIntentId: string): Promise<IntentStatusResult> {
    // Implementation
  }
}
```

2. Register adapter in `main.ts`:

```typescript
const newAdapter = app.get(NewRailAdapter);
orchestrator.registerAdapter(newAdapter);
```

3. Add webhook endpoint (if provider pushes webhooks):

```typescript
@Post('new-rail')
async handleNewRailWebhook(@Body() payload: any) {
  // Parse and store webhook
}
```

## Testing

### Unit Tests

```bash
# Run unit tests
npm test

# Watch mode
npm run test:watch

# Coverage
npm run test:cov
```

### E2E Tests

E2E tests cover the full payment flow, affiliates, webhooks, and state transitions. ONE and Stripe adapters are mocked.

**Setup:**
```bash
# Create test database
createdb inite_billing_test

# Create schema
psql inite_billing_test -c "CREATE SCHEMA IF NOT EXISTS billing;"

# Run migrations on test DB
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/inite_billing_test?schema=billing npm run prisma:migrate
```

**Run tests:**
```bash
# Run all e2e tests
npm run test:e2e

# Watch mode
npm run test:e2e:watch
```

See `test/README.md` for detailed test documentation.

## Development

```bash
# Start in development mode
npm run start:dev

# Build for production
npm run build

# Start production server
npm run start:prod
```

## Affiliate Program

The service includes a self-service affiliate program similar to [Blotato's affiliate system](https://help.blotato.com/settings/affiliates):

### Features

- **50% Commission**: Earn 50% on every referred customer's first payment
- **Self-Service**: Users can create affiliate accounts and get referral links
- **Automatic Tracking**: Referrals are tracked when users sign up or checkout with referral code
- **NET-15 Payouts**: Automatic payouts generated 15 days after the end of each month
- **Real-time Stats**: Track referrals, commissions, and upcoming payouts

### How It Works

1. User creates affiliate account via `POST /v1/affiliates`
2. Gets unique referral code and referral URL
3. Shares referral link (e.g., `https://app.inite.ai?ref=ABC12345`)
4. When referred user makes first payment, affiliate earns 50% commission
5. Commissions are automatically grouped into monthly payouts (NET-15)

### Example

```bash
# Create affiliate account
curl -X POST http://localhost:3000/v1/affiliates \
  -H "Authorization: Bearer <jwt-token>" \
  -d '{}'

# Response includes referralCode and referralUrl
# Share: https://app.inite.ai?ref=ABC12345

# Get stats
curl -H "Authorization: Bearer <jwt-token>" \
  http://localhost:3000/v1/affiliates/me/stats
```

## Database Schema

The service uses Prisma with PostgreSQL. Key tables:

- `billing.products` - Product catalog
- `billing.prices` - Pricing tiers
- `billing.orders` - Purchase orders
- `billing.payment_intents` - Payment attempts (rail-agnostic)
- `billing.subscriptions` - Active subscriptions
- `billing.entitlements` - User access rights
- `billing.invoices` - Payment receipts
- `billing.webhook_events` - Incoming webhooks
- `billing.outbox_events` - Outgoing events (outbox pattern)
- `billing.affiliates` - Affiliate accounts
- `billing.referrals` - Referral tracking
- `billing.affiliate_commissions` - Commission records
- `billing.affiliate_payouts` - Payout records

See `prisma/schema.prisma` for full schema.

## Background Workers

The service uses BullMQ for background job processing:

1. **Webhook Processor**: Processes webhook events from payment providers
2. **Outbox Processor**: Publishes outbox events (currently logs, extendable to message bus)
3. **Affiliate Payout Processor**: Generates monthly payouts for affiliates (NET-15)

Workers run automatically when the service starts. The affiliate payout processor runs daily via cron job to check for pending payouts.

## Idempotency

The service ensures idempotency for:

- **Checkout creation**: Use `idempotency-key` header
- **Webhook processing**: Unique constraint on `(rail, webhook_id)`
- **State transitions**: No-op if already in target state

## License

UNLICENSED - Private

