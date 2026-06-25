-- Add search_vector column for PostgreSQL full-text search
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Create GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS contacts_search_idx ON contacts USING GIN(search_vector);

-- Populate existing contacts
UPDATE contacts
SET search_vector =
  setweight(to_tsvector('english', COALESCE(first_name, '')), 'A') ||
  setweight(to_tsvector('english', COALESCE(last_name, '')), 'A') ||
  setweight(to_tsvector('english', COALESCE(email, '')), 'B') ||
  setweight(to_tsvector('english', COALESCE(phone, '')), 'B') ||
  setweight(to_tsvector('english', COALESCE(company_name, '')), 'C') ||
  setweight(to_tsvector('english', COALESCE(display_name, '')), 'A') ||
  setweight(to_tsvector('english', COALESCE(segment, '')), 'C')
WHERE deleted_at IS NULL;

-- Trigger function to keep search_vector updated
CREATE OR REPLACE FUNCTION contacts_search_vector_update()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.first_name, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.last_name, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.email, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.phone, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.company_name, '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(NEW.display_name, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.segment, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if any to allow re-runs
DROP TRIGGER IF EXISTS contacts_search_vector_trigger ON contacts;

-- Create trigger
CREATE TRIGGER contacts_search_vector_trigger
  BEFORE INSERT OR UPDATE ON contacts
  FOR EACH ROW
  EXECUTE FUNCTION contacts_search_vector_update();
