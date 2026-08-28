-- Make a double fulfilment impossible at the database level, behind the row
-- lock now taken in `applyStateTransition`.
--
-- The application guard is a lock plus a read-then-write idempotency check. A
-- lock can be lost to a future refactor, a replica, or a path that forgets to
-- take it; these constraints cannot. If a second fulfilment of the same order
-- ever runs, it fails loudly on insert instead of quietly issuing a second
-- invoice and a second batch of credits.
--
-- One invoice per order. Renewals create their own order, so this does not
-- constrain subscriptions — it constrains the same order being paid twice.
--
-- One credit grant per order. Partial, because an order also produces `reset`
-- and `purchase_reversal` rows against the same id; only the grant is the thing
-- that must happen exactly once. Prisma has no schema DSL for partial indexes,
-- so this is raw SQL, consistent with the other hand-written migrations here.
--
-- Safe to apply: audited on production before writing this — 0 orders with more
-- than one invoice, 0 with more than one grant, 0 duplicated commissions.
-- Named as Prisma names it, because the constraint is declared in the schema
-- (`@@unique([orderId])`) and must not read as drift.
DROP INDEX IF EXISTS "billing"."invoices_order_id_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_order_id_key"
  ON "billing"."invoices" ("order_id");

CREATE UNIQUE INDEX IF NOT EXISTS "credit_usages_one_grant_per_order"
  ON "billing"."credit_usages" ("order_id")
  WHERE "type" = 'grant' AND "order_id" IS NOT NULL;
