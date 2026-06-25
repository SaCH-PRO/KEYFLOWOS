-- Add a content format flag to document_sections so a section can hold rich
-- HTML (e.g. imported from Google Drive with headings/lists/tables) in
-- addition to plain text. Existing rows are plain text.
ALTER TABLE "document_sections"
  ADD COLUMN IF NOT EXISTS "content_format" TEXT NOT NULL DEFAULT 'PLAIN';
