-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "request_hash" TEXT,
    "response" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_business_id_idempotency_key_key" ON "idempotency_keys"("business_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "idempotency_keys_business_id_idempotency_key_idx" ON "idempotency_keys"("business_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "saga_executions" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "saga_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "correlation_id" TEXT,
    "command_id" TEXT,
    "session_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "saga_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saga_executions_business_id_status_idx" ON "saga_executions"("business_id", "status");

-- CreateIndex
CREATE INDEX "saga_executions_correlation_id_idx" ON "saga_executions"("correlation_id");

-- AddForeignKey
ALTER TABLE "saga_executions" ADD CONSTRAINT "saga_executions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "saga_steps" (
    "id" TEXT NOT NULL,
    "saga_id" TEXT NOT NULL,
    "step_index" INTEGER NOT NULL,
    "step_name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "input" JSONB,
    "output" JSONB,
    "error" TEXT,
    "compensation_action" JSONB,
    "compensation_result" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "saga_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saga_steps_saga_id_step_index_idx" ON "saga_steps"("saga_id", "step_index");

-- AddForeignKey
ALTER TABLE "saga_steps" ADD CONSTRAINT "saga_steps_saga_id_fkey" FOREIGN KEY ("saga_id") REFERENCES "saga_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
