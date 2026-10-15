-- The Turnkey API key billing makes for itself; only the public half leaves.
CREATE TABLE "billing"."x402_relayer_keys" (
    "id" UUID NOT NULL,
    "public_key" VARCHAR(66) NOT NULL,
    "private_key" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retired_at" TIMESTAMPTZ(6),

    CONSTRAINT "x402_relayer_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "x402_relayer_keys_public_key_key" ON "billing"."x402_relayer_keys"("public_key");
