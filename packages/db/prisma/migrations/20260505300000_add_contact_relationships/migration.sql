-- Add ContactRelationship edge table for the relationship graph (introductions,
-- referrals, networks). Edges are directional; inverse pairs are materialized
-- by the application layer.
CREATE TABLE IF NOT EXISTS "contact_relationships" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "from_contact_id" TEXT NOT NULL,
  "to_contact_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "since" TIMESTAMP(3),
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contact_relationships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "contact_relationships_from_contact_id_to_contact_id_type_key"
  ON "contact_relationships"("from_contact_id", "to_contact_id", "type");

CREATE INDEX IF NOT EXISTS "contact_relationships_business_id_idx"
  ON "contact_relationships"("business_id");
CREATE INDEX IF NOT EXISTS "contact_relationships_business_id_type_idx"
  ON "contact_relationships"("business_id", "type");
CREATE INDEX IF NOT EXISTS "contact_relationships_from_contact_id_idx"
  ON "contact_relationships"("from_contact_id");
CREATE INDEX IF NOT EXISTS "contact_relationships_to_contact_id_idx"
  ON "contact_relationships"("to_contact_id");

ALTER TABLE "contact_relationships"
  ADD CONSTRAINT "contact_relationships_from_contact_id_fkey"
  FOREIGN KEY ("from_contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contact_relationships"
  ADD CONSTRAINT "contact_relationships_to_contact_id_fkey"
  FOREIGN KEY ("to_contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
