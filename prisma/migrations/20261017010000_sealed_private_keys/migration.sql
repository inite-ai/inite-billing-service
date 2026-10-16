-- Private keys are sealed at rest (src/common/key-seal.ts): the sealed form
-- is longer than the 64 hex characters these columns held.
ALTER TABLE "billing"."x402_relayer_keys" ALTER COLUMN "private_key" TYPE TEXT;
ALTER TABLE "billing"."wallets" ALTER COLUMN "owner_private_key" TYPE TEXT;
