-- CreateTable
CREATE TABLE "pay_rates" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "period_type" TEXT NOT NULL DEFAULT 'hourly',
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pay_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "totalGross" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "item_count" INTEGER NOT NULL DEFAULT 0,
    "approved_at" TIMESTAMP(3),
    "approved_by_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_items" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "hours_worked" DECIMAL(8,2),
    "gross_pay" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pay_rates_business_id_idx" ON "pay_rates"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "pay_rates_business_id_assignment_id_effective_from_key" ON "pay_rates"("business_id", "assignment_id", "effective_from");

-- CreateIndex
CREATE INDEX "payroll_runs_business_id_status_idx" ON "payroll_runs"("business_id", "status");

-- CreateIndex
CREATE INDEX "payroll_items_run_id_idx" ON "payroll_items"("run_id");

-- CreateIndex
CREATE INDEX "payroll_items_business_id_idx" ON "payroll_items"("business_id");

-- AddForeignKey
ALTER TABLE "pay_rates" ADD CONSTRAINT "pay_rates_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pay_rates" ADD CONSTRAINT "pay_rates_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "org_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "org_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
