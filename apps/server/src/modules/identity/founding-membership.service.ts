import { Inject, Injectable, Logger } from '@nestjs/common';
import { skipTenantIsolation } from '@keyflow/db';
import { PrismaService } from '../../core/prisma/prisma.service';

/**
 * Every state a Business can be in with respect to its founding OWNER
 * Membership. Exactly one applies to any given Business.
 *
 * Only ONE of these is repairable without guessing. The rest are reported.
 */
export type FoundingMembershipClass =
  /** Owner resolves to a User and holds an OWNER Membership. Nothing to do. */
  | 'exact_owner_membership_match'
  /**
   * Owner resolves to a User, holds no Membership at all on this Business, and
   * nobody else holds OWNER here. The founding relationship is unambiguous and
   * simply absent, so it can be written deterministically.
   */
  | 'missing_founding_membership_with_resolvable_owner'
  /**
   * The owner holds a Membership with a role other than OWNER, or a single
   * different user already holds OWNER. Either way there is a live claim that
   * disagrees with `ownerId`, and choosing between them is a judgement call.
   */
  | 'conflicting_owner_membership'
  /**
   * `ownerId` matches no User row — including the empty string the tRPC
   * constructor could previously write. There is no identity to grant anything
   * to.
   */
  | 'ownerId_unresolvable_to_User'
  /**
   * Anything the classifier cannot place, notably a Business carrying more than
   * one OWNER Membership where none is `ownerId`. This class exists so an
   * unanticipated shape is surfaced rather than falling through into the
   * deterministic bucket.
   */
  | 'otherwise_ambiguous';

export interface FoundingMembershipRow {
  businessId: string;
  businessName: string;
  ownerId: string;
  classification: FoundingMembershipClass;
  detail: string;
}

export interface FoundingMembershipInventory {
  scanned: number;
  counts: Record<FoundingMembershipClass, number>;
  rows: FoundingMembershipRow[];
}

export interface FoundingMembershipRepairResult {
  inventory: FoundingMembershipInventory;
  repaired: string[];
  /** Businesses left alone because their state is not deterministic. */
  reportedForExplicitRepair: FoundingMembershipRow[];
  /** Deterministic rows whose write failed. Reported, never retried silently. */
  failed: { businessId: string; reason: string }[];
}

const EMPTY_COUNTS = (): Record<FoundingMembershipClass, number> => ({
  exact_owner_membership_match: 0,
  missing_founding_membership_with_resolvable_owner: 0,
  conflicting_owner_membership: 0,
  ownerId_unresolvable_to_User: 0,
  otherwise_ambiguous: 0,
});

/**
 * Inventory, classification and deterministic-only repair of founding OWNER
 * Memberships.
 *
 * KF-EXEC-TENANT-001 stage 1 and 2. Before this, nothing in the repository could
 * answer "which businesses lack a founding Membership" — there was no migration,
 * no script and no query. The constructors are fixed forward from this packet,
 * but rows created before the fix still exist, and enforcement without detection
 * would lock their owners out.
 *
 * The hard rule is that only `missing_founding_membership_with_resolvable_owner`
 * is written. Conflicting, unresolvable and ambiguous rows are reported for a
 * human to decide. Guessing here would mint authority for the wrong identity,
 * which is a worse outcome than leaving the row visibly broken.
 */
@Injectable()
export class FoundingMembershipService {
  private readonly logger = new Logger(FoundingMembershipService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Classify every non-deleted Business. Read-only.
   *
   * Reads across every business by design, so the Membership read is explicitly
   * `skipTenantIsolation`. Membership became default tenant-scoped in TENANT S0;
   * without the opt-out this aggregation would be silently truncated to a single
   * business if it ever ran inside an ambient tenant context, and a truncated
   * inventory reports "nothing missing" rather than failing.
   */
  async classify(): Promise<FoundingMembershipInventory> {
    const businesses = await this.prisma.client.business.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, ownerId: true },
      orderBy: { createdAt: 'asc' },
    });

    if (businesses.length === 0) {
      return { scanned: 0, counts: EMPTY_COUNTS(), rows: [] };
    }

    const businessIds = businesses.map((b) => b.id);
    const ownerIds = [...new Set(businesses.map((b) => b.ownerId).filter((id) => !!id))];

    const memberships = await this.prisma.client.membership.findMany(
      skipTenantIsolation({
        where: { businessId: { in: businessIds } },
        select: { businessId: true, userId: true, role: true },
      }),
    );

    const knownUsers = new Set(
      (
        await this.prisma.client.user.findMany({
          where: { id: { in: ownerIds } },
          select: { id: true },
        })
      ).map((u) => u.id),
    );

    const byBusiness = new Map<string, { userId: string; role: string }[]>();
    for (const m of memberships) {
      const list = byBusiness.get(m.businessId) ?? [];
      list.push({ userId: m.userId, role: m.role });
      byBusiness.set(m.businessId, list);
    }

    const rows: FoundingMembershipRow[] = businesses.map((business) => {
      const members = byBusiness.get(business.id) ?? [];
      const ownerMembership = members.find((m) => m.userId === business.ownerId);
      const ownerRoleHolders = members.filter((m) => m.role === 'OWNER');

      const classify = (): { classification: FoundingMembershipClass; detail: string } => {
        if (!business.ownerId || !knownUsers.has(business.ownerId)) {
          return {
            classification: 'ownerId_unresolvable_to_User',
            detail: business.ownerId
              ? `ownerId ${business.ownerId} matches no User row`
              : 'ownerId is empty',
          };
        }

        if (ownerMembership) {
          return ownerMembership.role === 'OWNER'
            ? {
                classification: 'exact_owner_membership_match',
                detail: 'owner holds an OWNER Membership',
              }
            : {
                classification: 'conflicting_owner_membership',
                detail: `owner holds Membership with role ${ownerMembership.role}, not OWNER`,
              };
        }

        if (ownerRoleHolders.length === 1) {
          return {
            classification: 'conflicting_owner_membership',
            detail: `OWNER Membership is held by ${ownerRoleHolders[0].userId}, not ownerId`,
          };
        }

        if (ownerRoleHolders.length > 1) {
          return {
            classification: 'otherwise_ambiguous',
            detail: `${ownerRoleHolders.length} OWNER Memberships exist and none belongs to ownerId`,
          };
        }

        return {
          classification: 'missing_founding_membership_with_resolvable_owner',
          detail: 'owner resolves to a User and no Membership exists on this business',
        };
      };

      const { classification, detail } = classify();
      return {
        businessId: business.id,
        businessName: business.name,
        ownerId: business.ownerId,
        classification,
        detail,
      };
    });

    const counts = EMPTY_COUNTS();
    for (const row of rows) counts[row.classification] += 1;

    return { scanned: rows.length, counts, rows };
  }

  /**
   * Write the founding OWNER Membership for the deterministic class only.
   *
   * `apply: false` (the default) classifies and reports without writing, so the
   * inventory can be inspected before anything is repaired.
   *
   * The write is an upsert against `@@unique([userId, businessId])`. Between
   * classification and repair another process may have created the same row —
   * a concurrent bootstrap, say — and the upsert converges on it instead of
   * failing the whole run.
   */
  async repairDeterministic(options: { apply?: boolean } = {}): Promise<FoundingMembershipRepairResult> {
    const apply = options.apply ?? false;
    const inventory = await this.classify();

    const repairable = inventory.rows.filter(
      (r) => r.classification === 'missing_founding_membership_with_resolvable_owner',
    );
    const reportedForExplicitRepair = inventory.rows.filter(
      (r) =>
        r.classification === 'conflicting_owner_membership' ||
        r.classification === 'ownerId_unresolvable_to_User' ||
        r.classification === 'otherwise_ambiguous',
    );

    const repaired: string[] = [];
    const failed: { businessId: string; reason: string }[] = [];
    if (apply) {
      for (const row of repairable) {
        // Per row, not per batch. Classification and repair are separate reads,
        // so a business can be deleted, or its owner removed, in the gap — and
        // over a large estate one such row must not abort every repair after it.
        // The row is reported instead, and a re-run picks it up if it is still
        // deterministic.
        try {
          await this.prisma.client.membership.upsert(
            skipTenantIsolation({
              where: { userId_businessId: { userId: row.ownerId, businessId: row.businessId } },
              create: { userId: row.ownerId, businessId: row.businessId, role: 'OWNER' },
              // Deliberately a no-op. If a row appeared since classification it is
              // not this repair's business to overwrite whatever role it carries.
              update: {},
            }),
          );
          repaired.push(row.businessId);
        } catch (err: unknown) {
          const reason = err instanceof Error ? err.message : String(err);
          failed.push({ businessId: row.businessId, reason });
          this.logger.warn(`Founding-membership repair skipped ${row.businessId}: ${reason}`);
        }
      }
      this.logger.log(
        `Founding-membership repair wrote ${repaired.length} OWNER Memberships; ` +
          `${reportedForExplicitRepair.length} rows left for explicit repair; ` +
          `${failed.length} failed`,
      );
    }

    return { inventory, repaired, reportedForExplicitRepair, failed };
  }
}
