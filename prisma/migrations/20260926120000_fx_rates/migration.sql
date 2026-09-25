-- Exchange rates for converting non-dollar prices into stablecoin invoices.
CREATE TABLE "billing"."fx_rates" (
    "currency" VARCHAR(10) NOT NULL,
    "per_usd" DECIMAL(24,10) NOT NULL,
    "source" VARCHAR(40) NOT NULL,
    "published_at" TIMESTAMPTZ(6),
    "fetched_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "fx_rates_pkey" PRIMARY KEY ("currency")
);
