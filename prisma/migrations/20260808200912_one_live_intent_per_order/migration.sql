-- Enforce AT MOST ONE live (created/opened) PaymentIntent per order at the DB
-- level — defense-in-depth behind the application reuse guard in
-- CheckoutService.paySession, closing the truly-concurrent double-intent race.
--
-- Partial unique index: an order may still have many TERMINAL intents over time
-- (paid/failed/expired/refunded), only the live ones are constrained. Prisma has
-- no schema DSL for partial indexes, so this is raw SQL (consistent with the
-- other hand-written migrations in this repo).
--
-- Safe to apply: a prod audit found 0 orders with >1 live intent, so no existing
-- row violates the constraint.
CREATE UNIQUE INDEX IF NOT EXISTS "payment_intents_one_live_per_order"
  ON "billing"."payment_intents" ("order_id")
  WHERE "status" IN ('created', 'opened');
