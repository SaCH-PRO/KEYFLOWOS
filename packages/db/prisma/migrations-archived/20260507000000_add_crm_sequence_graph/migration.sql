-- AlterTable
ALTER TABLE "crm_sequences" ADD COLUMN "graph" JSONB;

-- AlterTable
ALTER TABLE "crm_sequence_enrollments" ADD COLUMN "current_node_id" TEXT;
ALTER TABLE "crm_sequence_enrollments" ADD COLUMN "metadata" JSONB;
