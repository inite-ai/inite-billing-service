-- The company a subscription is for, named by the trial that started it.
-- Nullable and unset on existing rows: their company is still derived from
-- the paid orders of the subscription, as before.
ALTER TABLE "billing"."subscriptions" ADD COLUMN "company_id" VARCHAR(128);
