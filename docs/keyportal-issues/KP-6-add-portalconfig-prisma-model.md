# KP-6: Add `PortalConfig` Prisma model

## Milestone
Milestone 2: Portal Configuration

## Labels
`keyportal`, `database`, `schema`, `backend`

## Description
Introduce a formal configuration model for KEYPORTAL. This replaces informal JSON blobs in `Business.metaData` and `Site.siteData` for portal behavior.

## Acceptance Criteria
- [ ] `PortalConfig` model added to `packages/db/prisma/schema.prisma`.
- [ ] Model has unique constraints on `businessId` and `slug`.
- [ ] Foreign key relation to `Business` with `onDelete: Cascade`.
- [ ] Migration generated and applied successfully.
- [ ] Type-safe Prisma types are generated.
- [ ] Existing `Business` model updated with `portalConfig` relation.

## Related PR
PR 3: PortalConfig Schema & API

## Dependencies
None
