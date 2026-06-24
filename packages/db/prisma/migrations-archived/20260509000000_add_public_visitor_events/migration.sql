-- S2 #475: anonymous public-storefront events with back-stitch

CREATE TABLE IF NOT EXISTS "public_visitor_events" (
  "id"             TEXT PRIMARY KEY,
  "business_id"    TEXT NOT NULL,
  "visitor_id"     TEXT NOT NULL,
  "contact_id"     TEXT,
  "type"           TEXT NOT NULL,
  "source_detail"  TEXT,
  "referral_code"  TEXT,
  "data"           JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "identified_at"  TIMESTAMP(3),
  CONSTRAINT "public_visitor_events_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "public_visitor_events_business_id_visitor_id_idx"
  ON "public_visitor_events" ("business_id", "visitor_id");
CREATE INDEX IF NOT EXISTS "public_visitor_events_business_id_contact_id_idx"
  ON "public_visitor_events" ("business_id", "contact_id");
CREATE INDEX IF NOT EXISTS "public_visitor_events_business_id_type_created_at_idx"
  ON "public_visitor_events" ("business_id", "type", "created_at");
