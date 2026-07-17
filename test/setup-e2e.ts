// E2E test setup
// This file runs before all e2e tests

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5433/inite_billing_test?schema=billing';
process.env.REDIS_URL = process.env.TEST_REDIS_URL || 'redis://localhost:6381';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.FRONTEND_URL = 'https://app.inite.ai';

// Increase timeout for e2e tests
jest.setTimeout(30000);
