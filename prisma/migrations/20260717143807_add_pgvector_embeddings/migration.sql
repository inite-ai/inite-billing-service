-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "billing"."product_embeddings" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "content_hash" VARCHAR(64) NOT NULL,
    "embedding" vector(1536),
    "model" VARCHAR(100) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_embeddings_product_id_key" ON "billing"."product_embeddings"("product_id");

-- HNSW index for cosine similarity search
CREATE INDEX "product_embeddings_hnsw_idx" ON "billing"."product_embeddings"
  USING hnsw (embedding vector_cosine_ops);

-- Trigram indexes for fuzzy admin order search
CREATE INDEX "orders_external_id_trgm_idx" ON "billing"."orders" USING gin (external_id gin_trgm_ops);
CREATE INDEX "orders_user_id_trgm_idx" ON "billing"."orders" USING gin (user_id gin_trgm_ops);
