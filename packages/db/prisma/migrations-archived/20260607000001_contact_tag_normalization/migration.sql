-- Create tags table
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  business_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  description TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS tags_business_id_name_key ON tags(business_id, name);
CREATE INDEX IF NOT EXISTS tags_business_id_idx ON tags(business_id);

-- Create contact_tags junction table
CREATE TABLE IF NOT EXISTS contact_tags (
  contact_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (contact_id, tag_id)
);

CREATE INDEX IF NOT EXISTS contact_tags_contact_id_idx ON contact_tags(contact_id);
CREATE INDEX IF NOT EXISTS contact_tags_tag_id_idx ON contact_tags(tag_id);

-- Add foreign keys
ALTER TABLE contact_tags
  ADD CONSTRAINT contact_tags_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
  ADD CONSTRAINT contact_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE;

-- Backfill: create tags from existing contacts.tags array
INSERT INTO tags (id, business_id, name, created_at)
SELECT DISTINCT
  gen_random_uuid()::text,
  c.business_id,
  LOWER(TRIM(t)),
  CURRENT_TIMESTAMP
FROM contacts c,
  UNNEST(c.tags) AS t
WHERE c.tags IS NOT NULL
  AND array_length(c.tags, 1) > 0
  AND c.deleted_at IS NULL
ON CONFLICT (business_id, name) DO NOTHING;

-- Backfill: create junction records
INSERT INTO contact_tags (contact_id, tag_id)
SELECT DISTINCT
  c.id,
  tag.id
FROM contacts c,
  UNNEST(c.tags) AS t
JOIN tags tag ON tag.business_id = c.business_id AND tag.name = LOWER(TRIM(t))
WHERE c.tags IS NOT NULL
  AND array_length(c.tags, 1) > 0
  AND c.deleted_at IS NULL
ON CONFLICT (contact_id, tag_id) DO NOTHING;

-- Drop tags array column from contacts
ALTER TABLE contacts DROP COLUMN IF EXISTS tags;
