-- AlterTable
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "location" TEXT;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "location_place_id" TEXT;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "location_lat_lng" JSONB;

-- Backfill: extract any "Location: ..." prefix that the booking form previously
-- stuffed into the notes column into the dedicated location column. We only
-- touch rows whose notes column starts with the marker and have not already
-- had their location populated, so this migration is safe to re-run.
UPDATE "bookings"
SET
  "location" = NULLIF(
    TRIM(BOTH FROM SUBSTRING("notes" FROM 11 FOR (
      CASE
        WHEN POSITION(E'\n\n' IN "notes") > 0 THEN POSITION(E'\n\n' IN "notes") - 11
        ELSE LENGTH("notes") - 10
      END
    ))),
    ''
  ),
  "notes" = NULLIF(
    CASE
      WHEN POSITION(E'\n\n' IN "notes") > 0
        THEN SUBSTRING("notes" FROM POSITION(E'\n\n' IN "notes") + 2)
      ELSE ''
    END,
    ''
  )
WHERE "notes" LIKE 'Location: %' AND "location" IS NULL;
