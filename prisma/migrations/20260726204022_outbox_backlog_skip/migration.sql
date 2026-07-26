-- One-time outbox backlog skip.
--
-- The outbox producer (OutboxScheduler) was missing, so domain events piled up
-- in `outbox_events` with status='new' and were never delivered. Now that
-- delivery is enabled, draining that backlog would flood every consumer with
-- days of historical `billing.*` events (risking duplicate/stale processing).
--
-- Mark the pre-existing backlog as 'sent' so delivery starts clean from this
-- deploy forward. Events created after this migration are delivered normally.
-- (If a consumer needs historical events replayed, do it deliberately/scoped.)
UPDATE "billing"."outbox_events"
SET "status" = 'sent', "sent_at" = now()
WHERE "status" = 'new';
