-- CreateTable
CREATE TABLE "business_blueprints" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "identity" JSONB NOT NULL DEFAULT '{}',
    "operating_model" JSONB NOT NULL DEFAULT '{}',
    "goals" JSONB NOT NULL DEFAULT '{}',
    "constraints" JSONB NOT NULL DEFAULT '{}',
    "brand" JSONB NOT NULL DEFAULT '{}',
    "customer_model" JSONB NOT NULL DEFAULT '{}',
    "financials" JSONB NOT NULL DEFAULT '{}',
    "intelligence" JSONB NOT NULL DEFAULT '{}',
    "completeness" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_blueprints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "business_blueprints_business_id_key" ON "business_blueprints"("business_id");

-- CreateIndex
CREATE INDEX "business_blueprints_completeness_idx" ON "business_blueprints"("completeness");

-- AddForeignKey
ALTER TABLE "business_blueprints" ADD CONSTRAINT "business_blueprints_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
