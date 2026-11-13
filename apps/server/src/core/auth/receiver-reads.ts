import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { LEVEL_RANK } from '../authority/module-vocabulary';
import { memberModuleLevel, type ModuleLevelActor } from './member-module-level';
import { resolveCrmAccess, visibilityClause } from '../../modules/crm/crm-permissions.helper';

/**
 * SWEEP-P0-SCOPES round 2 class repair (CLASS A; findings WHP-1, WHP-2): what a member must read before
 * records are sent, for them, to an account outside the server.
 *
 * Round 1 held the webhooks to it at the dispatcher's one door (assertMayReceiveEvents at create and
 * re-enable: the subscriber reads every module the events carry). The integration pushes sat outside
 * that door: the accounting push (QuickBooks, Xero) and the marketing push (Mailchimp, Klaviyo) sent a
 * business's invoices and contacts to the realm, tenant or account in the stored credentials, which a
 * settings admin with revenue none and crm none could bind to an account of their own. The rule is the
 * webhooks' rule, kept here for every sender:
 *
 *   - the receiver of an export (the member who binds the account, and the member who sends to it)
 *     reads every module its records belong to, by ModuleScopeGuard's reading (an explicit map binds an
 *     ADMIN too, D-114; a JSON array names no module, SV-4);
 *   - each contact sent is one every receiver may open (crm visibility: a PRIVATE contact only to its
 *     owner, an explicit share, the business owner; a member with their own book only their book).
 */

/** Why `actor` may not receive records of `modules`, in the refusal's words, or null when they may. */
export async function receiverReadRefusal(
  prisma: PrismaService,
  businessId: string,
  actor: ModuleLevelActor,
  modules: readonly string[],
  what: string,
): Promise<string | null> {
  for (const module of modules) {
    const held = await memberModuleLevel(prisma, businessId, actor, module);
    if (LEVEL_RANK[held] < LEVEL_RANK.read) {
      return `Insufficient permissions: ${what} needs ${module} read access (you have ${held})`;
    }
  }
  return null;
}

/** 403 unless `actor` reads every module of `modules` (receiverReadRefusal). */
export async function assertMayExport(
  prisma: PrismaService,
  businessId: string,
  actor: ModuleLevelActor,
  modules: readonly string[],
  what: string,
): Promise<void> {
  if (!actor?.id) throw new ForbiddenException('Authentication required');
  const refusal = await receiverReadRefusal(prisma, businessId, actor, modules, what);
  if (refusal) throw new ForbiddenException(refusal);
}

/** The receivers of one export: members by id, and whether one receiver is not known (an account bound before the binder was recorded). */
export interface ExportAudience {
  memberIds: string[];
  unknownReceiver: boolean;
}

/**
 * The contact ids among `candidateIds` (of the business, not deleted) that every receiver may open: the
 * intersection of their crm visibility clauses (visibilityClause, the rule GET contacts applies). A
 * member who is no longer a member opens none. An unknown receiver is read as a member with every TEAM
 * and SHARED contact in view and no PRIVATE one: a non-owner's view, never the owner's.
 */
export async function contactIdsEveryReceiverMayOpen(
  prisma: PrismaService,
  businessId: string,
  audience: ExportAudience,
  candidateIds: readonly string[],
): Promise<Set<string>> {
  if (candidateIds.length === 0) return new Set();
  const clauses: Array<Record<string, unknown>> = [];
  for (const userId of [...new Set(audience.memberIds)]) {
    let clause: Record<string, unknown> | null;
    try {
      clause = visibilityClause(await resolveCrmAccess(prisma, businessId, userId), userId) as Record<string, unknown> | null;
    } catch {
      return new Set();
    }
    if (clause) clauses.push(clause);
  }
  if (audience.unknownReceiver) clauses.push({ visibility: { in: ['TEAM', 'SHARED'] } });
  const rows: Array<{ id: string }> = await prisma.client.contact.findMany({
    where: { businessId, deletedAt: null, id: { in: [...candidateIds] }, AND: clauses },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}
