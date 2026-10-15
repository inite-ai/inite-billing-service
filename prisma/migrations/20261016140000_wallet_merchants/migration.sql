-- Sites a person lets charge their INITE wallet, and the wallet's "INITE checkout" user.
ALTER TABLE "billing"."wallet_agents" ADD COLUMN "kind" VARCHAR(20) NOT NULL DEFAULT 'agent';
ALTER TABLE "billing"."wallet_agent_payments" ADD COLUMN "service_id" UUID;
ALTER TABLE "billing"."wallet_agent_payments" ADD COLUMN "order_id" UUID;
CREATE INDEX "wallet_agent_payments_service_id_created_at_idx" ON "billing"."wallet_agent_payments"("service_id", "created_at");

CREATE TABLE "billing"."wallet_merchants" (
    "id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "per_payment" VARCHAR(12) NOT NULL,
    "monthly" VARCHAR(12) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "wallet_merchants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wallet_merchants_wallet_id_service_id_key" ON "billing"."wallet_merchants"("wallet_id", "service_id");
ALTER TABLE "billing"."wallet_merchants" ADD CONSTRAINT "wallet_merchants_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "billing"."wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
