-- Nullable columns only: no rewrite, no backfill, nothing reads them in the previous image.
SET lock_timeout = '5s';
ALTER TABLE "billing"."orders"
  ADD COLUMN "subscription_id" UUID,
  ADD COLUMN "period_start" TIMESTAMPTZ(6),
  ADD COLUMN "period_end" TIMESTAMPTZ(6);
ALTER TABLE "billing"."subscriptions" ADD COLUMN "billing_anchor" TIMESTAMPTZ(6);
RESET lock_timeout;
