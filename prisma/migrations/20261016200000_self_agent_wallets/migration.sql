-- Wallets owned by an AI agent's own key, and the payments it makes from them.
ALTER TABLE "billing"."wallets" ALTER COLUMN "credential_id" DROP NOT NULL;
ALTER TABLE "billing"."wallets" ADD COLUMN "owner_key" VARCHAR(130);

CREATE TABLE "billing"."wallet_payments" (
    "id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "url" VARCHAR(2000) NOT NULL,
    "call" JSONB NOT NULL,
    "terms" JSONB NOT NULL,
    "pay_to" VARCHAR(42) NOT NULL,
    "value_raw" VARCHAR(78) NOT NULL,
    "nonce" VARCHAR(66) NOT NULL,
    "valid_after" TIMESTAMPTZ(6) NOT NULL,
    "valid_before" TIMESTAMPTZ(6) NOT NULL,
    "request" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'prepared',
    "http_status" INTEGER,
    "tx_hash" VARCHAR(66),
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "wallet_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wallet_payments_nonce_key" ON "billing"."wallet_payments"("nonce");
CREATE INDEX "wallet_payments_wallet_id_created_at_idx" ON "billing"."wallet_payments"("wallet_id", "created_at");
ALTER TABLE "billing"."wallet_payments" ADD CONSTRAINT "wallet_payments_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "billing"."wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
