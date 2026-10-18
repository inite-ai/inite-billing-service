#!/usr/bin/env bash
# Runs once when the dev container is created: dependencies, a dev .env and
# migrated dev + test databases. Safe to re-run.
set -euo pipefail

npm ci --no-audit --no-fund
npm --prefix mcp ci --no-audit --no-fund
(cd frontend && npm ci --no-audit --no-fund)

if [ ! -f .env ]; then
  cp env.example .env
  # Dev-only secrets, generated per container; never reuse them anywhere.
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 48)|" .env
  sed -i "s|^KEY_SEAL_SECRET=.*|KEY_SEAL_SECRET=$(openssl rand -base64 32)|" .env
fi

npx prisma migrate deploy
DATABASE_URL="$TEST_DATABASE_URL" npx prisma migrate deploy

echo "Ready. Gates and commands: AGENTS.md → Commands."
