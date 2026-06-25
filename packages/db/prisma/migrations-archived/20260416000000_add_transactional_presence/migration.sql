-- AlterTable
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "accepting_work" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "current_capacity" TEXT;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "lead_time" TEXT;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "preferred_project_types" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "budget_fit" TEXT;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "positioning_statement" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "network_connections" (
    "id" TEXT NOT NULL,
    "from_business_id" TEXT NOT NULL,
    "to_business_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'FOLLOW',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "network_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "network_connections_from_business_id_to_business_id_type_key" ON "network_connections"("from_business_id", "to_business_id", "type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "network_connections_from_business_id_idx" ON "network_connections"("from_business_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "network_connections_to_business_id_idx" ON "network_connections"("to_business_id");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "network_connections" ADD CONSTRAINT "network_connections_from_business_id_fkey" FOREIGN KEY ("from_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "network_connections" ADD CONSTRAINT "network_connections_to_business_id_fkey" FOREIGN KEY ("to_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
