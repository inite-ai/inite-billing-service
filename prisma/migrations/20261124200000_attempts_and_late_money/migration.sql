-- Additive. The old index is replaced by a looser one, so the previous image
-- keeps its own rule: it never sets superseded_at, and for such rows both agree.
SET lock_timeout = '5s';
ALTER TABLE "billing"."payment_intents" ADD COLUMN "superseded_at" TIMESTAMPTZ(6);

CREATE UNIQUE INDEX IF NOT EXISTS "payment_intents_one_live_attempt"
  ON "billing"."payment_intents" ("order_id")
  WHERE "status" IN ('created', 'opened') AND "superseded_at" IS NULL;
DROP INDEX IF EXISTS "billing"."payment_intents_one_live_per_order";

CREATE TABLE "billing"."unapplied_payments" (
    "id" UUID NOT NULL,
    "payment_intent_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "rail" VARCHAR(50) NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "provider_ref" VARCHAR(255),
    "reason" VARCHAR(40) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "note" TEXT,
    "resolved_by" VARCHAR(255),
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "unapplied_payments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "unapplied_payments_payment_intent_id_key" ON "billing"."unapplied_payments"("payment_intent_id");
CREATE INDEX "unapplied_payments_status_created_at_idx" ON "billing"."unapplied_payments"("status", "created_at");
CREATE INDEX "unapplied_payments_order_id_idx" ON "billing"."unapplied_payments"("order_id");
ALTER TABLE "billing"."unapplied_payments" ADD CONSTRAINT "unapplied_payments_payment_intent_id_fkey"
  FOREIGN KEY ("payment_intent_id") REFERENCES "billing"."payment_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
RESET lock_timeout;
