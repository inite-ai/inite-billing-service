-- Make "one per user per service" true when the service is the platform itself.
--
-- Postgres treats NULLs as distinct, so `UNIQUE (user_id, service_id)` stops
-- nothing once service_id is NULL — and NULL is exactly how a platform-wide
-- affiliate, referral, credit balance or quota is stored. Two credit balances
-- for the same user split their credits between rows, and whichever the code
-- happens to read reports "insufficient" while the other holds the money. Two
-- affiliates give one person two referral codes and two commission ledgers.
--
-- Expressed with COALESCE rather than `NULLS NOT DISTINCT` so the constraint
-- does not depend on the server being Postgres 15 or newer, and as expression
-- indexes because Prisma's schema DSL cannot describe either.
--
-- The existing `@@unique` constraints stay: they are what Prisma's compound
-- unique lookups are built on. These sit alongside and cover the NULL case.

DO $$
DECLARE
  offenders TEXT;
BEGIN
  SELECT string_agg(detail, '; ') INTO offenders FROM (
    SELECT 'credit_balances user_id=' || user_id AS detail
      FROM billing.credit_balances WHERE service_id IS NULL
     GROUP BY user_id HAVING COUNT(*) > 1
    UNION ALL
    SELECT 'affiliates user_id=' || user_id
      FROM billing.affiliates WHERE service_id IS NULL
     GROUP BY user_id HAVING COUNT(*) > 1
    UNION ALL
    SELECT 'referrals referred_user_id=' || referred_user_id
      FROM billing.referrals WHERE service_id IS NULL
     GROUP BY referred_user_id HAVING COUNT(*) > 1
  ) dupes;

  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'Duplicate platform-wide rows must be merged by hand before this constraint can exist: %', offenders;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "credit_balances_one_per_user_platform_wide"
  ON "billing"."credit_balances" ("user_id")
  WHERE "service_id" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "affiliates_one_per_user_platform_wide"
  ON "billing"."affiliates" ("user_id")
  WHERE "service_id" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "referrals_one_per_referred_user_platform_wide"
  ON "billing"."referrals" ("referred_user_id")
  WHERE "service_id" IS NULL;

-- Feature quotas key on four columns, three of them nullable, so a partial
-- index per NULL combination would be eight of them. COALESCE onto sentinels
-- instead: a NULL scope is one specific scope, not a wildcard that matches
-- nothing.
CREATE UNIQUE INDEX IF NOT EXISTS "feature_quotas_one_per_scope"
  ON "billing"."feature_quotas" (
    COALESCE("feature_id", '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE("service_id", '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE("user_id", ''),
    "window"
  );
