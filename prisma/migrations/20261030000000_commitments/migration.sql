-- Commitments: money held against a promise (docs/commitments.md).
-- CreateEnum
CREATE TYPE "billing"."CommitmentStatus" AS ENUM ('pending_payment', 'held', 'released_money', 'released_credits', 'forfeited', 'auto_released', 'refunded_on_cancel', 'disputed', 'void');

-- AlterTable
ALTER TABLE "billing"."services" ADD COLUMN     "auth_client_id" VARCHAR(255);

-- CreateTable
CREATE TABLE "billing"."charities" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "url" VARCHAR(500),
    "description" JSONB DEFAULT '{}',
    "payout_method" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "charities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."charity_payouts" (
    "id" UUID NOT NULL,
    "charity_id" UUID NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "period_from" TIMESTAMPTZ(6),
    "period_to" TIMESTAMPTZ(6) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'recorded',
    "reference" VARCHAR(500),
    "created_by" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(6),

    CONSTRAINT "charity_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."commitments" (
    "id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "external_ref" VARCHAR(255) NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "order_id" UUID NOT NULL,
    "product_code" VARCHAR(100) NOT NULL,
    "price_code" VARCHAR(100) NOT NULL,
    "stake_amount" DECIMAL(19,4) NOT NULL,
    "fee_amount" DECIMAL(19,4) NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "credits_bonus_pct" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "credits_per_usd" INTEGER NOT NULL DEFAULT 0,
    "credits_service_id" UUID,
    "charity_id" UUID NOT NULL,
    "verification" JSONB NOT NULL DEFAULT '{}',
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "auto_release_at" TIMESTAMPTZ(6) NOT NULL,
    "cancel_until" TIMESTAMPTZ(6),
    "status" "billing"."CommitmentStatus" NOT NULL DEFAULT 'pending_payment',
    "release_as" VARCHAR(10),
    "credits_granted" INTEGER,
    "paid_rail" VARCHAR(50),
    "held_at" TIMESTAMPTZ(6),
    "settled_at" TIMESTAMPTZ(6),
    "payout_state" VARCHAR(20) NOT NULL DEFAULT 'none',
    "charity_payout_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commitments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."commitment_transitions" (
    "id" UUID NOT NULL,
    "commitment_id" UUID NOT NULL,
    "from_status" VARCHAR(30) NOT NULL,
    "to_status" VARCHAR(30) NOT NULL,
    "actor" VARCHAR(20) NOT NULL,
    "actor_id" VARCHAR(255),
    "reason" TEXT,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commitment_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."commitment_ledger" (
    "id" UUID NOT NULL,
    "commitment_id" UUID,
    "transition_id" UUID,
    "payout_id" UUID,
    "account" VARCHAR(100) NOT NULL,
    "debit" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "credit" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "currency" VARCHAR(10) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commitment_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "charities_code_key" ON "billing"."charities"("code");

-- CreateIndex
CREATE INDEX "charity_payouts_charity_id_created_at_idx" ON "billing"."charity_payouts"("charity_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "commitments_order_id_key" ON "billing"."commitments"("order_id");

-- CreateIndex
CREATE INDEX "commitments_user_id_status_idx" ON "billing"."commitments"("user_id", "status");

-- CreateIndex
CREATE INDEX "commitments_status_auto_release_at_idx" ON "billing"."commitments"("status", "auto_release_at");

-- CreateIndex
CREATE INDEX "commitments_charity_id_status_idx" ON "billing"."commitments"("charity_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "commitments_service_id_external_ref_key" ON "billing"."commitments"("service_id", "external_ref");

-- CreateIndex
CREATE INDEX "commitment_transitions_commitment_id_created_at_idx" ON "billing"."commitment_transitions"("commitment_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "commitment_transitions_commitment_id_idempotency_key_key" ON "billing"."commitment_transitions"("commitment_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "commitment_ledger_account_idx" ON "billing"."commitment_ledger"("account");

-- CreateIndex
CREATE INDEX "commitment_ledger_commitment_id_idx" ON "billing"."commitment_ledger"("commitment_id");

-- CreateIndex
CREATE UNIQUE INDEX "services_auth_client_id_key" ON "billing"."services"("auth_client_id");

-- AddForeignKey
ALTER TABLE "billing"."charity_payouts" ADD CONSTRAINT "charity_payouts_charity_id_fkey" FOREIGN KEY ("charity_id") REFERENCES "billing"."charities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."commitments" ADD CONSTRAINT "commitments_charity_id_fkey" FOREIGN KEY ("charity_id") REFERENCES "billing"."charities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."commitments" ADD CONSTRAINT "commitments_charity_payout_id_fkey" FOREIGN KEY ("charity_payout_id") REFERENCES "billing"."charity_payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."commitment_transitions" ADD CONSTRAINT "commitment_transitions_commitment_id_fkey" FOREIGN KEY ("commitment_id") REFERENCES "billing"."commitments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."commitment_ledger" ADD CONSTRAINT "commitment_ledger_commitment_id_fkey" FOREIGN KEY ("commitment_id") REFERENCES "billing"."commitments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."commitment_ledger" ADD CONSTRAINT "commitment_ledger_transition_id_fkey" FOREIGN KEY ("transition_id") REFERENCES "billing"."commitment_transitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A ledger line is one side of a double entry: a non-negative amount on
-- exactly one side. Balancing (debits = credits per transition) is enforced
-- by the service and checked by tests.
ALTER TABLE "billing"."commitment_ledger" ADD CONSTRAINT "commitment_ledger_one_side"
  CHECK ("debit" >= 0 AND "credit" >= 0 AND (("debit" = 0) <> ("credit" = 0)));

-- Amounts are positive; the fee may be zero.
ALTER TABLE "billing"."commitments" ADD CONSTRAINT "commitments_amounts_positive"
  CHECK ("stake_amount" > 0 AND "fee_amount" >= 0);
