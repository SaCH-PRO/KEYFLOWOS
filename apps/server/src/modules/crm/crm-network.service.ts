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
import type { InvoicePaidPayload } from '../../core/event-bus/events.types';

const REFERRER_BUMP_ON_REFER = 5;
const REFERRER_BUMP_ON_DEAL_WON = 15;

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

  private async bumpLeadScore(businessId: string, contactId: string, by: number) {
    try {
      const c = await this.db.contact.findFirst({
        where: contactWhereWithId(businessId, contactId),
        select: { id: true, leadScore: true },
      });
      if (!c) return;
      const next = Math.max(0, Math.min(100, (c.leadScore ?? 0) + by));
      await this.db.contact.update({ where: { id: c.id }, data: { leadScore: next } });
    } catch (err) {
      this.logger.warn(`bumpLeadScore failed for ${contactId}: ${(err as Error).message}`);
    }
  }

  /**
   * When a paid invoice is attributed to a contact who was referred by another
   * contact (edge: referred_by), bump the referrer's lead score to reflect a
   * deal won via their network.
   */
  @OnEvent('invoice.paid')
  async onInvoicePaid(payload: InvoicePaidPayload) {
    try {
      const businessId = payload?.businessId;
      const contactId = payload?.invoice?.contactId;
      if (!businessId || !contactId) return;
      const referrerEdges = await this.db.contactRelationship.findMany({
        where: { businessId, fromContactId: contactId, type: 'referred_by' },
        select: { toContactId: true },
      });
      for (const edge of referrerEdges) {
        await this.bumpLeadScore(businessId, edge.toContactId, REFERRER_BUMP_ON_DEAL_WON);
        await this.timeline.logEvent(
          businessId,
          edge.toContactId,
          'note.created',
          {
            kind: 'referral.deal_won',
            referredContactId: contactId,
            invoiceId: payload?.invoice?.id,
            total: payload?.invoice?.total,
          },
          { source: 'crm-network' },
        );
      }
      // Refresh the business-level community reputation score so the
      // referrals-converted signal is reflected when contact referrals
      // generate paid revenue.
      if (referrerEdges.length > 0) {
        try {
          await this.reputation.recalculate(businessId);
        } catch (err) {
          this.logger.warn(`reputation.recalculate failed: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      this.logger.warn(`onInvoicePaid handler failed: ${(err as Error).message}`);
    }
  }
}
