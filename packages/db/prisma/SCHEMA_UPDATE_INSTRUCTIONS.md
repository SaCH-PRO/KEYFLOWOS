# Schema Update Instructions for KeyConnector

## Automatic (Recommended)

```bash
git checkout feat/key-connector-db-trpc
git apply packages/db/prisma/SCHEMA_UPDATE.patch
npx prisma migrate dev --name add_key_connector_fields
npx prisma generate
```

## Manual

### Change 1: Add fields to IntegrationConnection model

Find `model IntegrationConnection` and add these fields:
- `displayName String? @map("display_name")` (after `providerKey`)
- `authData Json? @map("auth_data")` (after `authDataRef`)
- `healthScore Int @default(100) @map("health_score")` (after `authData`)

### Change 2: Append at end of file

Add the `ConnectorAuditLog` model (see patch file for full definition).

### Then run
```bash
cd packages/db
npx prisma migrate dev --name add_key_connector_fields
npx prisma generate
```
