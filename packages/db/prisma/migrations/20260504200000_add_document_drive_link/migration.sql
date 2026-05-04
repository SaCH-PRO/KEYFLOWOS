-- Add Drive linkage columns to document_instances so a Keyflow document
-- can be round-tripped to/from a specific Google Drive file.
ALTER TABLE "document_instances"
  ADD COLUMN IF NOT EXISTS "drive_file_id" TEXT,
  ADD COLUMN IF NOT EXISTS "drive_file_name" TEXT,
  ADD COLUMN IF NOT EXISTS "drive_file_mime_type" TEXT,
  ADD COLUMN IF NOT EXISTS "drive_last_synced_at" TIMESTAMP(3);
