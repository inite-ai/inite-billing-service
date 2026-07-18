-- CreateEnum
CREATE TYPE "billing"."OutreachStatus" AS ENUM ('pending', 'generated', 'sent', 'failed', 'skipped');

-- CreateTable
CREATE TABLE "billing"."outreach_messages" (
    "id" UUID NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "trigger" VARCHAR(50) NOT NULL,
    "step" INTEGER NOT NULL DEFAULT 0,
    "trigger_key" VARCHAR(255) NOT NULL,
    "funnel_event_id" UUID,
    "order_id" UUID,
    "subscription_id" UUID,
    "locale" VARCHAR(10) NOT NULL,
    "subject" VARCHAR(500),
    "body" TEXT,
    "source" VARCHAR(20),
    "model" VARCHAR(100),
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "status" "billing"."OutreachStatus" NOT NULL DEFAULT 'pending',
    "skip_reason" VARCHAR(100),
    "email_notification_id" UUID,
    "in_app_notification_id" UUID,
    "outcome" VARCHAR(30),
    "converted_at" TIMESTAMPTZ(6),
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(6),

    CONSTRAINT "outreach_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outreach_messages_trigger_key_key" ON "billing"."outreach_messages"("trigger_key");

-- CreateIndex
CREATE INDEX "outreach_messages_user_id_sent_at_idx" ON "billing"."outreach_messages"("user_id", "sent_at");

-- CreateIndex
CREATE INDEX "outreach_messages_trigger_status_created_at_idx" ON "billing"."outreach_messages"("trigger", "status", "created_at");

-- CreateIndex
CREATE INDEX "outreach_messages_outcome_sent_at_idx" ON "billing"."outreach_messages"("outcome", "sent_at");
