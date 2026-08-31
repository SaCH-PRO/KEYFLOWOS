-- CreateTable
CREATE TABLE "project_deliverables" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'document',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "due_date" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_deliverables_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_deliverables_project_id_idx" ON "project_deliverables"("project_id");

-- CreateIndex
CREATE INDEX "project_deliverables_business_id_idx" ON "project_deliverables"("business_id");

-- CreateIndex
CREATE INDEX "project_deliverables_project_id_due_date_idx" ON "project_deliverables"("project_id", "due_date");

-- AddForeignKey
ALTER TABLE "project_deliverables" ADD CONSTRAINT "project_deliverables_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_deliverables" ADD CONSTRAINT "project_deliverables_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

