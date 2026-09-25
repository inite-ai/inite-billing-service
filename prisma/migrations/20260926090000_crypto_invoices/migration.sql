-- Crypto invoices (unique-amount reservation) and observed incoming transfers.

-- CreateTable
CREATE TABLE "billing"."crypto_invoices" (
    "id" UUID NOT NULL,
    "invoice_id" VARCHAR(255) NOT NULL,
    "order_id" VARCHAR(255),
    "chain" VARCHAR(20) NOT NULL,
    "token" VARCHAR(20) NOT NULL,
    "receiver_address" VARCHAR(255) NOT NULL,
    "receiver_key" VARCHAR(255) NOT NULL,
    "base_amount_raw" VARCHAR(78) NOT NULL,
    "amount_raw" VARCHAR(78) NOT NULL,
    "decimals" INTEGER NOT NULL,
    "memo" VARCHAR(64),
    "status" VARCHAR(20) NOT NULL DEFAULT 'awaiting',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "tx_hash" VARCHAR(255),
    "confirmations" INTEGER NOT NULL DEFAULT 0,
    "paid_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "crypto_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."crypto_transfers" (
    "id" UUID NOT NULL,
    "chain" VARCHAR(20) NOT NULL,
    "tx_hash" VARCHAR(255) NOT NULL,
    "token" VARCHAR(20) NOT NULL,
    "from_address" VARCHAR(255),
    "to_address" VARCHAR(255) NOT NULL,
    "amount_raw" VARCHAR(78) NOT NULL,
    "decimals" INTEGER NOT NULL,
    "confirmations" INTEGER NOT NULL DEFAULT 0,
    "is_final" BOOLEAN NOT NULL DEFAULT false,
    "block_time" TIMESTAMPTZ(6),
    "source" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "invoice_id" UUID,
    "suggested_invoice_id" UUID,
    "note" TEXT,
    "resolved_by" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "crypto_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crypto_invoices_invoice_id_key" ON "billing"."crypto_invoices"("invoice_id");

-- CreateIndex
CREATE INDEX "crypto_invoices_chain_status_idx" ON "billing"."crypto_invoices"("chain", "status");

-- CreateIndex
CREATE INDEX "crypto_invoices_status_expires_at_idx" ON "billing"."crypto_invoices"("status", "expires_at");

-- CreateIndex
CREATE INDEX "crypto_transfers_status_created_at_idx" ON "billing"."crypto_transfers"("status", "created_at");

-- CreateIndex
CREATE INDEX "crypto_transfers_invoice_id_idx" ON "billing"."crypto_transfers"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "crypto_transfers_chain_tx_hash_token_key" ON "billing"."crypto_transfers"("chain", "tx_hash", "token");

-- AddForeignKey
ALTER TABLE "billing"."crypto_transfers" ADD CONSTRAINT "crypto_transfers_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "billing"."crypto_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- No two invoices that can still be paid may ask for the same amount of the
-- same token to the same wallet: an ERC-20/TRC-20 transfer carries nothing but
-- its amount, so the amount is the only thing that identifies the invoice.
-- Partial, because a paid, expired or cancelled invoice gives its amount back.
CREATE UNIQUE INDEX "crypto_invoices_live_amount"
  ON "billing"."crypto_invoices" ("chain", "token", "receiver_key", "amount_raw")
  WHERE "status" IN ('awaiting', 'confirming');
