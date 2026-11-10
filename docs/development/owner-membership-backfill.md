# Owner membership backfill (owner ruling D-104)

Packet: W10-OWNER-MEMBERSHIP. Script: `apps/server/scripts/backfill-owner-memberships.ts`.

## Why

Owner ruling D-104: a Membership row is the single rule for business access.
An owner recorded only as `Business.ownerId`, with no Membership row on that
business, is refused everywhere: BusinessGuard (`userCanAccessBusiness`), the
tenant TenantInterceptor installs on AuthGuard-only routes, workspace discovery
(`IdentityService.listBusinesses`), the route-level `ensureAccess` checks and the
owner checks (D-11, D-94, D-99 and the rest) no longer admit the ownerId arm on
its own. ModuleScopeGuard and D-73 already refused such an owner.

Every business constructor has written its founding OWNER Membership since
KF-EXEC-TENANT-001 (`IdentityService.createBusiness`, the bootstrap
`ensureBootstrapWorkspace`, the tRPC `identity.createBusiness`). Businesses
created before that can still have an owner recorded only as ownerId. Run the
backfill when the D-104 alignment deploys, so those owners keep the access they
had.

## What it writes

For each non-deleted business whose `ownerId` names a User row holding no
Membership on that business: `{ userId: ownerId, businessId, role: 'OWNER' }`,
the row the identity bootstrap writes (schema defaults: no permission scopes,
approval tier 0). Also where another member already holds OWNER: that ownerId
owner was admitted by the ownerId arm until D-104, so the row keeps their access
rather than granting new authority. Such businesses are counted as
`with_another_owner` for review.

It skips (and counts) an ownerId that is already a member there (any role; the
role is never changed) and an ownerId that names no User row
(`skipped_owner_unresolvable`; there is nobody to grant anything to). It never
reads soft-deleted businesses, never deletes a Membership and never edits
`Business.ownerId`.

## How to run

From `apps/server` (reads `DATABASE_URL` from the repo-root `.env`):

```bash
# 1. Dry run (the default): counts only, writes nothing.
pnpm exec tsx --env-file ../../.env scripts/backfill-owner-memberships.ts

# 2. Write the missing rows.
pnpm exec tsx --env-file ../../.env scripts/backfill-owner-memberships.ts --apply

# 3. Re-run: idempotent; missing_owner_membership and written read 0.
pnpm exec tsx --env-file ../../.env scripts/backfill-owner-memberships.ts --apply
```

The output is counts only (no business, user, name or email):
`businesses_scanned`, `owner_is_member`, `missing_owner_membership`,
`with_another_owner`, `skipped_owner_unresolvable`, then `would_write` (dry run)
or `written`, `already_present` and `failed` (with error codes only) for
`--apply`.

Exit status: 0 done, 1 the scan or a write failed (rows already written stay;
re-run to finish), 2 an unknown argument.

## Related

- `scripts/backfill-founding-memberships.ts` at the repo root (KF-EXEC-TENANT-001)
  is the older inventory: it prints business ids and names and writes only where
  nobody else holds OWNER. FoundingMembershipService keeps classifying a business
  whose OWNER row belongs to another user as `conflicting_owner_membership`.
- Proof: `apps/server/test/owner-membership-backfill.integration.test.ts`
  (OMB-01..OMB-09) and `apps/server/test/books-read-scope.integration.test.ts`
  ([BRS-12]).
