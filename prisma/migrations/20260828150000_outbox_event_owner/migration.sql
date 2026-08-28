-- Address outbox deliveries to the consumer they belong to.
--
-- The publisher POSTed every pending event to every active service with a
-- webhook URL, and the payloads carry user ids, order ids, amounts and
-- entitlement keys — so each product module would have received every other
-- module's billing traffic. Nullable because events emitted before this column
-- existed have no owner; the publisher treats those as "deliver to nobody",
-- which is the safe direction for a leak.
--
-- Safe to apply: production currently has five registered services and none of
-- them has a webhook URL, so nothing is being delivered today and no consumer
-- integration changes behaviour under this.
ALTER TABLE "billing"."outbox_events" ADD COLUMN IF NOT EXISTS "service_id" UUID;

CREATE INDEX IF NOT EXISTS "outbox_events_service_id_status_idx"
  ON "billing"."outbox_events" ("service_id", "status");
