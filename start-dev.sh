#!/bin/bash

# Start dev environment (only PostgreSQL and Redis)
echo "🚀 Starting INITE Billing Service dev environment..."

# Stop existing containers
docker-compose -f docker-compose.dev.yml down

# Start postgres and redis
echo "📦 Starting PostgreSQL and Redis..."
docker-compose -f docker-compose.dev.yml up -d

# Wait for services to be ready
echo "⏳ Waiting for services to be ready..."
sleep 5

# Create schema
echo "🗄️  Creating database schema..."
docker exec inite-billing-postgres-dev psql -U postgres -d inite_billing -c "CREATE SCHEMA IF NOT EXISTS billing;" 2>/dev/null || true

echo "✅ PostgreSQL: localhost:5433"
echo "✅ Redis: localhost:6381"
echo ""
echo "Now run the service locally:"
echo "  npm install"
echo "  npm run prisma:generate"
echo "  npm run prisma:migrate"
echo "  npm run start:dev"
