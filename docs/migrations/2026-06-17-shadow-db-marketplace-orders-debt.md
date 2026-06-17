# Migration Technical Debt: Shadow DB Failure on `marketplace_orders`

**Date:** 2026-06-17  
**Discovered during:** Business Genome Phase 1 Prisma migration  
**Migration:** `packages/db/prisma/migrations/20260405000000_add_business_guidance_engine/migration.sql`

---

## Problem

`prisma migrate dev` fails when Prisma builds a fresh shadow database because the migration referenced above contains:

```sql
CREATE INDEX IF NOT EXISTS "marketplace_orders_metadata_public_token_idx"
  ON "marketplace_orders" ((metadata->>'publicToken'))
  WHERE metadata->>'publicToken' IS NOT NULL;
```

The underlying table `marketplace_orders` no longer exists in the current schema. `CREATE INDEX IF NOT EXISTS` does not guard against a missing table in PostgreSQL, so applying this migration to a clean database errors out with:

```text
P3006
Migration `20260405000000_add_business_guidance_engine` failed to apply cleanly to the shadow database.
The underlying table for model `marketplace_orders` does not exist.
```

## Impact

- `prisma migrate dev` cannot be used until this is fixed.
- `prisma migrate deploy` still works because it skips already-applied migrations.
- New migrations can be created and applied manually (see Workaround).

## Workaround Used

For Business Genome Phase 1, the migration was generated via `prisma migrate diff` and applied with `prisma migrate deploy`:

```bash
pnpm exec prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script

# SQL saved to packages/db/prisma/migrations/20260617155142_business_genome_phase_1/migration.sql
pnpm exec prisma migrate deploy --schema=./prisma/schema.prisma
```

This avoids the shadow database entirely and relies on `_prisma_migrations` to skip the broken historical migration on existing databases.

## Recommended Fix

1. Decide whether `marketplace_orders` is permanently gone.
   - If yes, edit `20260405000000_add_business_guidance_engine/migration.sql` to guard the index creation:
     ```sql
     DO $$
     BEGIN
       IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'marketplace_orders') THEN
         CREATE INDEX IF NOT EXISTS "marketplace_orders_metadata_public_token_idx"
           ON "marketplace_orders" ((metadata->>'publicToken'))
           WHERE metadata->>'publicToken' IS NOT NULL;
       END IF;
     END $$;
     ```
   - If the table should exist, restore the model in `schema.prisma` and create a migration to add it back.
2. Coordinate the edit with any environments where `20260405000000_add_business_guidance_engine` has not yet run. Because the migration is already recorded as applied in existing databases, the safest path is usually to leave the production DB alone and only fix the migration file so future shadow databases can be built.
3. After fixing, verify `prisma migrate dev` works end-to-end.

## Notes

- This is purely a migration-history hygiene issue. The production database schema is consistent.
- Any future migrations should continue to use `migrate deploy` for production and staging.
