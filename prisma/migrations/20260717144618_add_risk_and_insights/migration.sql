-- DropIndex
DROP INDEX "billing"."orders_external_id_trgm_idx";

-- DropIndex
DROP INDEX "billing"."orders_user_id_trgm_idx";

-- DropIndex
DROP INDEX "billing"."product_embeddings_hnsw_idx";

-- CreateTable
CREATE TABLE "billing"."risk_assessments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "ip" VARCHAR(64),
    "score" INTEGER NOT NULL,
    "level" VARCHAR(10) NOT NULL,
    "signals" JSONB NOT NULL DEFAULT '[]',
    "status" VARCHAR(20) NOT NULL DEFAULT 'none',
    "reviewed_by" VARCHAR(255),
    "review_note" VARCHAR(500),
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "risk_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."ai_insights" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(30) NOT NULL,
    "scope_key" VARCHAR(200) NOT NULL,
    "locale" VARCHAR(5) NOT NULL DEFAULT 'en',
    "content" TEXT NOT NULL,
    "data" JSONB,
    "model" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_insights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "risk_assessments_order_id_key" ON "billing"."risk_assessments"("order_id");

-- CreateIndex
CREATE INDEX "risk_assessments_status_created_at_idx" ON "billing"."risk_assessments"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "risk_assessments_user_id_created_at_idx" ON "billing"."risk_assessments"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "risk_assessments_ip_created_at_idx" ON "billing"."risk_assessments"("ip", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_insights_kind_scope_key_locale_key" ON "billing"."ai_insights"("kind", "scope_key", "locale");

-- AddForeignKey
ALTER TABLE "billing"."risk_assessments" ADD CONSTRAINT "risk_assessments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "billing"."orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
