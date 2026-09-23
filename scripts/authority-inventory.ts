/**
 * Report what the effective-authority resolver cannot stand behind.
 *
 * WHY THIS EXISTS
 *
 * KF-EXEC-AUTH-001 makes the resolver refuse two classes of existing row, and refusing
 * them silently would be its own problem. Nobody could previously count either one:
 *
 *   grantor_no_longer_grantable   The grantor Membership still exists but has since
 *                                 dropped below the tier the grant conveys. The grant
 *                                 was valid when made and is not valid now, so the
 *                                 resolver stops honouring it — without touching the
 *                                 row, because it is the record of a real decision.
 *
 *   legacy_unresolvable_grantor   AuthorityGrant.grantorId is documented as a
 *                                 Membership id, but the old controller wrote
 *                                 `body.grantorId ?? req.user?.id ?? 'system'` — so
 *                                 the stored value may be a client-chosen string, a
 *                                 User id, or a sentinel. Such a grant now contributes
 *                                 nothing at decision time. This says how many.
 *
 *   stale copied authority        structure.service copies jobRole.permissions into
 *                                 Membership.permissionScopes at assignment create and
 *                                 update, and at no other time. updateJobRole does not
 *                                 re-project, deleteJobRole does not unwind, and an
 *                                 ended assignment leaves the copy behind. The guard
 *                                 reads the copy; JobRolePolicyService reads the live
 *                                 role. This says where they disagree.
 *
 * WHAT IT WILL NOT DO
 *
 * It writes NOTHING, ever — there is no --apply, deliberately. CG-REVIEW-AUTH-
 * PRECEDENCE-001 sets `repair: NONE_AUTOMATIC` for grants, and a diverged scope map has
 * no single correct answer: the copy may be a deliberate narrowing or a forgotten
 * projection, and the row cannot tell you which. Writing either guess would mint or
 * remove authority for a real person on no evidence. Compare that with
 * `backfill-founding-memberships.ts`, which does repair — because an owner with no
 * Membership has exactly one possible correct answer, and these do not.
 *
 * Usage (from repo root):
 *   pnpm tsx --env-file .env scripts/authority-inventory.ts
 */
import { db } from '@keyflow/db';
import { AuthorityInventoryService } from '../apps/server/src/core/authority/authority-inventory.service';

const service = new AuthorityInventoryService(db);

function tally<T extends { classification: string }>(rows: T[]): [string, number][] {
  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.classification] = (acc[r.classification] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).sort();
}

async function main() {
  const grants = await service.classifyGrantors();
  console.log(`\nAuthorityGrant grantors — ${grants.length} non-revoked grant(s) scanned\n`);
  for (const [cls, n] of tally(grants)) console.log(`  ${String(n).padStart(6)}  ${cls}`);

  const orphaned = grants.filter((g) => g.classification !== 'active_grantor');
  if (orphaned.length > 0) {
    console.log(`\nThese grants contribute NOTHING to the resolver and need a human decision:\n`);
    for (const g of orphaned) {
      console.log(`  ${g.grantId}  business=${g.businessId}  ${g.granteeType}/${g.scope}\n      ${g.detail}`);
    }
  }

  const copies = await service.classifyStaleCopies();
  console.log(`\nCopied authority — ${copies.length} membership(s) scanned\n`);
  for (const [cls, n] of tally(copies)) console.log(`  ${String(n).padStart(6)}  ${cls}`);

  const attention = copies.filter(
    (c) => c.classification === 'copy_diverged_from_live_jobrole' ||
           c.classification === 'scope_map_uses_non_canonical_keys' ||
           c.classification === 'copy_from_deleted_or_ended_position',
  );
  if (attention.length > 0) {
    console.log(`\nCopied scope maps that no longer track a live position:\n`);
    for (const c of attention) {
      console.log(`  ${c.membershipId}  business=${c.businessId}  role=${c.role}  ${c.classification}\n      ${c.detail}`);
    }
  }

  console.log('\nReport only — this script writes nothing.\n');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
