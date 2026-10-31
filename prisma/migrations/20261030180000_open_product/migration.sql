-- An open product: sold at an amount and title its own service names per
-- checkout, within bounds the product sets. Additive only: a new enum value
-- and a new audit table; no existing row or column changes.

-- AlterEnum
ALTER TYPE "billing"."ProductType" ADD VALUE 'open';

-- CreateTable
CREATE TABLE "billing"."open_sale_audit" (
    "id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "client_id" VARCHAR(255),
    "product_code" VARCHAR(100) NOT NULL,
    "order_id" UUID,
    "user_id" VARCHAR(255) NOT NULL,
    "outcome" VARCHAR(20) NOT NULL,
    "reason" VARCHAR(255),
    "amount" DECIMAL(19,4),
    "currency" VARCHAR(10),
    "quantity" INTEGER,
    "title" VARCHAR(120),
    "ref" VARCHAR(100),
    "entitlement_key" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "open_sale_audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "open_sale_audit_service_id_created_at_idx" ON "billing"."open_sale_audit"("service_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "open_sale_audit_order_id_idx" ON "billing"."open_sale_audit"("order_id");

