/**
 * Inventory, classify and (optionally) repair founding OWNER Memberships.
 *
 * WHY THIS EXISTS
 *
 * KF-EXEC-TENANT-001 makes every Business constructor establish exactly one
 * founding OWNER Membership atomically. That fixes the future. It does nothing
 * for Businesses created before the fix, and there were two constructors that
 * wrote no Membership at all — `POST /identity/businesses` and the tRPC
 * `identity.createBusiness` mutation.
 *
 * An owner with no Membership is not a cosmetic problem. BusinessGuard accepts
 * `ownerId` OR Membership and lets them through; ModuleScopeGuard reads
 * `membership.findUnique` and throws 'Not a member of this business'. So the
 * affected owners can open their business and are then refused by every
 * `@RequireModuleScope` route in the application.
 *
 * Before this script there was no way to even count them: no migration, no
 * classifier, no query. `scripts/check-membership.ts` prints one hardcoded row.
 *
 * WHAT IT WILL AND WILL NOT DO
 *
 * It repairs exactly one class — `missing_founding_membership_with_resolvable_owner`,
 * where `ownerId` names a real User, that user holds no Membership on the
 * business, and nobody else holds OWNER there. That state has one possible
 * correct answer, so writing it is deterministic rather than a guess.
 *
 * It will NOT touch:
 *   - conflicting_owner_membership    — a live claim disagrees with ownerId
 *   - ownerId_unresolvable_to_User    — ownerId names no User (or is '')
 *   - otherwise_ambiguous             — e.g. several OWNER rows, none the owner
 *
 * Those are printed for a human to resolve. Guessing would mint authority for
 * the wrong identity, which is worse than leaving the row visibly broken.
 *
 * SAFETY
 *
 * Dry-run by default: it classifies and prints, and writes nothing unless
 * `--apply` is passed. The repair is an upsert against
 * `@@unique([userId, businessId])` and is idempotent, so re-running is safe and
 * a row created by a concurrent bootstrap in the meantime is converged on
 * rather than duplicated or overwritten.
 *
 * It never deletes a Membership, never edits `Business.ownerId`, and never
 * changes the role on a Membership that already exists.
 *
 * Usage (from repo root):
 *   pnpm tsx --env-file .env scripts/backfill-founding-memberships.ts          # report only
 *   pnpm tsx --env-file .env scripts/backfill-founding-memberships.ts --apply  # repair the safe class
 */
import { db, skipTenantIsolation } from '@keyflow/db';

type FoundingMembershipClass =
  | 'exact_owner_membership_match'
  | 'missing_founding_membership_with_resolvable_owner'
  | 'conflicting_owner_membership'
  | 'ownerId_unresolvable_to_User'
  | 'otherwise_ambiguous';

interface Row {
  businessId: string;
  businessName: string;
  ownerId: string;
  classification: FoundingMembershipClass;
  detail: string;
}

/**
 * Deliberately a standalone re-implementation of FoundingMembershipService's
 * classifier rather than an import of it. Pulling the Nest service in would drag
 * the whole DI graph into a CLI script. The service is the tested one; this
 * mirrors it, and `apps/server/src/modules/identity/tenant-genesis.spec.ts` is what proves
 * the classification rules.
 */
async function classify(): Promise<Row[]> {
  const businesses = await db.business.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, ownerId: true },
    orderBy: { createdAt: 'asc' },
  });
  if (businesses.length === 0) return [];

  const memberships = await db.membership.findMany(
    skipTenantIsolation({
      where: { businessId: { in: businesses.map((b) => b.id) } },
      select: { businessId: true, userId: true, role: true },
    }),
  );

  const ownerIds = [...new Set(businesses.map((b) => b.ownerId).filter(Boolean))];
  const knownUsers = new Set(
    (await db.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true } })).map((u) => u.id),
  );

  const byBusiness = new Map<string, { userId: string; role: string }[]>();
  for (const m of memberships) {
    const list = byBusiness.get(m.businessId) ?? [];
    list.push({ userId: m.userId, role: m.role });
    byBusiness.set(m.businessId, list);
  }

  return businesses.map((business) => {
    const members = byBusiness.get(business.id) ?? [];
    const ownerMembership = members.find((m) => m.userId === business.ownerId);
    const ownerRoleHolders = members.filter((m) => m.role === 'OWNER');

    let classification: FoundingMembershipClass;
    let detail: string;

    if (!business.ownerId || !knownUsers.has(business.ownerId)) {
      classification = 'ownerId_unresolvable_to_User';
      detail = business.ownerId ? `ownerId ${business.ownerId} matches no User row` : 'ownerId is empty';
    } else if (ownerMembership) {
      if (ownerMembership.role === 'OWNER') {
        classification = 'exact_owner_membership_match';
        detail = 'owner holds an OWNER Membership';
      } else {
        classification = 'conflicting_owner_membership';
        detail = `owner holds Membership with role ${ownerMembership.role}, not OWNER`;
      }
    } else if (ownerRoleHolders.length === 1) {
      classification = 'conflicting_owner_membership';
      detail = `OWNER Membership is held by ${ownerRoleHolders[0].userId}, not ownerId`;
    } else if (ownerRoleHolders.length > 1) {
      classification = 'otherwise_ambiguous';
      detail = `${ownerRoleHolders.length} OWNER Memberships exist and none belongs to ownerId`;
    } else {
      classification = 'missing_founding_membership_with_resolvable_owner';
      detail = 'owner resolves to a User and no Membership exists on this business';
    }

    return { businessId: business.id, businessName: business.name, ownerId: business.ownerId, classification, detail };
  });
}

async function main() {
  const apply = process.argv.includes('--apply');
  const rows = await classify();

  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.classification] = (acc[r.classification] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`\nFounding OWNER Membership inventory — ${rows.length} non-deleted businesses scanned\n`);
  for (const [cls, n] of Object.entries(counts).sort()) console.log(`  ${String(n).padStart(6)}  ${cls}`);

  const needsHuman = rows.filter((r) => r.classification !== 'exact_owner_membership_match' && r.classification !== 'missing_founding_membership_with_resolvable_owner');
  if (needsHuman.length > 0) {
    console.log(`\nRequires explicit repair — NOT touched by this script:\n`);
    for (const r of needsHuman) console.log(`  ${r.businessId}  ${r.classification}\n      ${r.businessName} — ${r.detail}`);
  }

  const repairable = rows.filter((r) => r.classification === 'missing_founding_membership_with_resolvable_owner');
  if (repairable.length === 0) {
    console.log('\nNothing deterministic to repair.\n');
    return;
  }

  if (!apply) {
    console.log(`\n${repairable.length} business(es) would receive a founding OWNER Membership. Re-run with --apply to write them:\n`);
    for (const r of repairable) console.log(`  ${r.businessId}  ${r.businessName}  owner=${r.ownerId}`);
    console.log('');
    return;
  }

  let written = 0;
  const failed: { businessId: string; reason: string }[] = [];
  for (const r of repairable) {
    // Per row. One unwritable row must not abort the rest of the batch; it is
    // reported and a re-run picks it up if it is still deterministic.
    try {
      await db.membership.upsert(
        skipTenantIsolation({
          where: { userId_businessId: { userId: r.ownerId, businessId: r.businessId } },
          create: { userId: r.ownerId, businessId: r.businessId, role: 'OWNER' },
          update: {},
        }),
      );
      written += 1;
      console.log(`  repaired ${r.businessId} (${r.businessName})`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failed.push({ businessId: r.businessId, reason });
      console.warn(`  SKIPPED ${r.businessId} (${r.businessName}): ${reason}`);
    }
  }
  console.log(`\nWrote ${written} founding OWNER Membership(s). ${needsHuman.length} row(s) still need explicit repair.`);
  if (failed.length > 0) {
    console.log(`${failed.length} deterministic row(s) could not be written and were skipped.`);
    process.exitCode = 1;
  }
  console.log('');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
