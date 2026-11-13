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
writes no Membership on a business it did not create and never changes a role.
It answers only a business the caller is a member of (review OMV-2): their
bootstrap business (the oldest one they own) when they are a member there, else
the oldest business they own and are a member of, else the business of their
oldest Membership on a live business (`isNewBusiness: false` for all three). It
answers 403 `OWNER_MEMBERSHIP_REQUIRED` only to a caller recorded as
`Business.ownerId` who is a member of no live business, until this script (or a
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

From `apps/server`. `DATABASE_URL` comes from the environment, else from the
repo-root `.env` (`tsx --env-file-if-exists=../../.env`; a variable already set
wins over the file). `@keyflow/db` must be built (`pnpm --filter @keyflow/db
build`): the script imports its `dist/src/client.js` through `node_modules`.
The package.json script runs tsx with `apps/server/scripts/tsconfig.json`. Do
not run the file with a bare `tsx` from a checkout of `apps/server`: tsx then
applies `apps/server/tsconfig.json`, whose `paths` point `@keyflow/db` at
`packages/db/dist/src/client.d.ts` (for tsc), `db` is undefined, and the run
dies with `Cannot read properties of undefined (reading '$disconnect')`.

```bash
# 1. Dry run (the default): counts only, writes nothing.
pnpm backfill:owner-memberships

# 2. The businesses to review (another member holds OWNER): ids only.
pnpm backfill:owner-memberships --list-conflicting

# 3. Write the plain class (each grant audited).
pnpm backfill:owner-memberships --apply

# 4. Only after reviewing the list: write the with_another_owner class too.
pnpm backfill:owner-memberships --apply --include-conflicting

# 5. Re-run: idempotent; written reads 0.
pnpm backfill:owner-memberships --apply
```

The output is counts only (no business, user, name or email), except the
business ids `--list-conflicting` asks for: `businesses_scanned`,
`owner_is_member`, `missing_owner_membership`, `with_another_owner`,
`skipped_with_another_owner`, `skipped_owner_unresolvable`, then `would_write`
(dry run) or `written`, `already_present` and `failed` (with error codes only)
for `--apply`.

Exit status: 0 done, 1 the scan or a write failed (rows already written stay;
re-run to finish), 2 an unknown argument. The process lingers about 30 seconds
after printing its counts (the `@keyflow/db` connection pool's idle timeout)
before it exits; that is not a hang.

## On the production box

The API image (`Dockerfile`, target `server`) carries `apps/server/dist`,
`packages/db/dist` and the workspace `node_modules` (tsx included), but no
`apps/server/scripts/` and no `tsconfig.json`. Mount the checkout's scripts
directory read-only into the API container and run the script there, from the
project root on the box, after the deploy that carries the D-104 alignment:

```bash
# 1. Dry run (the default): counts only, writes nothing.
docker compose --env-file .env.production -f docker-compose.production.yml run --rm -T \
  -v "$PWD/apps/server/scripts:/app/apps/server/scripts:ro" -w /app/apps/server \
  api npx tsx scripts/backfill-owner-memberships.ts

# 2. Then, as above, with --list-conflicting, --apply, and only after review
#    --apply --include-conflicting, appended after the script name.
```

Why this resolves: `DATABASE_URL` is the one compose sets for the `api`
service (`docker-compose.production.yml`), pointing at the `db` container. With
no `tsconfig.json` in `/app/apps/server` or above it, tsx applies no `paths`,
and `@keyflow/db` resolves through `node_modules` to `packages/db`'s
`dist/src/client.js`, the file the API itself runs. The script imports nothing
else. `apps/server/test/backfill-scripts-cli.integration.test.ts` [BSC-05] runs
it in that shape (the script alone, no `tsconfig.json` anywhere above it,
`@keyflow/db` only through `node_modules`) against a real database. Take a
backup first (`scripts/deploy.sh` takes one at every deploy).

## Related

- `scripts/backfill-founding-memberships.ts` at the repo root (KF-EXEC-TENANT-001)
  is the older inventory: it prints business ids and names and writes only where
  nobody else holds OWNER. FoundingMembershipService keeps classifying a business
  whose OWNER row belongs to another user as `conflicting_owner_membership`.
- Proof that the package.json scripts and the production command run:
  `apps/server/test/backfill-scripts-cli.integration.test.ts` (BSC-01..05).
- Proof: `apps/server/test/owner-membership-backfill.integration.test.ts`
  (OMB-01..OMB-17; OMB-14..OMB-16 are the bootstrap's answers, OMB-09 and
  OMB-17 the source census and its self-test) and
  `apps/server/test/books-read-scope.integration.test.ts` ([BRS-12]).
