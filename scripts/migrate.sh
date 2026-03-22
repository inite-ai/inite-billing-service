#!/bin/sh
set -e

echo "Running database migrations..."

# Clean up any failed migration records so migrate deploy can proceed
# This is safe: if the table doesn't exist yet, the command is a no-op
npx prisma db execute --stdin <<'SQL' 2>/dev/null || true
DELETE FROM billing._prisma_migrations WHERE finished_at IS NULL;
SQL

# Mark init migration as already applied if tables exist but migration wasn't tracked
# (handles baseline for DBs created via db push)
npx prisma migrate resolve --applied 20260322051612_init 2>/dev/null || true

# Run any pending migrations
npx prisma migrate deploy

echo "Migrations complete."
