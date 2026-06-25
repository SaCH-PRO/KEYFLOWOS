-- R2: quote lifecycle tracking + public view tokens.
-- Adds signed-token-style public access + per-stage timestamps so the
-- visual state machine (Drafted → Sent → Viewed → Accepted → Invoiced
-- → Paid) can render an authoritative current step and stale-quote
-- detection can compare sentAt against today.

ALTER TABLE "quotes"
  ADD COLUMN IF NOT EXISTS "view_token"  TEXT,
  ADD COLUMN IF NOT EXISTS "sent_at"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "viewed_at"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "accepted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rejected_at" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "quotes_view_token_key" ON "quotes"("view_token");
CREATE INDEX IF NOT EXISTS "quotes_business_id_status_sent_at_idx" ON "quotes"("business_id", "status", "sent_at");
