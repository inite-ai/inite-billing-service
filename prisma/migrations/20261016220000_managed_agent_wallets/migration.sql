-- An agent wallet whose owner key INITE keeps for the agent.
ALTER TABLE "billing"."wallets" ADD COLUMN "owner_private_key" VARCHAR(64);
