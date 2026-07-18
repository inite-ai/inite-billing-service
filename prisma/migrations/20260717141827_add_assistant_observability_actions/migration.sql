-- AlterTable
ALTER TABLE "billing"."chat_messages" ADD COLUMN     "feedback" VARCHAR(10),
ADD COLUMN     "feedback_at" TIMESTAMPTZ(6),
ADD COLUMN     "feedback_comment" TEXT;

-- CreateTable
CREATE TABLE "billing"."assistant_tool_calls" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "tool_name" VARCHAR(64) NOT NULL,
    "args" JSONB,
    "result_preview" TEXT,
    "is_error" BOOLEAN NOT NULL DEFAULT false,
    "duration_ms" INTEGER NOT NULL,
    "iteration" INTEGER NOT NULL DEFAULT 0,
    "model" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_tool_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."assistant_actions" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "tool_name" VARCHAR(64) NOT NULL,
    "tool_use_id" VARCHAR(64),
    "params" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "required_role" VARCHAR(20),
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "result" JSONB,
    "error" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "confirmed_at" TIMESTAMPTZ(6),
    "confirmed_by" VARCHAR(255),
    "executed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "assistant_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_tool_calls_tool_name_created_at_idx" ON "billing"."assistant_tool_calls"("tool_name", "created_at");

-- CreateIndex
CREATE INDEX "assistant_tool_calls_conversation_id_created_at_idx" ON "billing"."assistant_tool_calls"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "assistant_actions_user_id_status_idx" ON "billing"."assistant_actions"("user_id", "status");

-- CreateIndex
CREATE INDEX "assistant_actions_conversation_id_created_at_idx" ON "billing"."assistant_actions"("conversation_id", "created_at");

-- AddForeignKey
ALTER TABLE "billing"."assistant_actions" ADD CONSTRAINT "assistant_actions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "billing"."conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
