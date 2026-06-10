import { db } from './src/client';

async function main() {
  // Backfill tags from existing contacts.tags array
  await db.$executeRaw`
    INSERT INTO tags (id, business_id, name, created_at)
    SELECT DISTINCT
      gen_random_uuid()::text,
      c.business_id,
      LOWER(TRIM(t.tag)),
      CURRENT_TIMESTAMP
    FROM contacts c
    CROSS JOIN LATERAL UNNEST(c.tags) AS t(tag)
    WHERE c.tags IS NOT NULL
      AND array_length(c.tags, 1) > 0
      AND c.deleted_at IS NULL
    ON CONFLICT (business_id, name) DO NOTHING;
  `;
  console.log('Tags backfilled');

  // Backfill junction records
  await db.$executeRaw`
    INSERT INTO contact_tags (contact_id, tag_id)
    SELECT DISTINCT
      c.id,
      tag.id
    FROM contacts c
    CROSS JOIN LATERAL UNNEST(c.tags) AS t(tag)
    JOIN tags tag ON tag.business_id = c.business_id AND tag.name = LOWER(TRIM(t.tag))
    WHERE c.tags IS NOT NULL
      AND array_length(c.tags, 1) > 0
      AND c.deleted_at IS NULL
    ON CONFLICT (contact_id, tag_id) DO NOTHING;
  `;
  console.log('Contact tags junction backfilled');

  // Drop tags array column from contacts
  await db.$executeRaw`
    ALTER TABLE contacts DROP COLUMN IF EXISTS tags;
  `;
  console.log('Dropped old tags column');

  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
