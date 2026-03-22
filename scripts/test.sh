#!/usr/bin/env bash
set -euo pipefail

# ── Config ──
POSTGRES_CONTAINER="inite-billing-test-pg"
REDIS_CONTAINER="inite-billing-test-redis"
PG_PORT=5433
REDIS_PORT=6381
DB_NAME="inite_billing_test"
DB_USER="postgres"
DB_PASS="postgres"

export DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:${PG_PORT}/${DB_NAME}?schema=billing"
export REDIS_URL="redis://localhost:${REDIS_PORT}"
export JWT_SECRET="test-jwt-secret"
export NODE_ENV="test"

cleanup() {
  echo "Cleaning up test containers..."
  docker rm -f "$POSTGRES_CONTAINER" "$REDIS_CONTAINER" 2>/dev/null || true
}

trap cleanup EXIT

# ── Start containers ──
echo "Starting test Postgres on port ${PG_PORT}..."
docker rm -f "$POSTGRES_CONTAINER" 2>/dev/null || true
docker run -d --name "$POSTGRES_CONTAINER" \
  -e POSTGRES_DB="$DB_NAME" \
  -e POSTGRES_USER="$DB_USER" \
  -e POSTGRES_PASSWORD="$DB_PASS" \
  -p "${PG_PORT}:5432" \
  postgres:15-alpine >/dev/null

echo "Starting test Redis on port ${REDIS_PORT}..."
docker rm -f "$REDIS_CONTAINER" 2>/dev/null || true
docker run -d --name "$REDIS_CONTAINER" \
  -p "${REDIS_PORT}:6379" \
  redis:7-alpine >/dev/null

# ── Wait for Postgres ──
echo -n "Waiting for Postgres"
for i in $(seq 1 30); do
  if docker exec "$POSTGRES_CONTAINER" pg_isready -U "$DB_USER" -q 2>/dev/null; then
    echo " ready!"
    break
  fi
  echo -n "."
  sleep 1
  if [ "$i" -eq 30 ]; then
    echo " timeout!"
    exit 1
  fi
done

# ── Wait for Redis ──
echo -n "Waiting for Redis"
for i in $(seq 1 15); do
  if docker exec "$REDIS_CONTAINER" redis-cli ping 2>/dev/null | grep -q PONG; then
    echo " ready!"
    break
  fi
  echo -n "."
  sleep 1
done

# ── Prisma ──
echo "Pushing schema to test database..."
npx prisma db push --skip-generate --accept-data-loss 2>&1 | tail -3

# ── Run tests ──
echo ""
echo "Running tests..."
npx jest --forceExit "$@"
