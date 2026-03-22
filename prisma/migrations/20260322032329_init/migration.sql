-- CreateEnum
CREATE TYPE "billing"."ProductType" AS ENUM ('subscription', 'one_time', 'usage');

-- CreateEnum
CREATE TYPE "billing"."OrderMode" AS ENUM ('PAYMENT', 'SUBSCRIPTION');

-- CreateEnum
CREATE TYPE "billing"."OrderStatus" AS ENUM ('created', 'open', 'paid', 'failed', 'refunded', 'expired');

-- CreateEnum
CREATE TYPE "billing"."IntentStatus" AS ENUM ('created', 'opened', 'paid', 'failed', 'expired', 'refunded');

-- CreateEnum
CREATE TYPE "billing"."SubscriptionStatus" AS ENUM ('trialing', 'active', 'past_due', 'canceled', 'ended');

-- CreateEnum
CREATE TYPE "billing"."EntitlementStatus" AS ENUM ('active', 'revoked', 'expired');

-- CreateEnum
CREATE TYPE "billing"."EntitlementSource" AS ENUM ('subscription', 'order', 'admin');

-- CreateEnum
CREATE TYPE "billing"."InvoiceStatus" AS ENUM ('open', 'paid', 'void', 'failed', 'refunded');

-- CreateEnum
CREATE TYPE "billing"."WebhookEventStatus" AS ENUM ('received', 'processing', 'processed', 'failed');

-- CreateEnum
CREATE TYPE "billing"."OutboxEventStatus" AS ENUM ('new', 'sent', 'failed');

-- CreateEnum
CREATE TYPE "billing"."AffiliateStatus" AS ENUM ('active', 'inactive', 'suspended');

-- CreateEnum
CREATE TYPE "billing"."CommissionStatus" AS ENUM ('pending', 'earned', 'paid', 'voided');

-- CreateEnum
CREATE TYPE "billing"."PayoutStatus" AS ENUM ('pending', 'processing', 'paid', 'failed');

-- CreateTable
CREATE TABLE "billing"."services" (
    "id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "api_key" VARCHAR(64) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."referral_levels" (
    "id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "commission_rate" DECIMAL(5,4) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "qualification_criteria" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "referral_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."products" (
    "id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "service_id" UUID,
    "module_scope" VARCHAR(100) NOT NULL,
    "type" "billing"."ProductType" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."prices" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "interval" VARCHAR(20),
    "trial_days" INTEGER DEFAULT 0,
    "grace_days" INTEGER DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."orders" (
    "id" UUID NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "price_id" UUID NOT NULL,
    "mode" "billing"."OrderMode" NOT NULL,
    "status" "billing"."OrderStatus" NOT NULL DEFAULT 'created',
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "external_id" VARCHAR(255),
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."payment_intents" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "rail" VARCHAR(50) NOT NULL,
    "status" "billing"."IntentStatus" NOT NULL DEFAULT 'created',
    "provider_intent_id" VARCHAR(255),
    "provider_checkout_id" VARCHAR(255),
    "checkout_url" TEXT,
    "method" VARCHAR(50),
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "crypto_chain_id" VARCHAR(50),
    "crypto_token" VARCHAR(50),
    "crypto_amount" VARCHAR(100),
    "receiver_address" VARCHAR(255),
    "tx_hash" VARCHAR(255),
    "expires_at" TIMESTAMPTZ(6),
    "snapshot" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."subscriptions" (
    "id" UUID NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "price_id" UUID NOT NULL,
    "status" "billing"."SubscriptionStatus" NOT NULL DEFAULT 'trialing',
    "current_period_start" TIMESTAMPTZ(6) NOT NULL,
    "current_period_end" TIMESTAMPTZ(6) NOT NULL,
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "provider_subscription_id" VARCHAR(255),
    "rail" VARCHAR(50),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."entitlements" (
    "id" UUID NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "status" "billing"."EntitlementStatus" NOT NULL DEFAULT 'active',
    "value" JSONB DEFAULT '{}',
    "source" "billing"."EntitlementSource" NOT NULL,
    "source_id" VARCHAR(255),
    "starts_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."invoices" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "status" "billing"."InvoiceStatus" NOT NULL DEFAULT 'open',
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "provider_receipt_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."webhook_events" (
    "id" UUID NOT NULL,
    "rail" VARCHAR(50) NOT NULL,
    "webhook_id" VARCHAR(255) NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "entity_id" VARCHAR(255) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),
    "status" "billing"."WebhookEventStatus" NOT NULL DEFAULT 'received',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."outbox_events" (
    "id" UUID NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "aggregate" JSONB NOT NULL DEFAULT '{}',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "billing"."OutboxEventStatus" NOT NULL DEFAULT 'new',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(6),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."affiliates" (
    "id" UUID NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "service_id" UUID,
    "parent_affiliate_id" UUID,
    "referral_code" VARCHAR(50) NOT NULL,
    "status" "billing"."AffiliateStatus" NOT NULL DEFAULT 'active',
    "commission_rate" DECIMAL(5,4) NOT NULL DEFAULT 0.5,
    "total_earned" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "total_paid" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "affiliates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."referrals" (
    "id" UUID NOT NULL,
    "affiliate_id" UUID NOT NULL,
    "referred_user_id" UUID NOT NULL,
    "service_id" UUID,
    "referral_code" VARCHAR(50) NOT NULL,
    "first_order_id" UUID,
    "first_order_paid" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."affiliate_commissions" (
    "id" UUID NOT NULL,
    "affiliate_id" UUID NOT NULL,
    "referral_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "amount" DECIMAL(19,4) NOT NULL,
    "commission_rate" DECIMAL(5,4) NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "status" "billing"."CommissionStatus" NOT NULL DEFAULT 'pending',
    "earned_at" TIMESTAMPTZ(6),
    "payout_id" UUID,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "affiliate_commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."affiliate_payouts" (
    "id" UUID NOT NULL,
    "affiliate_id" UUID NOT NULL,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "total_amount" DECIMAL(19,4) NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "status" "billing"."PayoutStatus" NOT NULL DEFAULT 'pending',
    "payout_date" TIMESTAMPTZ(6),
    "processed_at" TIMESTAMPTZ(6),
    "failure_reason" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "affiliate_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."payment_providers" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "supported_modes" TEXT[],
    "currencies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "webhook_url" TEXT,
    "config" JSONB DEFAULT '{}',
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."promo_codes" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "discount_type" VARCHAR(20) NOT NULL,
    "discount_value" DECIMAL(19,4) NOT NULL,
    "service_id" UUID,
    "min_purchase_amount" DECIMAL(19,4),
    "max_discount_amount" DECIMAL(19,4),
    "valid_from" TIMESTAMPTZ(6) NOT NULL,
    "valid_until" TIMESTAMPTZ(6),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "max_usage_count" INTEGER,
    "current_usage_count" INTEGER NOT NULL DEFAULT 0,
    "max_usage_per_user" INTEGER DEFAULT 1,
    "stack_with_referral" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."promo_code_usages" (
    "id" UUID NOT NULL,
    "promo_code_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "discount_applied" DECIMAL(19,4) NOT NULL,
    "original_amount" DECIMAL(19,4) NOT NULL,
    "final_amount" DECIMAL(19,4) NOT NULL,
    "applied_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_code_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."conversations" (
    "id" UUID NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "mode" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."chat_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "content" TEXT NOT NULL,
    "tool_calls" JSONB,
    "tool_results" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."funnel_events" (
    "id" UUID NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "session_id" VARCHAR(100),
    "event_type" VARCHAR(50) NOT NULL,
    "stage" VARCHAR(30) NOT NULL,
    "order_id" UUID,
    "product_id" UUID,
    "service_id" UUID,
    "amount" DECIMAL(19,4),
    "currency" VARCHAR(10),
    "properties" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "funnel_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "services_code_key" ON "billing"."services"("code");

-- CreateIndex
CREATE UNIQUE INDEX "services_api_key_key" ON "billing"."services"("api_key");

-- CreateIndex
CREATE UNIQUE INDEX "referral_levels_service_id_level_key" ON "billing"."referral_levels"("service_id", "level");

-- CreateIndex
CREATE UNIQUE INDEX "products_code_key" ON "billing"."products"("code");

-- CreateIndex
CREATE INDEX "products_code_idx" ON "billing"."products"("code");

-- CreateIndex
CREATE INDEX "products_module_scope_is_active_idx" ON "billing"."products"("module_scope", "is_active");

-- CreateIndex
CREATE INDEX "products_service_id_idx" ON "billing"."products"("service_id");

-- CreateIndex
CREATE UNIQUE INDEX "prices_code_key" ON "billing"."prices"("code");

-- CreateIndex
CREATE INDEX "prices_code_idx" ON "billing"."prices"("code");

-- CreateIndex
CREATE INDEX "prices_product_id_is_active_idx" ON "billing"."prices"("product_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "orders_external_id_key" ON "billing"."orders"("external_id");

-- CreateIndex
CREATE INDEX "orders_user_id_status_created_at_idx" ON "billing"."orders"("user_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "orders_external_id_idx" ON "billing"."orders"("external_id");

-- CreateIndex
CREATE INDEX "orders_status_created_at_idx" ON "billing"."orders"("status", "created_at");

-- CreateIndex
CREATE INDEX "payment_intents_status_created_at_idx" ON "billing"."payment_intents"("status", "created_at");

-- CreateIndex
CREATE INDEX "payment_intents_order_id_idx" ON "billing"."payment_intents"("order_id");

-- CreateIndex
CREATE INDEX "payment_intents_provider_intent_id_idx" ON "billing"."payment_intents"("provider_intent_id");

-- CreateIndex
CREATE INDEX "payment_intents_tx_hash_idx" ON "billing"."payment_intents"("tx_hash");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_provider_intent_id_rail_key" ON "billing"."payment_intents"("provider_intent_id", "rail");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_tx_hash_rail_key" ON "billing"."payment_intents"("tx_hash", "rail");

-- CreateIndex
CREATE INDEX "subscriptions_user_id_status_idx" ON "billing"."subscriptions"("user_id", "status");

-- CreateIndex
CREATE INDEX "subscriptions_provider_subscription_id_idx" ON "billing"."subscriptions"("provider_subscription_id");

-- CreateIndex
CREATE INDEX "subscriptions_status_current_period_end_idx" ON "billing"."subscriptions"("status", "current_period_end");

-- CreateIndex
CREATE INDEX "entitlements_user_id_key_status_idx" ON "billing"."entitlements"("user_id", "key", "status");

-- CreateIndex
CREATE INDEX "entitlements_status_expires_at_idx" ON "billing"."entitlements"("status", "expires_at");

-- CreateIndex
CREATE INDEX "invoices_order_id_idx" ON "billing"."invoices"("order_id");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "billing"."invoices"("status");

-- CreateIndex
CREATE INDEX "webhook_events_status_received_at_idx" ON "billing"."webhook_events"("status", "received_at");

-- CreateIndex
CREATE INDEX "webhook_events_rail_entity_id_idx" ON "billing"."webhook_events"("rail", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_rail_webhook_id_key" ON "billing"."webhook_events"("rail", "webhook_id");

-- CreateIndex
CREATE INDEX "outbox_events_status_created_at_idx" ON "billing"."outbox_events"("status", "created_at" ASC);

-- CreateIndex
CREATE INDEX "outbox_events_event_type_idx" ON "billing"."outbox_events"("event_type");

-- CreateIndex
CREATE UNIQUE INDEX "affiliates_referral_code_key" ON "billing"."affiliates"("referral_code");

-- CreateIndex
CREATE INDEX "affiliates_referral_code_idx" ON "billing"."affiliates"("referral_code");

-- CreateIndex
CREATE INDEX "affiliates_status_idx" ON "billing"."affiliates"("status");

-- CreateIndex
CREATE INDEX "affiliates_service_id_idx" ON "billing"."affiliates"("service_id");

-- CreateIndex
CREATE INDEX "affiliates_parent_affiliate_id_idx" ON "billing"."affiliates"("parent_affiliate_id");

-- CreateIndex
CREATE UNIQUE INDEX "affiliates_user_id_service_id_key" ON "billing"."affiliates"("user_id", "service_id");

-- CreateIndex
CREATE INDEX "referrals_affiliate_id_idx" ON "billing"."referrals"("affiliate_id");

-- CreateIndex
CREATE INDEX "referrals_referred_user_id_idx" ON "billing"."referrals"("referred_user_id");

-- CreateIndex
CREATE INDEX "referrals_referral_code_idx" ON "billing"."referrals"("referral_code");

-- CreateIndex
CREATE INDEX "referrals_service_id_idx" ON "billing"."referrals"("service_id");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_referred_user_id_service_id_key" ON "billing"."referrals"("referred_user_id", "service_id");

-- CreateIndex
CREATE INDEX "affiliate_commissions_affiliate_id_status_idx" ON "billing"."affiliate_commissions"("affiliate_id", "status");

-- CreateIndex
CREATE INDEX "affiliate_commissions_order_id_idx" ON "billing"."affiliate_commissions"("order_id");

-- CreateIndex
CREATE INDEX "affiliate_commissions_status_earned_at_idx" ON "billing"."affiliate_commissions"("status", "earned_at");

-- CreateIndex
CREATE INDEX "affiliate_commissions_payout_id_idx" ON "billing"."affiliate_commissions"("payout_id");

-- CreateIndex
CREATE INDEX "affiliate_payouts_affiliate_id_status_idx" ON "billing"."affiliate_payouts"("affiliate_id", "status");

-- CreateIndex
CREATE INDEX "affiliate_payouts_status_period_end_idx" ON "billing"."affiliate_payouts"("status", "period_end");

-- CreateIndex
CREATE INDEX "affiliate_payouts_period_start_period_end_idx" ON "billing"."affiliate_payouts"("period_start", "period_end");

-- CreateIndex
CREATE UNIQUE INDEX "payment_providers_code_key" ON "billing"."payment_providers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "promo_codes_code_key" ON "billing"."promo_codes"("code");

-- CreateIndex
CREATE INDEX "promo_codes_is_active_valid_from_valid_until_idx" ON "billing"."promo_codes"("is_active", "valid_from", "valid_until");

-- CreateIndex
CREATE INDEX "promo_codes_service_id_idx" ON "billing"."promo_codes"("service_id");

-- CreateIndex
CREATE INDEX "promo_code_usages_promo_code_id_user_id_idx" ON "billing"."promo_code_usages"("promo_code_id", "user_id");

-- CreateIndex
CREATE INDEX "promo_code_usages_order_id_idx" ON "billing"."promo_code_usages"("order_id");

-- CreateIndex
CREATE INDEX "conversations_user_id_updated_at_idx" ON "billing"."conversations"("user_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "chat_messages_conversation_id_created_at_idx" ON "billing"."chat_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "funnel_events_user_id_created_at_idx" ON "billing"."funnel_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "funnel_events_event_type_created_at_idx" ON "billing"."funnel_events"("event_type", "created_at");

-- CreateIndex
CREATE INDEX "funnel_events_stage_created_at_idx" ON "billing"."funnel_events"("stage", "created_at");

-- CreateIndex
CREATE INDEX "funnel_events_order_id_idx" ON "billing"."funnel_events"("order_id");

-- CreateIndex
CREATE INDEX "funnel_events_service_id_created_at_idx" ON "billing"."funnel_events"("service_id", "created_at");

-- AddForeignKey
ALTER TABLE "billing"."referral_levels" ADD CONSTRAINT "referral_levels_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "billing"."services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."products" ADD CONSTRAINT "products_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "billing"."services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."prices" ADD CONSTRAINT "prices_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "billing"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."orders" ADD CONSTRAINT "orders_price_id_fkey" FOREIGN KEY ("price_id") REFERENCES "billing"."prices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."payment_intents" ADD CONSTRAINT "payment_intents_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "billing"."orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."subscriptions" ADD CONSTRAINT "subscriptions_price_id_fkey" FOREIGN KEY ("price_id") REFERENCES "billing"."prices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."invoices" ADD CONSTRAINT "invoices_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "billing"."orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."affiliates" ADD CONSTRAINT "affiliates_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "billing"."services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."affiliates" ADD CONSTRAINT "affiliates_parent_affiliate_id_fkey" FOREIGN KEY ("parent_affiliate_id") REFERENCES "billing"."affiliates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."referrals" ADD CONSTRAINT "referrals_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "billing"."affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."referrals" ADD CONSTRAINT "referrals_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "billing"."services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."affiliate_commissions" ADD CONSTRAINT "affiliate_commissions_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "billing"."affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."affiliate_commissions" ADD CONSTRAINT "affiliate_commissions_referral_id_fkey" FOREIGN KEY ("referral_id") REFERENCES "billing"."referrals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."affiliate_commissions" ADD CONSTRAINT "affiliate_commissions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "billing"."orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."affiliate_commissions" ADD CONSTRAINT "affiliate_commissions_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "billing"."affiliate_payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."affiliate_payouts" ADD CONSTRAINT "affiliate_payouts_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "billing"."affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."promo_codes" ADD CONSTRAINT "promo_codes_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "billing"."services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."promo_code_usages" ADD CONSTRAINT "promo_code_usages_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "billing"."promo_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."promo_code_usages" ADD CONSTRAINT "promo_code_usages_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "billing"."orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "billing"."conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
