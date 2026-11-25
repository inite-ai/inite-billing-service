-- The part of a credit balance that expires with its period. Existing balances
-- start at 0, so all of what they hold is purchased and none of it expires
-- because of this change.
ALTER TABLE "billing"."credit_balances" ADD COLUMN "period_balance" INTEGER NOT NULL DEFAULT 0;
