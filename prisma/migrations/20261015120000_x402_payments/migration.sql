-- x402 authorizations taken on for settlement; (payer, nonce) is single-use.
CREATE TABLE "billing"."x402_payments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "invoice_id" VARCHAR(255) NOT NULL,
    "payer" VARCHAR(64) NOT NULL,
    "nonce" VARCHAR(66) NOT NULL,
    "value_raw" VARCHAR(78) NOT NULL,
    "valid_before" TIMESTAMPTZ(6) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'claimed',
    "tx_hash" VARCHAR(66),
    "fee_wei" VARCHAR(78),
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "x402_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "x402_payments_payer_nonce_key" ON "billing"."x402_payments"("payer", "nonce");
CREATE INDEX "x402_payments_order_id_idx" ON "billing"."x402_payments"("order_id");
CREATE INDEX "x402_payments_created_at_idx" ON "billing"."x402_payments"("created_at");
