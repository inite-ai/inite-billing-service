-- Billing for MCP servers somebody else operates.
--
-- The operator registers where their server lives and what a call costs; agents
-- are given a URL here instead. Calls arriving at it are authorised against the
-- caller's credit balance for that operator's service, forwarded upstream,
-- metered and logged — so the operator writes no billing code, and an agent
-- that runs out of credits gets a payment link rather than a wall.
--
-- `upstream_url` is operator-supplied and therefore attacker-supplied as far as
-- this service is concerned: every request to it goes through the same SSRF
-- guard and address pinning the outbox publisher uses.
CREATE TABLE IF NOT EXISTS "billing"."mcp_servers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "service_id" UUID NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "upstream_url" VARCHAR(500) NOT NULL,
    "upstream_headers" JSONB DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "pricing_mode" VARCHAR(20) NOT NULL DEFAULT 'per_call',
    "credits_per_call" INTEGER,
    "feature_code" VARCHAR(100),
    "required_entitlement" VARCHAR(100),
    "price_code" VARCHAR(100),
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mcp_servers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "mcp_servers_slug_key" ON "billing"."mcp_servers"("slug");
CREATE INDEX IF NOT EXISTS "mcp_servers_service_id_is_active_idx"
  ON "billing"."mcp_servers"("service_id", "is_active");

ALTER TABLE "billing"."mcp_servers"
  ADD CONSTRAINT "mcp_servers_service_id_fkey"
  FOREIGN KEY ("service_id") REFERENCES "billing"."services"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- One row per proxied call: the operator's revenue and the customer's receipt.
CREATE TABLE IF NOT EXISTS "billing"."mcp_calls" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mcp_server_id" UUID NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "method" VARCHAR(60) NOT NULL,
    "tool_name" VARCHAR(120),
    "outcome" VARCHAR(20) NOT NULL,
    "credits_charged" INTEGER NOT NULL DEFAULT 0,
    "latency_ms" INTEGER,
    "detail" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_calls_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "mcp_calls_mcp_server_id_created_at_idx"
  ON "billing"."mcp_calls"("mcp_server_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "mcp_calls_user_id_created_at_idx"
  ON "billing"."mcp_calls"("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "mcp_calls_mcp_server_id_outcome_created_at_idx"
  ON "billing"."mcp_calls"("mcp_server_id", "outcome", "created_at");

ALTER TABLE "billing"."mcp_calls"
  ADD CONSTRAINT "mcp_calls_mcp_server_id_fkey"
  FOREIGN KEY ("mcp_server_id") REFERENCES "billing"."mcp_servers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
