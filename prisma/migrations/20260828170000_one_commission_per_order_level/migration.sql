-- One commission per (order, affiliate, level).
--
-- Double payment of a referral is prevented today by a single boolean on the
-- referral row (`first_order_paid`), set by a check-and-set inside the money
-- transaction. That guard is correct, but it is one flag in one code path, and
-- the orchestrator now lets a commission failure roll the money transaction back
-- so the webhook can retry it — which is only safe if a retry cannot leave two
-- commissions behind. This constraint is what makes that true regardless of
-- which path creates them.
--
-- Partial, excluding voided rows: a refunded order voids its commissions, and if
-- that order is ever paid again the new commission must be free to exist
-- alongside the void it replaces. Prisma has no schema DSL for partial indexes,
-- so this is raw SQL like the other hand-written migrations here.
--
-- Safe to apply: production has no duplicated commissions (audited when the
-- one-fulfilment-per-order constraints were added).
CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_commissions_one_per_order_level"
  ON "billing"."affiliate_commissions" ("order_id", "affiliate_id", "level")
  WHERE "status" <> 'voided';
