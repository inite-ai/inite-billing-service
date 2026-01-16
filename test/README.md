# E2E Tests for INITE Billing Service

## Overview

End-to-end tests for the billing service covering:
- Catalog (products, prices)
- Checkout (session creation, idempotency, referral codes)
- Payment flows (state transitions, entitlements, refunds)
- Affiliates (creation, commissions, payouts)
- Webhooks (ONE, Crypto)
- Orders (retrieval, filtering)

## Setup

### Prerequisites

- PostgreSQL 15+ running (test database)
- Redis 7+ running (for BullMQ queues)
- Test database schema created

### Environment

Create `.env.test` file:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/inite_billing_test?schema=billing
REDIS_URL=redis://localhost:6380
JWT_SECRET=test-jwt-secret
FRONTEND_URL=https://app.inite.ai
ONE_API_BASE_URL=https://api.one.lat
ONE_API_KEY=test-key
ONE_API_SECRET=test-secret
```

### Database Setup

```bash
# Create test database
createdb inite_billing_test

# Create schema
psql inite_billing_test -c "CREATE SCHEMA IF NOT EXISTS billing;"

# Run migrations
npm run prisma:migrate
```

## Running Tests

```bash
# Run all e2e tests
npm run test:e2e

# Run in watch mode
npm run test:e2e:watch

# Run specific test file
npm run test:e2e -- checkout.e2e-spec.ts
```

## Test Structure

### Mocks

- `mocks/auth.mock.ts` - Mock JWT guard for authentication
- `mocks/one-adapter.mock.ts` - Mock ONE payment adapter (no real API calls)
  - Implements `PaymentRailAdapter` interface
  - Mocks `createPaymentIntent`, `getIntentStatus`, `handleWebhook`
  - Helper methods: `setIntentStatus()`, `clearMocks()`, `getAllMockIntents()`
  - No real API calls to ONE.lat
- `mocks/stripe-adapter.mock.ts` - Mock Stripe adapter (placeholder for future)
  - Same interface as MockOneAdapter
  - Maps Stripe statuses to unified statuses
  - Ready to use when Stripe integration is added

### Test Files

- `catalog.e2e-spec.ts` - Product and price catalog tests
- `checkout.e2e-spec.ts` - Checkout session creation tests
- `payment-flow.e2e-spec.ts` - Payment state machine and transitions
- `affiliates.e2e-spec.ts` - Affiliate program tests
- `webhooks.e2e-spec.ts` - Webhook processing tests
- `orders.e2e-spec.ts` - Order retrieval tests

## Test Coverage

### ✅ Covered

- Checkout session creation (one-time, subscription)
- Idempotency for checkout
- Referral code tracking
- Payment state transitions (created → opened → paid)
- Entitlement granting on payment
- Entitlement revocation on refund
- Affiliate account creation
- Commission calculation (50% first payment)
- Webhook idempotency
- Order filtering and retrieval

### 🔄 Not Covered (Future)

- Subscription lifecycle (renewals, cancellations)
- Affiliate payout generation (NET-15)
- Multiple payment rails simultaneously
- Complex entitlement scenarios

## Notes

- **ONE adapter is mocked** - `MockOneAdapter` implements `PaymentRailAdapter`, no real API calls to ONE.lat
- **Crypto adapter is stub** - always returns mock data (no real blockchain calls)
- **Stripe adapter mock** - `MockStripeAdapter` available in `mocks/stripe-adapter.mock.ts` (ready for future Stripe integration)
- Tests use test database (separate from dev)
- Each test cleans up its data in `afterEach`/`afterAll`
- Test timeout: 30 seconds

## MockOneAdapter Features

- `createPaymentIntent()` - Creates mock payment intent with unique ID
- `getIntentStatus()` - Returns status from mock storage
- `setIntentStatus()` - Helper to change intent status for testing transitions
- `clearMocks()` - Clears all mock intents (called in beforeEach)
- `handleWebhook()` - Parses webhook payloads
- `getAllMockIntents()` - Debug helper to see all mocks
