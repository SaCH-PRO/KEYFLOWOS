import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  CONTACT_RELATIONSHIP_EDGE_TYPES,
  CONTACT_RELATIONSHIP_INVERSE,
  isContactRelationshipEdgeType,
  type ContactRelationshipEdgeType,
} from '@keyflow/shared';
import { PrismaService } from '../../core/prisma/prisma.service';
import { contactWhereWithId } from './crm.helpers';
import { CrmTimelineService } from './crm-timeline.service';
import { ReputationService } from '../community/reputation.service';
import type { Prisma } from '@prisma/client';
import type { InvoicePaidPayload, InvoiceStatusPayload } from '../../core/event-bus/events.types';

const REFERRER_BUMP_ON_REFER = 5;
const REFERRER_BUMP_ON_DEAL_WON = 15;
/** W10-REOPEN-REVERSALS (D-102): the crm-network's referral note kinds (note.created data.kind) and its source. */
const DEAL_WON = 'referral.deal_won';
const DEAL_REOPENED = 'referral.deal_reopened';
const NETWORK_SOURCE = 'crm-network';

export type RelationshipFilter = {
  type?: ContactRelationshipEdgeType;
  relationshipHealth?: string;
  minDealValue?: number;
  search?: string;
};

@Injectable()
export class CrmNetworkService {
  private readonly logger = new Logger(CrmNetworkService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CrmTimelineService) private readonly timeline: CrmTimelineService,
    @Inject(ReputationService) private readonly reputation: ReputationService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  private validateType(type: string): ContactRelationshipEdgeType {
    if (!isContactRelationshipEdgeType(type)) {
      throw new BadRequestException(
        `Invalid relationship type "${type}". Allowed: ${CONTACT_RELATIONSHIP_EDGE_TYPES.join(', ')}`,
      );
    }
    return type;
  }

  private async assertContact(businessId: string, contactId: string) {
    const c = await this.db.contact.findFirst({ where: contactWhereWithId(businessId, contactId) });
    if (!c) throw new NotFoundException(`Contact ${contactId} not found`);
    return c;
  }

  /**
   * Create a relationship edge from one contact to another. The inverse edge is
   * automatically materialized so the graph is always navigable in both
   * directions (e.g. "A reports to B" implies "B manages A").
   */
  async createRelationship(input: {
    businessId: string;
    fromContactId: string;
    toContactId: string;
    type: string;
    since?: string | null;
    note?: string | null;
  }) {
    if (input.fromContactId === input.toContactId) {
      throw new BadRequestException('Cannot relate a contact to itself');
    }
    const type = this.validateType(input.type);
    await this.assertContact(input.businessId, input.fromContactId);
    await this.assertContact(input.businessId, input.toContactId);

    const since = input.since ? new Date(input.since) : null;
    const note = input.note?.trim() || null;
    const inverseType = CONTACT_RELATIONSHIP_INVERSE[type];

    const [primary, _inverse] = await this.db.$transaction([
      this.db.contactRelationship.upsert({
        where: {
          fromContactId_toContactId_type: {
            fromContactId: input.fromContactId,
            toContactId: input.toContactId,
            type,
          },
        },
        update: { since, note },
        create: {
          businessId: input.businessId,
          fromContactId: input.fromContactId,
          toContactId: input.toContactId,
          type,
          since,
          note,
        },
      }),
      this.db.contactRelationship.upsert({
        where: {
          fromContactId_toContactId_type: {
            fromContactId: input.toContactId,
            toContactId: input.fromContactId,
            type: inverseType,
          },
        },
        update: { since },
        create: {
          businessId: input.businessId,
          fromContactId: input.toContactId,
          toContactId: input.fromContactId,
          type: inverseType,
          since,
        },
      }),
    ]);

    return primary;
  }

  async listForContact(businessId: string, contactId: string) {
    await this.assertContact(businessId, contactId);
    const [outgoing, incoming] = await Promise.all([
      this.db.contactRelationship.findMany({
        where: { businessId, fromContactId: contactId },
        include: { toContact: true },
      }),
      this.db.contactRelationship.findMany({
        where: { businessId, toContactId: contactId },
        include: { fromContact: true },
      }),
    ]);
    return { outgoing, incoming };
  }

  /**
   * Returns a graph slice rooted at `contactId` with first- and second-degree
   * neighbours, suitable for visualization or list rendering.
   */
  async getNeighbourhood(businessId: string, contactId: string, depth: number = 2) {
    await this.assertContact(businessId, contactId);
    const safeDepth = Math.max(1, Math.min(2, depth));
    const visited = new Set<string>([contactId]);
    let frontier: string[] = [contactId];
    const edges: Array<{
      id: string;
      fromContactId: string;
      toContactId: string;
      type: string;
      since: Date | null;
      note: string | null;
    }> = [];
    const seenEdgeKeys = new Set<string>();

    for (let depthIdx = 0; depthIdx < safeDepth && frontier.length > 0; depthIdx++) {
      const found = await this.db.contactRelationship.findMany({
        where: {
          businessId,
          OR: [{ fromContactId: { in: frontier } }, { toContactId: { in: frontier } }],
        },
      });
      const nextFrontier = new Set<string>();
      for (const e of found) {
        const key = `${e.fromContactId}|${e.toContactId}|${e.type}`;
        if (!seenEdgeKeys.has(key)) {
          seenEdgeKeys.add(key);
          edges.push({
            id: e.id,
            fromContactId: e.fromContactId,
            toContactId: e.toContactId,
            type: e.type,
            since: e.since,
            note: e.note,
          });
        }
        if (!visited.has(e.fromContactId)) nextFrontier.add(e.fromContactId);
        if (!visited.has(e.toContactId)) nextFrontier.add(e.toContactId);
      }
      frontier = Array.from(nextFrontier);
      frontier.forEach((id) => visited.add(id));
    }

    const contacts = await this.db.contact.findMany({
      where: { businessId, deletedAt: null, id: { in: Array.from(visited) } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        companyName: true,
        jobTitle: true,
        status: true,
        relationshipType: true,
        relationshipHealth: true,
        priority: true,
      },
    });

    return {
      rootId: contactId,
      nodes: contacts,
      edges,
    };
  }

  async listGraphForBusiness(businessId: string, filter: RelationshipFilter = {}) {
    const where: Record<string, unknown> = { businessId };
    if (filter.type) where.type = filter.type;

    const edges = await this.db.contactRelationship.findMany({ where });
    const ids = new Set<string>();
    edges.forEach((e) => {
      ids.add(e.fromContactId);
      ids.add(e.toContactId);
    });

    const contactWhere: Record<string, unknown> = {
      businessId,
      deletedAt: null,
      id: { in: Array.from(ids) },
    };
    if (filter.relationshipHealth) contactWhere.relationshipHealth = filter.relationshipHealth;
    if (filter.search) {
      const q = filter.search;
      contactWhere.OR = [
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { companyName: { contains: q, mode: 'insensitive' } },
      ];
    }

    const contacts = await this.db.contact.findMany({
      where: contactWhere,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        companyName: true,
        jobTitle: true,
        status: true,
        relationshipType: true,
        relationshipHealth: true,
        priority: true,
      },
    });

    let dealValues: Map<string, number> | null = null;
    if (filter.minDealValue !== undefined && filter.minDealValue > 0) {
      const grouped = await this.db.invoice.groupBy({
        by: ['contactId'],
        where: {
          businessId,
          contactId: { in: Array.from(ids) },
          status: 'PAID',
        },
        _sum: { total: true },
      });
      dealValues = new Map();
      for (const g of grouped) {
        if (!g.contactId) continue;
        const total = Number(g._sum.total ?? 0);
        dealValues.set(g.contactId, total);
      }
    }

    let nodes = contacts;
    if (dealValues) {
      const min = filter.minDealValue ?? 0;
      nodes = contacts.filter((c) => (dealValues!.get(c.id) ?? 0) >= min);
    }
    const nodeIds = new Set(nodes.map((n) => n.id));
    const filteredEdges = edges.filter(
      (e) => nodeIds.has(e.fromContactId) && nodeIds.has(e.toContactId),
    );
    return {
      nodes,
      edges: filteredEdges.map((e) => ({
        id: e.id,
        fromContactId: e.fromContactId,
        toContactId: e.toContactId,
        type: e.type,
        since: e.since,
        note: e.note,
      })),
    };
  }

  async deleteRelationship(businessId: string, relationshipId: string) {
    const edge = await this.db.contactRelationship.findFirst({
      where: { id: relationshipId, businessId },
    });
    if (!edge) throw new NotFoundException('Relationship not found');
    const inverseType = isContactRelationshipEdgeType(edge.type)
      ? CONTACT_RELATIONSHIP_INVERSE[edge.type]
      : null;
    await this.db.$transaction([
      this.db.contactRelationship.delete({ where: { id: edge.id } }),
      ...(inverseType
        ? [
            this.db.contactRelationship.deleteMany({
              where: {
                businessId,
                fromContactId: edge.toContactId,
                toContactId: edge.fromContactId,
                type: inverseType,
              },
            }),
          ]
        : []),
    ]);
    return { ok: true };
  }

  /**
   * Quick "Refer / link contact" affordance. Either references an existing
   * contact or creates a new one, then links it back to the referrer with a
   * `referred` edge. The referrer's lead score is bumped to reflect the
   * inbound referral signal.
   */
  async referContact(input: {
    businessId: string;
    referrerContactId: string;
    target: { contactId?: string; firstName?: string; lastName?: string; email?: string; phone?: string };
    note?: string | null;
  }) {
    const referrer = await this.assertContact(input.businessId, input.referrerContactId);
    let targetId = input.target.contactId;
    if (!targetId) {
      const created = await this.db.contact.create({
        data: {
          businessId: input.businessId,
          firstName: input.target.firstName?.trim() || null,
          lastName: input.target.lastName?.trim() || null,
          email: input.target.email?.trim() || null,
          phone: input.target.phone?.trim() || null,
          status: 'LEAD',
          source: 'referral',
          sourceDetail: `Referred by ${referrer.firstName ?? ''} ${referrer.lastName ?? ''}`.trim(),
        },
      });
      targetId = created.id;
      await this.timeline.logEvent(input.businessId, created.id, 'contact.created', {
        firstName: created.firstName,
        lastName: created.lastName,
        source: 'referral',
        referrerContactId: input.referrerContactId,
      });
    } else {
      await this.assertContact(input.businessId, targetId);
    }

    const edge = await this.createRelationship({
      businessId: input.businessId,
      fromContactId: input.referrerContactId,
      toContactId: targetId,
      type: 'referred',
      note: input.note ?? null,
    });

    // Reputation/score signal: bump the referrer's lead score so referral
    // sources surface higher in the book of business.
    await this.bumpLeadScore(input.businessId, input.referrerContactId, REFERRER_BUMP_ON_REFER);
    await this.timeline.logEvent(
      input.businessId,
      input.referrerContactId,
      'note.created',
      {
        kind: 'referral.sent',
        targetContactId: targetId,
        note: input.note ?? null,
      },
      { source: 'crm-network' },
    );
    return { relationship: edge, targetContactId: targetId };
  }

  /**
   * W10-REOPEN-REVERSALS review repair (owner ruling D-102; the SEC-W10RR-1
   * class): the score is read and written under the contact's row lock, the
   * lock the deal-won bump and its reversal take, so none overwrites another.
   */
  private async bumpLeadScore(businessId: string, contactId: string, by: number) {
    try {
      await this.db.$transaction(async (rawTx) => {
        const tx = rawTx as unknown as Prisma.TransactionClient;
        const locked = await tx.$queryRaw<Array<{ id: string; lead_score: number | null }>>`
          SELECT id, lead_score FROM contacts WHERE id = ${contactId} AND business_id = ${businessId} AND deleted_at IS NULL FOR UPDATE`;
        if (locked.length === 0) return;
        const next = Math.max(0, Math.min(100, (locked[0].lead_score ?? 0) + by));
        await tx.contact.update({ where: { id: contactId }, data: { leadScore: next } });
      });
    } catch (err: any) {
      this.logger.warn(`bumpLeadScore failed for ${contactId}: ${(err as Error).message}`);
    }
  }

  /**
   * When a paid invoice is attributed to a contact who was referred by another
   * contact (edge: referred_by), bump the referrer's lead score to reflect a
   * deal won via their network.
   *
   * W10-REOPEN-REVERSALS review repairs (owner ruling D-102):
   * - CR-REOPEN-2: each bump and the referral.deal_won note that records it are
   *   written in one transaction under the referrer's row lock, and the note
   *   carries the points actually applied (`bump`: less than 15 when the score
   *   was capped at 100); that is what the reopen takes back.
   * - CR-REOPEN-1 (the SEC-A9-1 pattern of RevenueActionService): the invoice
   *   is read PAID before the bump and again after it. A stale delivery bumps
   *   nothing; a bump written after the refund's reopen handler ran (and found
   *   no note to take back) is taken back here, under the same lock, so it is
   *   taken back once.
   * - A referrer whose bump for this invoice is still outstanding (a deal_won
   *   note no deal_reopened note closed) is not bumped again, so a re-delivered
   *   invoice.paid bumps once.
   */
  @OnEvent('invoice.paid')
  async onInvoicePaid(payload: InvoicePaidPayload) {
    try {
      const businessId = payload?.businessId;
      const contactId = payload?.invoice?.contactId;
      const invoiceId = payload?.invoice?.id;
      if (!businessId || !contactId || !invoiceId) return;
      if ((await this.invoiceStatus(businessId, invoiceId)) !== 'PAID') return;
      const { edges, bumped } = await this.bumpReferrersOf(businessId, contactId, invoiceId, payload?.invoice?.total);
      if (bumped > 0 && (await this.invoiceStatus(businessId, invoiceId)) !== 'PAID') {
        await this.takeBackDealWonBumps(businessId, invoiceId, null, payload?.invoice?.total);
      }
      // Refresh the business-level community reputation score so the
      // referrals-converted signal is reflected when contact referrals
      // generate paid revenue.
      if (edges > 0) {
        try {
          await this.reputation.recalculate(businessId);
        } catch (err: any) {
          this.logger.warn(`reputation.recalculate failed: ${(err as Error).message}`);
        }
      }
    } catch (err: any) {
      this.logger.warn(`onInvoicePaid handler failed: ${(err as Error).message}`);
    }
  }

  /**
   * W10-REOPEN-REVERSALS (owner ruling D-102): a refund's reopen of a paid
   * invoice takes back the referrer lead-score bump its invoice.paid gave. The
   * referrers are read from the referral.deal_won notes the paid handler wrote
   * for this invoice (not from today's edges); a referrer whose bump is still
   * outstanding gets it taken back, once, and one referral.deal_reopened note
   * (a timeline note, nobody is messaged). An invoice whose payment bumped
   * nobody takes nothing back. The check and the writes run under the
   * referrer's row lock, so a re-delivered or concurrent reopen takes the bump
   * back once; a re-pay's bump (a new deal_won note) is taken back by its own
   * reopen. If the invoice is PAID again by the time this ran, its referrers
   * are bumped again (as on invoice.paid).
   *
   * Review repair SEC-W10RR-3: only the crm-network's own notes are read
   * (source crm-network, no USER actor). A note of the same kind a crm:write
   * member logs through POST .../contacts/:contactId/events (source crm, actor
   * USER) neither shields a bump from this reversal nor makes a bystander lose
   * one.
   */
  @OnEvent('invoice.reopened', { async: true })
  async onInvoiceReopened(payload: InvoiceStatusPayload & { previousStatus?: string }) {
    const businessId = payload?.businessId;
    const invoiceId = payload?.invoice?.id;
    if (!businessId || !invoiceId) return;
    try {
      const status = await this.invoiceStatus(businessId, invoiceId);
      if (status == null || status === 'PAID') return;
      const reversed = await this.takeBackDealWonBumps(businessId, invoiceId, payload?.previousStatus ?? null, payload?.invoice?.total);
      let reapplied = 0;
      if (reversed > 0) {
        const now = await this.db.invoice.findFirst({
          where: { id: invoiceId, businessId },
          select: { status: true, contactId: true, total: true },
        });
        if (now?.status === 'PAID' && now.contactId) {
          reapplied = (await this.bumpReferrersOf(businessId, now.contactId, invoiceId, now.total)).bumped;
        }
      }
      if (reversed > 0 || reapplied > 0) {
        try {
          await this.reputation.recalculate(businessId);
        } catch (err) {
          this.logger.warn(`reputation.recalculate failed: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      this.logger.warn(`onInvoiceReopened handler failed: ${(err as Error).message}`);
    }
  }

  /** The invoice's status in this business, or null when it is not this business's invoice. */
  private async invoiceStatus(businessId: string, invoiceId: string): Promise<string | null> {
    const inv = await this.db.invoice.findFirst({
      where: { id: invoiceId, businessId },
      select: { status: true },
    });
    return inv?.status ?? null;
  }

  /** W10-REOPEN-REVERSALS (D-102): bumps each referrer the paying contact's referred_by edges name, once for this invoice. */
  private async bumpReferrersOf(
    businessId: string,
    contactId: string,
    invoiceId: string,
    total: unknown,
  ): Promise<{ edges: number; bumped: number }> {
    const referrerEdges = await this.db.contactRelationship.findMany({
      where: { businessId, fromContactId: contactId, type: 'referred_by' },
      select: { toContactId: true },
    });
    let bumped = 0;
    for (const edge of referrerEdges) {
      try {
        if (await this.bumpOnDealWon(businessId, edge.toContactId, contactId, invoiceId, total)) bumped += 1;
      } catch (err) {
        this.logger.warn(`deal-won bump failed for ${edge.toContactId}: ${(err as Error).message}`);
      }
    }
    return { edges: referrerEdges.length, bumped };
  }

  /**
   * W10-REOPEN-REVERSALS review repairs CR-REOPEN-1 / CR-REOPEN-2 (D-102): one
   * referrer's deal-won bump for an invoice, under the referrer's row lock:
   * skipped while a bump of this invoice is outstanding; the score moves by up
   * to 15 (capped at 100) and the referral.deal_won note records the points
   * applied. Returns whether it bumped.
   */
  private async bumpOnDealWon(
    businessId: string,
    referrerId: string,
    referredContactId: string,
    invoiceId: string,
    total: unknown,
  ): Promise<boolean> {
    return this.db.$transaction(async (rawTx) => {
      const tx = rawTx as unknown as Prisma.TransactionClient;
      const locked = await tx.$queryRaw<Array<{ id: string; lead_score: number | null }>>`
        SELECT id, lead_score FROM contacts WHERE id = ${referrerId} AND business_id = ${businessId} AND deleted_at IS NULL FOR UPDATE`;
      if (locked.length === 0) return false;
      if (await this.outstandingDealWon(tx, businessId, referrerId, invoiceId)) return false;
      const score = locked[0].lead_score ?? 0;
      const next = Math.max(0, Math.min(100, score + REFERRER_BUMP_ON_DEAL_WON));
      await tx.contact.update({ where: { id: referrerId }, data: { leadScore: next } });
      await this.timeline.logEvent(
        businessId,
        referrerId,
        'note.created',
        { kind: DEAL_WON, referredContactId, invoiceId, total, bump: next - score },
        { source: NETWORK_SOURCE },
        tx,
      );
      return true;
    });
  }

  /**
   * W10-REOPEN-REVERSALS (owner ruling D-102): takes back, under each
   * referrer's row lock, the outstanding deal-won bump of this invoice: the
   * points its note recorded (review repair CR-REOPEN-2; a note written before
   * they were recorded counts the fixed 15), never below 0, with one
   * referral.deal_reopened note naming the deal_won note it closes. Returns how
   * many referrers it took a bump back from.
   */
  private async takeBackDealWonBumps(
    businessId: string,
    invoiceId: string,
    previousStatus: string | null,
    total: unknown,
  ): Promise<number> {
    const won = await this.db.contactEvent.findMany({
      where: networkNotesOf(businessId, invoiceId, [DEAL_WON]),
      select: { contactId: true },
    });
    const referrers = Array.from(new Set(won.map((e) => e.contactId)));
    let reversed = 0;
    for (const referrerId of referrers) {
      const took = await this.db.$transaction(async (rawTx) => {
        const tx = rawTx as unknown as Prisma.TransactionClient;
        const locked = await tx.$queryRaw<Array<{ id: string; lead_score: number | null }>>`
          SELECT id, lead_score FROM contacts WHERE id = ${referrerId} AND business_id = ${businessId} FOR UPDATE`;
        if (locked.length === 0) return false;
        const open = await this.outstandingDealWon(tx, businessId, referrerId, invoiceId);
        if (!open) return false;
        const score = locked[0].lead_score ?? 0;
        const next = Math.max(0, Math.min(100, score - open.bump));
        await tx.contact.update({ where: { id: referrerId }, data: { leadScore: next } });
        await this.timeline.logEvent(
          businessId,
          referrerId,
          'note.created',
          {
            kind: DEAL_REOPENED,
            referredContactId: open.referredContactId,
            invoiceId,
            wonEventId: open.id,
            bump: score - next,
            total,
            previousStatus,
          },
          { source: NETWORK_SOURCE },
          tx,
        );
        return true;
      });
      if (took) reversed += 1;
    }
    return reversed;
  }

  /**
   * W10-REOPEN-REVERSALS (D-102): the referrer's outstanding deal-won note for
   * the invoice (read in the caller's transaction, under the referrer's lock):
   * the oldest crm-network referral.deal_won note that no referral.deal_reopened
   * note names (wonEventId) as closed, with the points it applied.
   */
  private async outstandingDealWon(
    tx: Prisma.TransactionClient,
    businessId: string,
    referrerId: string,
    invoiceId: string,
  ): Promise<{ id: string; bump: number; referredContactId: unknown } | null> {
    const notes = await tx.contactEvent.findMany({
      where: { ...networkNotesOf(businessId, invoiceId, [DEAL_WON, DEAL_REOPENED]), contactId: referrerId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, data: true },
    });
    const dataOf = (n: { data: Prisma.JsonValue }) =>
      (n.data && typeof n.data === 'object' && !Array.isArray(n.data) ? n.data : {}) as Record<string, unknown>;
    const closed = new Set(notes.filter((n) => dataOf(n).kind === DEAL_REOPENED).map((n) => dataOf(n).wonEventId));
    const open = notes.find((n) => dataOf(n).kind === DEAL_WON && !closed.has(n.id));
    if (!open) return null;
    const d = dataOf(open);
    const bump = typeof d.bump === 'number' && Number.isFinite(d.bump) ? d.bump : REFERRER_BUMP_ON_DEAL_WON;
    return { id: open.id, bump, referredContactId: d.referredContactId ?? null };
  }
}

/**
 * W10-REOPEN-REVERSALS review repair SEC-W10RR-3 (D-102): the crm-network's own
 * referral notes of these kinds for an invoice, the lead-score ledger. Source
 * crm-network and no USER actor: the contact events route writes source crm
 * and actor USER, so a member's note of the same kind is never one of them.
 */
function networkNotesOf(businessId: string, invoiceId: string, kinds: string[]): Prisma.ContactEventWhereInput {
  return {
    businessId,
    type: 'note.created',
    source: NETWORK_SOURCE,
    AND: [
      { OR: [{ actorType: null }, { actorType: { not: 'USER' } }] },
      { OR: kinds.map((kind) => ({ data: { path: ['kind'], equals: kind } })) },
      { data: { path: ['invoiceId'], equals: invoiceId } },
    ],
  };
}
