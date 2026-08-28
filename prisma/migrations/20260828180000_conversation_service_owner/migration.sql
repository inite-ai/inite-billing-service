-- Give a conversation an owning service.
--
-- Every conversation endpoint skipped its ownership check entirely for
-- service-key callers (`if (!user.isService)`), and the message endpoints did
-- not scope by anything at all. Any registered service could therefore read any
-- other service's users' support chats — which contain order ids, amounts,
-- entitlements and whatever the customer typed — list them by user id, and post
-- messages into them with an arbitrary role.
--
-- Nullable because conversations created before this column have no owning
-- service. Those stay reachable by the user who owns them, over a JWT, and by
-- no service key: adopting them on first touch would let whichever service
-- asked first claim a conversation it never had.
ALTER TABLE "billing"."conversations" ADD COLUMN IF NOT EXISTS "service_id" UUID;

CREATE INDEX IF NOT EXISTS "conversations_service_id_updated_at_idx"
  ON "billing"."conversations" ("service_id", "updated_at" DESC);
