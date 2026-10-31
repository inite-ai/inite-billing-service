-- Merchant-own payment accounts (docs/connected-accounts.md): a merchant a
-- service sells for, its sealed connections to its own provider accounts, and
-- an audit log. Additive only: new tables, and two nullable columns on orders
-- that every existing order leaves null.

-- CreateEnum
CREATE TYPE "billing"."MerchantConnectionStatus" AS ENUM ('pending', 'verified', 'failed', 'disconnected');

-- AlterTable
ALTER TABLE "billing"."orders" ADD COLUMN     "merchant_connection_id" UUID,
ADD COLUMN     "merchant_id" UUID;

-- CreateTable
CREATE TABLE "billing"."merchants" (
    "id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "org_id" VARCHAR(255) NOT NULL,
    "display_name" VARCHAR(255) NOT NULL,
    "external_ref" VARCHAR(255),
    "platform_fee_bps" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."merchant_connections" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "rail" VARCHAR(50) NOT NULL,
    "status" "billing"."MerchantConnectionStatus" NOT NULL DEFAULT 'pending',
    "sealed_credentials" TEXT,
    "hints" JSONB NOT NULL DEFAULT '{}',
    "verified_at" TIMESTAMPTZ(6),
    "last_error" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "merchant_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."merchant_audit_log" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "connection_id" UUID,
    "service_id" UUID,
    "actor" VARCHAR(255) NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "merchants_service_id_org_id_key" ON "billing"."merchants"("service_id", "org_id");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_connections_merchant_id_rail_key" ON "billing"."merchant_connections"("merchant_id", "rail");

-- CreateIndex
CREATE INDEX "merchant_audit_log_merchant_id_created_at_idx" ON "billing"."merchant_audit_log"("merchant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "orders_merchant_id_created_at_idx" ON "billing"."orders"("merchant_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "billing"."orders" ADD CONSTRAINT "orders_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "billing"."merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."orders" ADD CONSTRAINT "orders_merchant_connection_id_fkey" FOREIGN KEY ("merchant_connection_id") REFERENCES "billing"."merchant_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."merchants" ADD CONSTRAINT "merchants_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "billing"."services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."merchant_connections" ADD CONSTRAINT "merchant_connections_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "billing"."merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."merchant_audit_log" ADD CONSTRAINT "merchant_audit_log_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "billing"."merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

