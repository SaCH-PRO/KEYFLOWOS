-- R3: stale-quote follow-up bookkeeping. When a user acts on a
-- "Follow up on stale quote" Action Queue card we stamp this column
-- so the daily scan no longer surfaces the same quote.
ALTER TABLE "quotes"
  ADD COLUMN IF NOT EXISTS "last_follow_up_at" TIMESTAMP(3);
