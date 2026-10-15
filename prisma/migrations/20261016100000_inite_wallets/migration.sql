-- INITE wallets: a person's USDC on Base in a Turnkey sub-organization they alone control.
CREATE TABLE "billing"."wallets" (
    "id" UUID NOT NULL,
    "owner_did" VARCHAR(255) NOT NULL,
    "sub_organization_id" VARCHAR(64) NOT NULL,
    "turnkey_wallet_id" VARCHAR(64) NOT NULL,
    "address" VARCHAR(42) NOT NULL,
    "credential_id" VARCHAR(1024) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wallets_owner_did_key" ON "billing"."wallets"("owner_did");
CREATE UNIQUE INDEX "wallets_sub_organization_id_key" ON "billing"."wallets"("sub_organization_id");
CREATE UNIQUE INDEX "wallets_address_key" ON "billing"."wallets"("address");

CREATE TABLE "billing"."wallet_topups" (
    "id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "rail" VARCHAR(20) NOT NULL,
    "external_id" VARCHAR(255) NOT NULL,
    "value" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "qr_code" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "wallet_topups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wallet_topups_external_id_key" ON "billing"."wallet_topups"("external_id");
CREATE INDEX "wallet_topups_wallet_id_created_at_idx" ON "billing"."wallet_topups"("wallet_id", "created_at");
ALTER TABLE "billing"."wallet_topups" ADD CONSTRAINT "wallet_topups_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "billing"."wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "billing"."wallet_withdrawals" (
    "id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "to" VARCHAR(42) NOT NULL,
    "value_raw" VARCHAR(78) NOT NULL,
    "nonce" VARCHAR(66) NOT NULL,
    "valid_after" TIMESTAMPTZ(6) NOT NULL,
    "valid_before" TIMESTAMPTZ(6) NOT NULL,
    "request" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'prepared',
    "tx_hash" VARCHAR(66),
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "wallet_withdrawals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wallet_withdrawals_nonce_key" ON "billing"."wallet_withdrawals"("nonce");
CREATE INDEX "wallet_withdrawals_wallet_id_created_at_idx" ON "billing"."wallet_withdrawals"("wallet_id", "created_at");
ALTER TABLE "billing"."wallet_withdrawals" ADD CONSTRAINT "wallet_withdrawals_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "billing"."wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The relayer now also carries withdrawals: no order, no invoice.
ALTER TABLE "billing"."x402_payments" ALTER COLUMN "order_id" DROP NOT NULL;
ALTER TABLE "billing"."x402_payments" ALTER COLUMN "invoice_id" DROP NOT NULL;
ALTER TABLE "billing"."x402_payments" ADD COLUMN "withdrawal_id" UUID;
CREATE UNIQUE INDEX "x402_payments_withdrawal_id_key" ON "billing"."x402_payments"("withdrawal_id");
