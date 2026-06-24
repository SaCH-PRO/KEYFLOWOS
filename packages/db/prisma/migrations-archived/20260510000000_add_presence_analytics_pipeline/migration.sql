-- S4 #479: First-party public-event capture pipeline + daily roll-ups.

-- public_events is range-partitioned by `ts` (monthly) so the nightly
-- TTL cleanup can drop entire partitions instead of issuing wide
-- DELETEs. The Prisma model treats `id` as the logical PK; the actual
-- table uses (id, ts) because PG requires the partition key in PK.
CREATE TABLE IF NOT EXISTS "public_events" (
  "id"           TEXT NOT NULL,
  "business_id"  TEXT NOT NULL,
  "visitor_id"   TEXT NOT NULL,
  "session_id"   TEXT,
  "contact_id"   TEXT,
  "type"         TEXT NOT NULL,
  "path"         TEXT,
  "source"       TEXT,
  "medium"       TEXT,
  "campaign"     TEXT,
  "referrer"     TEXT,
  "payload"      JSONB NOT NULL DEFAULT '{}'::jsonb,
  "ip_hash"      TEXT,
  "ts"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "public_events_pkey" PRIMARY KEY ("id", "ts")
) PARTITION BY RANGE ("ts");

-- Provision rolling monthly partitions covering the current and next
-- 6 months, plus a default partition so writes outside the provisioned
-- window never fail. Operators add new partitions ahead of time via
-- the maintenance job (or this same migration on next release).
DO $$
DECLARE
  m DATE;
  pname TEXT;
  next_m DATE;
BEGIN
  FOR i IN -1..7 LOOP
    m := date_trunc('month', NOW())::DATE + (i || ' month')::INTERVAL;
    next_m := m + INTERVAL '1 month';
    pname := 'public_events_' || to_char(m, 'YYYY_MM');
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF "public_events"
        FOR VALUES FROM (%L) TO (%L)',
      pname, m, next_m
    );
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS "public_events_default" PARTITION OF "public_events" DEFAULT;

-- Indexes on the partitioned parent automatically propagate to every
-- partition (CREATE INDEX is partition-aware in PG ≥ 11).
CREATE INDEX IF NOT EXISTS "public_events_business_id_ts_idx"
  ON "public_events" ("business_id", "ts");
CREATE INDEX IF NOT EXISTS "public_events_business_id_type_ts_idx"
  ON "public_events" ("business_id", "type", "ts");
CREATE INDEX IF NOT EXISTS "public_events_business_id_visitor_id_idx"
  ON "public_events" ("business_id", "visitor_id");
CREATE INDEX IF NOT EXISTS "public_events_business_id_session_id_idx"
  ON "public_events" ("business_id", "session_id");

CREATE TABLE IF NOT EXISTS "public_visitors" (
  "business_id"    TEXT NOT NULL,
  "visitor_id"     TEXT NOT NULL,
  "first_source"   TEXT,
  "first_medium"   TEXT,
  "first_campaign" TEXT,
  "first_referrer" TEXT,
  "first_path"     TEXT,
  "first_seen_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "contact_id"     TEXT,
  CONSTRAINT "public_visitors_pkey" PRIMARY KEY ("business_id", "visitor_id"),
  CONSTRAINT "public_visitors_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "public_visitors_business_id_last_seen_at_idx"
  ON "public_visitors" ("business_id", "last_seen_at");
CREATE INDEX IF NOT EXISTS "public_visitors_business_id_contact_id_idx"
  ON "public_visitors" ("business_id", "contact_id");

CREATE TABLE IF NOT EXISTS "presence_daily_stats" (
  "id"           TEXT PRIMARY KEY,
  "business_id"  TEXT NOT NULL,
  "day"          DATE NOT NULL,
  "metric"       TEXT NOT NULL,
  "dimension"    TEXT NOT NULL,
  "dim_key"      TEXT NOT NULL,
  "count"        INTEGER NOT NULL DEFAULT 0,
  "uniques"      INTEGER NOT NULL DEFAULT 0,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "presence_daily_stats_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "presence_daily_stats_unique_idx"
  ON "presence_daily_stats" ("business_id", "day", "metric", "dimension", "dim_key");
CREATE INDEX IF NOT EXISTS "presence_daily_stats_business_id_day_idx"
  ON "presence_daily_stats" ("business_id", "day");
CREATE INDEX IF NOT EXISTS "presence_daily_stats_business_id_metric_day_idx"
  ON "presence_daily_stats" ("business_id", "metric", "day");
