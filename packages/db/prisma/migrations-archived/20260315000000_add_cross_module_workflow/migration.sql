-- CreateTable
CREATE TABLE "cross_module_workflows" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "workflow_key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "last_run_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cross_module_workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_agent_jobs" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "job_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "checkpoint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "payload" JSONB,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "executed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_agent_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cross_module_workflows_business_id_idx" ON "cross_module_workflows"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "cross_module_workflows_business_id_workflow_key_key" ON "cross_module_workflows"("business_id", "workflow_key");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_agent_jobs_business_id_entity_id_checkpoint_key" ON "scheduled_agent_jobs"("business_id", "entity_id", "checkpoint");

-- CreateIndex
CREATE INDEX "scheduled_agent_jobs_status_scheduled_for_idx" ON "scheduled_agent_jobs"("status", "scheduled_for");

-- AddForeignKey
ALTER TABLE "cross_module_workflows" ADD CONSTRAINT "cross_module_workflows_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_agent_jobs" ADD CONSTRAINT "scheduled_agent_jobs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
