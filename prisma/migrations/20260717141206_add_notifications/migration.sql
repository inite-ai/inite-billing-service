/*
  Warnings:

  - You are about to drop the column `stack_with_referral` on the `promo_codes` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "billing"."NotificationChannel" AS ENUM ('in_app', 'email');

-- CreateEnum
CREATE TYPE "billing"."NotificationStatus" AS ENUM ('pending', 'sent', 'delivered', 'failed', 'skipped', 'bounced');

-- AlterTable
ALTER TABLE "billing"."promo_codes" DROP COLUMN "stack_with_referral";

-- AlterTable
ALTER TABLE "billing"."services" ADD COLUMN     "webhook_url" VARCHAR(500);

-- CreateTable
CREATE TABLE "billing"."notifications" (
    "id" UUID NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "channel" "billing"."NotificationChannel" NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "body" TEXT NOT NULL,
    "status" "billing"."NotificationStatus" NOT NULL DEFAULT 'pending',
    "read_at" TIMESTAMPTZ(6),
    "email_to" VARCHAR(255),
    "provider_message_id" VARCHAR(255),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(6),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."user_contacts" (
    "user_id" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255),
    "locale" VARCHAR(10) NOT NULL DEFAULT 'en',
    "email_suppressed" BOOLEAN NOT NULL DEFAULT false,
    "unsubscribe_token" VARCHAR(64) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_contacts_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "billing"."notification_preferences" (
    "id" UUID NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "category" VARCHAR(50) NOT NULL,
    "email_enabled" BOOLEAN NOT NULL DEFAULT true,
    "in_app_enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_user_id_channel_created_at_idx" ON "billing"."notifications"("user_id", "channel", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_user_id_channel_read_at_idx" ON "billing"."notifications"("user_id", "channel", "read_at");

-- CreateIndex
CREATE INDEX "notifications_status_created_at_idx" ON "billing"."notifications"("status", "created_at");

-- CreateIndex
CREATE INDEX "notifications_provider_message_id_idx" ON "billing"."notifications"("provider_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_contacts_unsubscribe_token_key" ON "billing"."user_contacts"("unsubscribe_token");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_category_key" ON "billing"."notification_preferences"("user_id", "category");
