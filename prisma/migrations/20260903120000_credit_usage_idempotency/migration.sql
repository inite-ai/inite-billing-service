-- Charge a customer once per idempotency key.
--
-- Credits are debited by callers that retry on their own: an HTTP client after
-- a timeout, and now an AI agent that decides to call a tool a second time
-- because the first answer did not arrive. Every one of those retries was a
-- second debit, with nothing in the ledger to tell them apart from two genuine
-- charges.
--
-- The lookup runs behind the balance row lock `consume` already takes, so the
-- check and the insert cannot interleave. This index is the backstop for any
-- path that ever reaches the insert without that lock — and it is partial,
-- because the column is null for every charge that does not carry a key.
--
-- Scoped per user: two customers may legitimately choose the same key.
ALTER TABLE "billing"."credit_usages"
  ADD COLUMN IF NOT EXISTS "idempotency_key" VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS "credit_usages_one_charge_per_idempotency_key"
  ON "billing"."credit_usages" ("user_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
