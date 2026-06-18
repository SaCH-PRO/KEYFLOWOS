-- CreateTable
CREATE TABLE "business_assets" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "provider" TEXT,
    "url" TEXT,
    "identifier" TEXT,
    "owner" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "verified_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "business_assets_business_id_idx" ON "business_assets"("business_id");

-- CreateIndex
CREATE INDEX "business_assets_business_id_type_idx" ON "business_assets"("business_id", "type");

-- CreateIndex
CREATE INDEX "business_assets_business_id_status_idx" ON "business_assets"("business_id", "status");

-- AddForeignKey
ALTER TABLE "business_assets" ADD CONSTRAINT "business_assets_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

