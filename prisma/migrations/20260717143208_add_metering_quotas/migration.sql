-- AlterTable
ALTER TABLE "billing"."credit_usages" ADD COLUMN     "feature_code" VARCHAR(100),
ADD COLUMN     "model_tier" VARCHAR(50),
ADD COLUMN     "units" INTEGER;

-- CreateTable
CREATE TABLE "billing"."metered_features" (
    "id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "service_id" UUID,
    "unit" VARCHAR(30) NOT NULL,
    "credits_per_unit" DECIMAL(12,6) NOT NULL DEFAULT 1,
    "tier_rates" JSONB DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "metered_features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."feature_quotas" (
    "id" UUID NOT NULL,
    "feature_id" UUID,
    "service_id" UUID,
    "user_id" VARCHAR(255),
    "window" VARCHAR(20) NOT NULL,
    "limit_units" INTEGER,
    "limit_credits" INTEGER,
    "soft_cap_pct" INTEGER NOT NULL DEFAULT 80,
    "overage_policy" VARCHAR(20) NOT NULL DEFAULT 'block',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "feature_quotas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "metered_features_code_key" ON "billing"."metered_features"("code");

-- CreateIndex
CREATE INDEX "metered_features_service_id_is_active_idx" ON "billing"."metered_features"("service_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "feature_quotas_feature_id_service_id_user_id_window_key" ON "billing"."feature_quotas"("feature_id", "service_id", "user_id", "window");

-- CreateIndex
CREATE INDEX "credit_usages_user_id_feature_code_created_at_idx" ON "billing"."credit_usages"("user_id", "feature_code", "created_at");

-- CreateIndex
CREATE INDEX "credit_usages_feature_code_created_at_idx" ON "billing"."credit_usages"("feature_code", "created_at");

-- AddForeignKey
ALTER TABLE "billing"."metered_features" ADD CONSTRAINT "metered_features_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "billing"."services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."feature_quotas" ADD CONSTRAINT "feature_quotas_feature_id_fkey" FOREIGN KEY ("feature_id") REFERENCES "billing"."metered_features"("id") ON DELETE CASCADE ON UPDATE CASCADE;
