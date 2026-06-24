-- M3: Add Deals and DealStages

CREATE TABLE "deal_stages" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "color" TEXT,
  "category" TEXT NOT NULL DEFAULT 'OPEN',
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "archived_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "deal_stages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "deal_stages_business_id_slug_key" ON "deal_stages"("business_id", "slug");
CREATE INDEX "deal_stages_business_id_position_idx" ON "deal_stages"("business_id", "position");

ALTER TABLE "deal_stages"
  ADD CONSTRAINT "deal_stages_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "deals" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "contact_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "company_name" TEXT,
  "value" DOUBLE PRECISION,
  "currency" TEXT NOT NULL DEFAULT 'TTD',
  "stage_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "probability" INTEGER,
  "owner_user_id" TEXT,
  "source" TEXT,
  "source_detail" TEXT,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "notes" TEXT,
  "expected_close_at" TIMESTAMP(3),
  "won_at" TIMESTAMP(3),
  "lost_at" TIMESTAMP(3),
  "loss_reason" TEXT,
  "last_stage_changed_at" TIMESTAMP(3),
  "quote_id" TEXT,
  "invoice_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "deals_business_id_status_idx" ON "deals"("business_id", "status");
CREATE INDEX "deals_business_id_stage_id_idx" ON "deals"("business_id", "stage_id");
CREATE INDEX "deals_business_id_owner_user_id_idx" ON "deals"("business_id", "owner_user_id");
CREATE INDEX "deals_business_id_expected_close_at_idx" ON "deals"("business_id", "expected_close_at");
CREATE INDEX "deals_contact_id_idx" ON "deals"("contact_id");
CREATE INDEX "deals_business_id_deleted_at_idx" ON "deals"("business_id", "deleted_at");

ALTER TABLE "deals"
  ADD CONSTRAINT "deals_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "deals"
  ADD CONSTRAINT "deals_contact_id_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "deals"
  ADD CONSTRAINT "deals_stage_id_fkey"
  FOREIGN KEY ("stage_id") REFERENCES "deal_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
