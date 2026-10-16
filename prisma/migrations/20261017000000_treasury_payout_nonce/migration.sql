-- Each payout attempt's nonce and expiry, saved before signing, so a retry
-- happens only when the chain shows the earlier attempt can never be used.
ALTER TABLE "billing"."treasury_payouts" ALTER COLUMN "status" SET DEFAULT 'signing';
ALTER TABLE "billing"."treasury_payouts" ADD COLUMN "nonce" VARCHAR(66);
ALTER TABLE "billing"."treasury_payouts" ADD COLUMN "valid_before" TIMESTAMPTZ(6);
ALTER TABLE "billing"."treasury_payouts" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "treasury_payouts_nonce_key" ON "billing"."treasury_payouts"("nonce");
