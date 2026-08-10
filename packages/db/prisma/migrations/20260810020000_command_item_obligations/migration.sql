-- CommandItem becomes the obligation ledger.
--
-- Additive only: six nullable columns, one column with a default, two indexes.
-- No existing row changes meaning — everything already in the table is a
-- suggestion, which is what `kind` defaults to.
--
-- Deliberately NOT a new table. CommandItem already carries due_at,
-- snoozed_until, risk_tier, requires_approval, executable_by_key,
-- execution_tool, execution_payload, entity_type/entity_id, contact_id and
-- expected_value, and it already has the unique that makes an obligation
-- idempotent:
--     (business_id, source_module, source_type, source_id, action_type)
-- A second table would have needed all of that again, plus a second screen,
-- plus a rule for which one /app/command-center reads.

ALTER TABLE "command_items"
  ADD COLUMN "kind"           TEXT NOT NULL DEFAULT 'SUGGESTION',
  ADD COLUMN "owed_to_type"   TEXT,
  ADD COLUMN "owed_to_id"     TEXT,
  ADD COLUMN "owed_to_label"  TEXT,
  ADD COLUMN "series_id"      TEXT,
  ADD COLUMN "discharged_at"  TIMESTAMP(3),
  ADD COLUMN "discharge_ref"  TEXT;

-- "What is due this week." The existing indexes lead on status+priority,
-- category+status and source_module+source_id; none of them can serve an
-- ordered range scan on due_at, so the query this table now exists to answer
-- would have been a sort over every open row.
CREATE INDEX "command_items_business_id_status_due_at_idx"
  ON "command_items" ("business_id", "status", "due_at");

-- Series occurrences: "show me this obligation's history" and, later,
-- "stop materialising this series".
CREATE INDEX "command_items_business_id_series_id_idx"
  ON "command_items" ("business_id", "series_id");
