-- Family subscriptions (inite-shared .planning/family-subscriptions-2026-10.md §3.3).
-- Additive only: three nullable columns, no data is written.

-- A per-service webhook secret, sealed at rest, for services that sign in
-- with an INITE Auth token and hold no static key.
ALTER TABLE "billing"."services" ADD COLUMN "webhook_secret" VARCHAR(512);

-- A plan change waiting for the end of the period, and the renewal order
-- billing opened for a subscription on a rail that cannot recur.
ALTER TABLE "billing"."subscriptions" ADD COLUMN "pending_price_id" UUID;
ALTER TABLE "billing"."subscriptions" ADD COLUMN "renewal_order_id" UUID;
