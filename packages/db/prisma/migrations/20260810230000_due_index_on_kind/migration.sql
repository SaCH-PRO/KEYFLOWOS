-- Replace the "due this week" index with one that the query can actually use.
--
-- 20260810020000 added (business_id, status, due_at) with a comment claiming it
-- served the due query. It does not, and the reason is worth writing down
-- because the index LOOKED right:
--
--   findDue filters `status NOT IN ('COMPLETED','DISMISSED','EXECUTED','FAILED')`.
--   A negative predicate is not a seekable equality. Postgres can use the
--   leading business_id column and then stops — so due_at, which sits BEHIND
--   status in the index, is never used as a range, and the query degrades to a
--   scan-and-sort of every row for the business.
--
--   The equality match in that query is `kind = 'OBLIGATION'`. Putting kind
--   second makes due_at the third column behind two equalities, which is the
--   shape an ordered range scan needs.
--
-- Cheap to correct now: production holds 7 rows in this table, all suggestions.
-- Left alone it would have been a scan that only started hurting at the point
-- the feature succeeded.

DROP INDEX IF EXISTS "command_items_business_id_status_due_at_idx";

CREATE INDEX "command_items_business_id_kind_due_at_idx"
  ON "command_items" ("business_id", "kind", "due_at");
