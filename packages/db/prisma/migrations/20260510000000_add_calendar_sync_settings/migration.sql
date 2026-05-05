-- C4: Per-event-type Google Calendar sync settings JSON on Business.
ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "calendar_sync_settings" JSONB;
