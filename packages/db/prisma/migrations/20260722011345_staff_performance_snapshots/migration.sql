-- CreateTable
CREATE TABLE "staff_performance_snapshots" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "tasks_assigned" INTEGER NOT NULL DEFAULT 0,
    "tasks_completed" INTEGER NOT NULL DEFAULT 0,
    "tasks_on_time" INTEGER NOT NULL DEFAULT 0,
    "tasks_overdue_open" INTEGER NOT NULL DEFAULT 0,
    "hours_worked" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "expected_hours" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "approvals_handled" INTEGER NOT NULL DEFAULT 0,
    "avg_approval_response_hours" DECIMAL(8,2),
    "overall_score" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_performance_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_performance_snapshots_business_id_idx" ON "staff_performance_snapshots"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_performance_snapshots_business_id_assignment_id_perio_key" ON "staff_performance_snapshots"("business_id", "assignment_id", "period_start", "period_end");

-- AddForeignKey
ALTER TABLE "staff_performance_snapshots" ADD CONSTRAINT "staff_performance_snapshots_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_performance_snapshots" ADD CONSTRAINT "staff_performance_snapshots_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "org_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
