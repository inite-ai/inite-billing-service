-- Where the EVM watcher has read each network's token logs up to.
CREATE TABLE "billing"."crypto_scan_cursors" (
    "chain" VARCHAR(20) NOT NULL,
    "token" VARCHAR(20) NOT NULL,
    "receiver_key" VARCHAR(255) NOT NULL,
    "last_block" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "crypto_scan_cursors_pkey" PRIMARY KEY ("chain","token","receiver_key")
);
