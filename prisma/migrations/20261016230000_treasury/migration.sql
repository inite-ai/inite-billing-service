-- INITE's treasury for card top-ups of INITE wallets, and its payouts.
CREATE TABLE "billing"."treasury" (
    "id" UUID NOT NULL,
    "sub_organization_id" VARCHAR(64) NOT NULL,
    "address" VARCHAR(42) NOT NULL,
    "turnkey_user_id" VARCHAR(64) NOT NULL,
    "signer_public_key" VARCHAR(130) NOT NULL,
    "signer_private_key" VARCHAR(64) NOT NULL,
    "per_transfer" VARCHAR(20) NOT NULL,
    "daily_limit" VARCHAR(20) NOT NULL,
    "retired_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "treasury_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "treasury_sub_organization_id_key" ON "billing"."treasury"("sub_organization_id");
CREATE UNIQUE INDEX "treasury_address_key" ON "billing"."treasury"("address");

CREATE TABLE "billing"."treasury_payouts" (
    "id" UUID NOT NULL,
    "treasury_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "to" VARCHAR(42) NOT NULL,
    "value_raw" VARCHAR(78) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "tx_hash" VARCHAR(66),
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "treasury_payouts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "treasury_payouts_order_id_key" ON "billing"."treasury_payouts"("order_id");
CREATE INDEX "treasury_payouts_treasury_id_created_at_idx" ON "billing"."treasury_payouts"("treasury_id", "created_at");
ALTER TABLE "billing"."treasury_payouts" ADD CONSTRAINT "treasury_payouts_treasury_id_fkey" FOREIGN KEY ("treasury_id") REFERENCES "billing"."treasury"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
