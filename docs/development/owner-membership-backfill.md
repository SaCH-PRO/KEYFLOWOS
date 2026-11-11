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
backfill when the D-104 alignment deploys. The sign-in bootstrap
(`POST /identity/bootstrap`) no longer heals them: since review SEC-W10OM-3 it
writes no Membership on a business it did not create, never changes a role, and
answers such an owner 403 `OWNER_MEMBERSHIP_REQUIRED` until this script (or a
hand repair) writes their row.

## What it writes

For each non-deleted business whose `ownerId` names a User row holding no
Membership on that business, and where no other member holds OWNER (the plain
legacy shape): `{ userId: ownerId, businessId, role: 'OWNER' }`, the row the
identity bootstrap writes for a business it creates (schema defaults: no
permission scopes, approval tier 0). Each row is written in one transaction with
a `team_activity_logs` audit row (module `team`, action
`owner_membership_backfilled`, the Membership as its entity, meta naming the
script, D-104 and whether another OWNER existed).

The row is a grant, not a restoration: an OWNER Membership carries every module
and team admin (ModuleScopeGuard refused an ownerId-only owner before D-104),
and the team routes cannot remove it.

## What it does not write by default (review SEC-W10OM-2)

`with_another_owner`: the ownerId user holds no Membership but another member
holds OWNER. That shape also arises when the OWNER removed the ownerId user on
purpose, so it is counted (`skipped_with_another_owner`) and not written.
FoundingMembershipService keeps the same class (`conflicting_owner_membership`)
for explicit repair. Review those businesses first: `--list-conflicting` prints
their business ids (ids only, never a user, name or email). Then either repair
by hand or re-run with `--apply --include-conflicting`, which writes them too,
audited like the rest.

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

# 2. The businesses to review (another member holds OWNER): ids only.
pnpm exec tsx --env-file ../../.env scripts/backfill-owner-memberships.ts --list-conflicting

# 3. Write the plain class (each grant audited).
pnpm exec tsx --env-file ../../.env scripts/backfill-owner-memberships.ts --apply

# 4. Only after reviewing the list: write the with_another_owner class too.
pnpm exec tsx --env-file ../../.env scripts/backfill-owner-memberships.ts --apply --include-conflicting

# 5. Re-run: idempotent; written reads 0.
pnpm exec tsx --env-file ../../.env scripts/backfill-owner-memberships.ts --apply
```

The output is counts only (no business, user, name or email), except the
business ids `--list-conflicting` asks for: `businesses_scanned`,
`owner_is_member`, `missing_owner_membership`, `with_another_owner`,
`skipped_with_another_owner`, `skipped_owner_unresolvable`, then `would_write`
(dry run) or `written`, `already_present` and `failed` (with error codes only)
for `--apply`.

Exit status: 0 done, 1 the scan or a write failed (rows already written stay;
re-run to finish), 2 an unknown argument.

## Related

- `scripts/backfill-founding-memberships.ts` at the repo root (KF-EXEC-TENANT-001)
  is the older inventory: it prints business ids and names and writes only where
  nobody else holds OWNER. FoundingMembershipService keeps classifying a business
  whose OWNER row belongs to another user as `conflicting_owner_membership`.
- Proof: `apps/server/test/owner-membership-backfill.integration.test.ts`
  (OMB-01..OMB-13) and `apps/server/test/books-read-scope.integration.test.ts`
  ([BRS-12]).
