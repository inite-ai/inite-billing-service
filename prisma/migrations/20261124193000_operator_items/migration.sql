-- One new table; nothing else changes.
CREATE TABLE "billing"."operator_items" (
    "id" UUID NOT NULL,
    "key" VARCHAR(255) NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "subscription_id" UUID,
    "order_id" UUID,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "note" TEXT,
    "resolved_by" VARCHAR(255),
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "operator_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "operator_items_key_key" ON "billing"."operator_items"("key");
CREATE INDEX "operator_items_status_created_at_idx" ON "billing"."operator_items"("status", "created_at");
