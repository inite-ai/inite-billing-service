-- AI agents a person lets pay from their INITE wallet, and their payments.
CREATE TABLE "billing"."wallet_agents" (
    "id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "agent_did" VARCHAR(255) NOT NULL,
    "client_id" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255),
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "requested" JSONB NOT NULL,
    "limits" JSONB,
    "turnkey_user_id" VARCHAR(64),
    "policy_id" VARCHAR(64),
    "api_public_key" VARCHAR(66),
    "api_private_key" VARCHAR(64),
    "pending_step" VARCHAR(20),
    "pending_request" TEXT,
    "pending_limits" JSONB,
    "approved_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "last_used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_agents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wallet_agents_wallet_id_agent_did_key" ON "billing"."wallet_agents"("wallet_id", "agent_did");
ALTER TABLE "billing"."wallet_agents" ADD CONSTRAINT "wallet_agents_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "billing"."wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "billing"."wallet_agent_payments" (
    "id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "merchant" VARCHAR(255) NOT NULL,
    "pay_to" VARCHAR(42) NOT NULL,
    "value_raw" VARCHAR(78) NOT NULL,
    "nonce" VARCHAR(66) NOT NULL,
    "valid_before" TIMESTAMPTZ(6) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'signing',
    "http_status" INTEGER,
    "tx_hash" VARCHAR(66),
    "description" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "wallet_agent_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wallet_agent_payments_nonce_key" ON "billing"."wallet_agent_payments"("nonce");
CREATE INDEX "wallet_agent_payments_agent_id_created_at_idx" ON "billing"."wallet_agent_payments"("agent_id", "created_at");
ALTER TABLE "billing"."wallet_agent_payments" ADD CONSTRAINT "wallet_agent_payments_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "billing"."wallet_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
