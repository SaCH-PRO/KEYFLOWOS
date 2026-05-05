import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ensureGraph, type SequenceGraph, type SequenceNode } from './crm-sequence-graph.util';

const DEFAULT_ATTRIBUTION_WINDOW_DAYS = 14;

export type AnalyticsRange = { from?: Date; to?: Date };

type StepFunnel = {
  nodeId: string;
  nodeType: string;
  label: string;
  reached: number;
  advanced: number;
  failed: number;
  dropOff: number;
  dropOffRate: number;
  openRate: number | null;
  clickRate: number | null;
  replyRate: number | null;
  replyCount: number;
};

export type SequenceKpi = {
  sequenceId: string;
  name: string;
  status: string;
  enrolled: number;
  active: number;
  completed: number;
  failed: number;
  replyRate: number;
  attributedDeals: number;
  attributedValue: number;
  currency: string | null;
};

type EnrollmentRow = {
  id: string;
  contactId: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
};

type StepEventRow = {
  contactId: string;
  data: Prisma.JsonValue;
  createdAt: Date;
};

type CommunicationEventRow = {
  contactId: string;
  type: string;
  createdAt: Date;
  data: Prisma.JsonValue;
};

type StepDueData = { sequenceId?: string; nodeId?: string; enrollmentId?: string };

@Injectable()
export class CrmSequenceAnalyticsService {
  private readonly logger = new Logger(CrmSequenceAnalyticsService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  // ---------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------
  async getAttributionWindowDays(businessId: string): Promise<number> {
    const business = await this.db.business.findUnique({
      where: { id: businessId },
      select: { crmAttributionWindowDays: true },
    });
    if (!business) return DEFAULT_ATTRIBUTION_WINDOW_DAYS;
    const value = business.crmAttributionWindowDays;
    if (typeof value === 'number' && value > 0 && value <= 365) return value;
    return DEFAULT_ATTRIBUTION_WINDOW_DAYS;
  }

  async setAttributionWindowDays(businessId: string, days: number | null): Promise<number> {
    let next: number | null = null;
    if (days !== null && days !== undefined) {
      const n = Math.floor(Number(days));
      if (!Number.isFinite(n) || n < 1 || n > 365) {
        throw new BadRequestException('attribution window must be between 1 and 365 days');
      }
      next = n;
    }
    await this.db.business.update({
      where: { id: businessId },
      data: { crmAttributionWindowDays: next },
    });
    return next ?? DEFAULT_ATTRIBUTION_WINDOW_DAYS;
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------
  private dateRangeFilter(range: AnalyticsRange): Prisma.DateTimeFilter | undefined {
    const filter: Prisma.DateTimeFilter = {};
    if (range.from) filter.gte = range.from;
    if (range.to) filter.lte = range.to;
    return Object.keys(filter).length > 0 ? filter : undefined;
  }

  private nodeLabel(node: SequenceNode | undefined, idx: number): string {
    if (!node) return `Step ${idx + 1}`;
    const data = (node.data ?? {}) as { subject?: string; name?: string };
    if (data.subject) return data.subject;
    if (data.name) return data.name;
    return `${node.type[0].toUpperCase() + node.type.slice(1)} ${idx + 1}`;
  }

  private parseStepData(raw: Prisma.JsonValue): StepDueData {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return raw as StepDueData;
  }

  // ---------------------------------------------------------------------
  // Per-sequence analytics
  // ---------------------------------------------------------------------
  async getSequenceAnalytics(
    businessId: string,
    sequenceId: string,
    range: AnalyticsRange,
  ) {
    const sequence = await this.db.crmSequence.findFirst({
      where: { id: sequenceId, businessId },
    });
    if (!sequence) throw new NotFoundException('Sequence not found');

    const graph: SequenceGraph = ensureGraph({ graph: sequence.graph, steps: sequence.steps });
    const actionableNodes = graph.nodes.filter(
      (n) => n.type === 'email' || n.type === 'whatsapp' || n.type === 'sms',
    );

    const dateFilter = this.dateRangeFilter(range);

    const enrollments: EnrollmentRow[] = await this.db.crmSequenceEnrollment.findMany({
      where: {
        sequenceId,
        ...(dateFilter ? { startedAt: dateFilter } : {}),
      },
      select: { id: true, contactId: true, status: true, startedAt: true, completedAt: true },
    });

    const attributionWindowDays = await this.getAttributionWindowDays(businessId);

    const enrolledCount = enrollments.length;
    const completedCount = enrollments.filter((e) => e.status === 'completed').length;
    const activeCount = enrollments.filter((e) => e.status === 'active').length;
    const failedCount = enrollments.filter((e) => e.status === 'failed').length;
    const enrolledContactIds = Array.from(new Set(enrollments.map((e) => e.contactId)));

    // Filter step events at the DB level by both contact set, time range AND sequenceId
    // (via Prisma JSON path filter) so cross-sequence enrollments don't leak in.
    const sequenceJsonFilter: Prisma.JsonFilter = { path: ['sequenceId'], equals: sequenceId };

    const baseEventWhere = (type: string | string[]): Prisma.ContactEventWhereInput => ({
      businessId,
      contactId: { in: enrolledContactIds },
      ...(typeof type === 'string' ? { type } : { type: { in: type } }),
      ...(dateFilter ? { createdAt: dateFilter } : {}),
    });

    const [stepDueEvents, stepFailedEvents, replyEvents, openEvents, clickEvents]: [
      StepEventRow[],
      StepEventRow[],
      CommunicationEventRow[],
      StepEventRow[],
      StepEventRow[],
    ] = enrolledContactIds.length
      ? await Promise.all([
          this.db.contactEvent.findMany({
            where: { ...baseEventWhere('sequence.step.due'), data: sequenceJsonFilter },
            select: { contactId: true, data: true, createdAt: true },
          }),
          this.db.contactEvent.findMany({
            where: { ...baseEventWhere('sequence.step.failed'), data: sequenceJsonFilter },
            select: { contactId: true, data: true, createdAt: true },
          }),
          this.db.contactEvent.findMany({
            where: baseEventWhere([
              'communication.email',
              'communication.whatsapp',
              'communication.sms',
              'communication.call',
            ]),
            select: { contactId: true, type: true, createdAt: true, data: true },
          }),
          this.db.contactEvent.findMany({
            where: baseEventWhere('campaign.opened'),
            select: { contactId: true, data: true, createdAt: true },
          }),
          this.db.contactEvent.findMany({
            where: baseEventWhere('campaign.clicked'),
            select: { contactId: true, data: true, createdAt: true },
          }),
        ])
      : [[], [], [], [], []];

    // Build per-node reached map: nodeId -> Set(contactId)
    const reachedByNode = new Map<string, Set<string>>();
    const dueByContactNode = new Map<string, Date[]>(); // key contactId|nodeId
    for (const ev of stepDueEvents) {
      const data = this.parseStepData(ev.data);
      const nodeId = data.nodeId;
      if (!nodeId) continue;
      let set = reachedByNode.get(nodeId);
      if (!set) {
        set = new Set();
        reachedByNode.set(nodeId, set);
      }
      set.add(ev.contactId);
      const k = `${ev.contactId}|${nodeId}`;
      const arr = dueByContactNode.get(k) ?? [];
      arr.push(ev.createdAt);
      dueByContactNode.set(k, arr);
    }

    const failedByNode = new Map<string, number>();
    for (const ev of stepFailedEvents) {
      const data = this.parseStepData(ev.data);
      const nodeId = data.nodeId;
      if (!nodeId) continue;
      failedByNode.set(nodeId, (failedByNode.get(nodeId) ?? 0) + 1);
    }

    type StepCounts = { sent: number; opened: number; clicked: number; replied: number };
    const stepCounts: StepCounts[] = [];

    const stepFunnel: StepFunnel[] = actionableNodes.map((node, idx) => {
      const reachedSet = reachedByNode.get(node.id) ?? new Set<string>();
      const reached = reachedSet.size;
      const nextNode = actionableNodes[idx + 1];
      const advanced = nextNode
        ? Array.from(reachedByNode.get(nextNode.id) ?? new Set<string>()).filter((c) => reachedSet.has(c)).length
        : reached;
      const failed = failedByNode.get(node.id) ?? 0;
      const dropOff = Math.max(0, reached - advanced - failed);
      const dropOffRate = reached > 0 ? dropOff / reached : 0;

      // Engagement rates: contacts who opened / clicked / replied after their first
      // step-due for this node, bounded by the next step-due (if any) or now.
      // campaign.opened/clicked are preferentially matched to nodeId via data.nodeId.
      let replied = 0;
      let opened = 0;
      let clicked = 0;
      for (const cid of reachedSet) {
        const dues = dueByContactNode.get(`${cid}|${node.id}`);
        if (!dues || dues.length === 0) continue;
        const start = dues[0];
        const end = nextNode
          ? (dueByContactNode.get(`${cid}|${nextNode.id}`) ?? [])[0] ?? new Date()
          : new Date();
        const inWindow = (t: Date) => t > start && t <= end;
        const matchesNode = (raw: Prisma.JsonValue) => {
          const data = this.parseStepData(raw);
          return !data.nodeId || data.nodeId === node.id;
        };
        if (replyEvents.some((re) => re.contactId === cid && inWindow(re.createdAt))) replied += 1;
        if (openEvents.some((oe) => oe.contactId === cid && inWindow(oe.createdAt) && matchesNode(oe.data))) opened += 1;
        if (clickEvents.some((ce) => ce.contactId === cid && inWindow(ce.createdAt) && matchesNode(ce.data))) clicked += 1;
      }

      stepCounts.push({ sent: reached, opened, clicked, replied });

      return {
        nodeId: node.id,
        nodeType: node.type,
        label: this.nodeLabel(node, idx),
        reached,
        advanced,
        failed,
        dropOff,
        dropOffRate,
        openRate: reached > 0 ? opened / reached : null,
        clickRate: reached > 0 ? clicked / reached : null,
        replyRate: reached > 0 ? replied / reached : null,
        replyCount: replied,
      };
    });

    // Attributed deals via SequenceAttribution (won within range)
    const attributions = await this.db.sequenceAttribution.findMany({
      where: {
        sequenceId,
        businessId,
        ...(dateFilter ? { wonAt: dateFilter } : {}),
      },
      include: { enrollment: { select: { contactId: true } } },
    });
    const attributedValue = attributions.reduce(
      (sum, a) => sum + Number(a.attributedValue ?? 0),
      0,
    );
    const goalHitContactIds = new Set<string>(attributions.map((a) => a.enrollment.contactId));

    // Funnel for chart: enrolled -> per-step (sent -> opened -> replied) -> goal hit.
    // This shows engagement-stage progression rather than just step transitions.
    const funnel: { label: string; count: number; stage?: string }[] = [
      { label: 'Enrolled', count: enrolledCount },
    ];
    stepFunnel.forEach((s, i) => {
      const c = stepCounts[i];
      funnel.push({ label: `${s.label} · sent`, count: c.sent, stage: 'sent' });
      funnel.push({ label: `${s.label} · opened`, count: c.opened, stage: 'opened' });
      funnel.push({ label: `${s.label} · replied`, count: c.replied, stage: 'replied' });
    });
    funnel.push({ label: 'Goal hit', count: goalHitContactIds.size, stage: 'goal' });

    return {
      sequenceId,
      name: sequence.name,
      status: sequence.status,
      attributionWindowDays,
      range: { from: range.from?.toISOString() ?? null, to: range.to?.toISOString() ?? null },
      enrollment: {
        total: enrolledCount,
        active: activeCount,
        completed: completedCount,
        failed: failedCount,
      },
      funnel,
      steps: stepFunnel,
      attribution: {
        deals: attributions.length,
        contacts: goalHitContactIds.size,
        value: attributedValue,
        currency: attributions[0]?.currency ?? null,
        items: attributions.slice(0, 50).map((a) => ({
          dealId: a.dealId,
          contactId: a.contactId,
          value: a.attributedValue ? Number(a.attributedValue) : 0,
          currency: a.currency,
          wonAt: a.wonAt.toISOString(),
          enrolledAt: a.enrolledAt.toISOString(),
          windowDays: a.windowDays,
        })),
      },
    };
  }

  // ---------------------------------------------------------------------
  // Sequences index KPIs
  // ---------------------------------------------------------------------
  async getSequencesSummary(businessId: string, range: AnalyticsRange): Promise<SequenceKpi[]> {
    const sequences = await this.db.crmSequence.findMany({
      where: { businessId, status: { not: 'archived' } },
      select: { id: true, name: true, status: true },
      orderBy: { createdAt: 'desc' },
    });
    if (sequences.length === 0) return [];

    const dateFilter = this.dateRangeFilter(range);
    const sequenceIds = sequences.map((s) => s.id);

    const [enrollments, attributions] = await Promise.all([
      this.db.crmSequenceEnrollment.findMany({
        where: {
          sequenceId: { in: sequenceIds },
          ...(dateFilter ? { startedAt: dateFilter } : {}),
        },
        select: { id: true, sequenceId: true, contactId: true, status: true, startedAt: true },
      }),
      this.db.sequenceAttribution.findMany({
        where: {
          businessId,
          sequenceId: { in: sequenceIds },
          ...(dateFilter ? { wonAt: dateFilter } : {}),
        },
        select: { sequenceId: true, attributedValue: true, currency: true },
      }),
    ]);

    // Reply tally restricted to the same date range as enrollments.
    const enrolledContactIds = Array.from(new Set(enrollments.map((e) => e.contactId)));
    const replyEvents = enrolledContactIds.length
      ? await this.db.contactEvent.findMany({
          where: {
            businessId,
            contactId: { in: enrolledContactIds },
            type: {
              in: [
                'communication.email',
                'communication.whatsapp',
                'communication.sms',
                'communication.call',
              ],
            },
            ...(dateFilter ? { createdAt: dateFilter } : {}),
          },
          select: { contactId: true, createdAt: true },
        })
      : [];

    const replyByContact = new Map<string, Date[]>();
    for (const r of replyEvents) {
      const arr = replyByContact.get(r.contactId) ?? [];
      arr.push(r.createdAt);
      replyByContact.set(r.contactId, arr);
    }

    return sequences.map((seq) => {
      const ours = enrollments.filter((e) => e.sequenceId === seq.id);
      const enrolled = ours.length;
      const active = ours.filter((e) => e.status === 'active').length;
      const completed = ours.filter((e) => e.status === 'completed').length;
      const failed = ours.filter((e) => e.status === 'failed').length;
      let replied = 0;
      for (const e of ours) {
        const dates = replyByContact.get(e.contactId) ?? [];
        if (dates.some((d) => d > e.startedAt)) replied += 1;
      }
      const ourAttrs = attributions.filter((a) => a.sequenceId === seq.id);
      const value = ourAttrs.reduce((s, a) => s + Number(a.attributedValue ?? 0), 0);
      return {
        sequenceId: seq.id,
        name: seq.name,
        status: seq.status,
        enrolled,
        active,
        completed,
        failed,
        replyRate: enrolled > 0 ? replied / enrolled : 0,
        attributedDeals: ourAttrs.length,
        attributedValue: value,
        currency: ourAttrs[0]?.currency ?? null,
      };
    });
  }

  // ---------------------------------------------------------------------
  // Cross-sequence Lifecycle Report
  // ---------------------------------------------------------------------
  async getLifecycleReport(businessId: string, range: AnalyticsRange) {
    const dateFilter = this.dateRangeFilter(range);

    const attributions = await this.db.sequenceAttribution.findMany({
      where: {
        businessId,
        ...(dateFilter ? { wonAt: dateFilter } : {}),
      },
      select: {
        sequenceId: true,
        contactId: true,
        attributedValue: true,
        currency: true,
      },
    });

    const sequences = await this.db.crmSequence.findMany({
      where: { businessId },
      select: { id: true, name: true },
    });
    const seqName = new Map<string, string>(sequences.map((s) => [s.id, s.name]));

    const contactIds = Array.from(new Set(attributions.map((a) => a.contactId)));
    const contacts = contactIds.length
      ? await this.db.contact.findMany({
          where: { id: { in: contactIds } },
          select: {
            id: true,
            relationshipType: true,
            sourceDetail: true,
            segment: true,
            bestChannel: true,
          },
        })
      : [];
    type ContactRow = (typeof contacts)[number];
    const contactMap = new Map<string, ContactRow>(contacts.map((c) => [c.id, c]));

    type Bucket = { sequenceId: string; sequenceName: string; deals: number; value: number };
    const byRelationship = new Map<string, Bucket[]>();
    const bySource = new Map<string, Bucket[]>();
    const byBestChannel = new Map<string, Bucket[]>();

    const upsert = (
      map: Map<string, Bucket[]>,
      key: string,
      sequenceId: string,
      value: number,
    ) => {
      const list = map.get(key) ?? [];
      let b = list.find((x) => x.sequenceId === sequenceId);
      if (!b) {
        b = {
          sequenceId,
          sequenceName: seqName.get(sequenceId) ?? sequenceId,
          deals: 0,
          value: 0,
        };
        list.push(b);
      }
      b.deals += 1;
      b.value += value;
      map.set(key, list);
    };

    for (const a of attributions) {
      const contact = contactMap.get(a.contactId);
      const value = Number(a.attributedValue ?? 0);
      const relType = contact?.relationshipType ?? 'unspecified';
      const source = contact?.sourceDetail ?? contact?.segment ?? 'unspecified';
      const channel = contact?.bestChannel ?? 'unspecified';
      upsert(byRelationship, relType, a.sequenceId, value);
      upsert(bySource, source, a.sequenceId, value);
      upsert(byBestChannel, channel, a.sequenceId, value);
    }

    const flatten = (m: Map<string, Bucket[]>) =>
      Array.from(m.entries()).map(([key, items]) => {
        const sorted = [...items].sort((a, b) => b.deals - a.deals || b.value - a.value);
        return {
          key,
          totalDeals: items.reduce((s, x) => s + x.deals, 0),
          totalValue: items.reduce((s, x) => s + x.value, 0),
          best: sorted[0] ?? null,
          breakdown: sorted,
        };
      });

    return {
      range: { from: range.from?.toISOString() ?? null, to: range.to?.toISOString() ?? null },
      totals: {
        deals: attributions.length,
        value: attributions.reduce((s, a) => s + Number(a.attributedValue ?? 0), 0),
        currency: attributions[0]?.currency ?? null,
      },
      byRelationshipType: flatten(byRelationship),
      bySource: flatten(bySource),
      byBestChannel: flatten(byBestChannel),
    };
  }

  // ---------------------------------------------------------------------
  // Attribution writer (used by listener / direct calls)
  // ---------------------------------------------------------------------
  async recordDealWonAttribution(input: {
    businessId: string;
    dealId: string;
    contactId: string;
    wonAt: Date;
  }): Promise<number> {
    const windowDays = await this.getAttributionWindowDays(input.businessId);
    const windowStart = new Date(input.wonAt.getTime() - windowDays * 86400_000);

    const enrollments = await this.db.crmSequenceEnrollment.findMany({
      where: {
        contactId: input.contactId,
        startedAt: { gte: windowStart, lte: input.wonAt },
        sequence: { businessId: input.businessId },
      },
      select: {
        id: true,
        sequenceId: true,
        startedAt: true,
      },
    });
    if (enrollments.length === 0) return 0;

    // True last-touch attribution: single most recent enrollment across ALL
    // sequences for this contact within the window. One attribution row per deal.
    const lastTouch = enrollments.reduce((best, e) =>
      !best || e.startedAt > best.startedAt ? e : best,
    );

    const deal = await this.db.deal.findFirst({
      where: { id: input.dealId, businessId: input.businessId },
      select: { value: true, currency: true },
    });

    try {
      await this.db.sequenceAttribution.upsert({
        where: { dealId: input.dealId },
        create: {
          businessId: input.businessId,
          sequenceId: lastTouch.sequenceId,
          enrollmentId: lastTouch.id,
          dealId: input.dealId,
          contactId: input.contactId,
          attributedValue: deal?.value ?? null,
          currency: deal?.currency ?? null,
          wonAt: input.wonAt,
          enrolledAt: lastTouch.startedAt,
          windowDays,
        },
        update: {
          sequenceId: lastTouch.sequenceId,
          enrollmentId: lastTouch.id,
          contactId: input.contactId,
          attributedValue: deal?.value ?? null,
          currency: deal?.currency ?? null,
          wonAt: input.wonAt,
          enrolledAt: lastTouch.startedAt,
          windowDays,
        },
      });
      return 1;
    } catch (err) {
      this.logger.warn(
        `Failed to write SequenceAttribution deal=${input.dealId} enrollment=${lastTouch.id}: ${(err as Error).message}`,
      );
      return 0;
    }
  }
}
