import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CrmTimelineService } from './crm-timeline.service';
import { CONTACT_EVENT } from '@keyflow/shared';
import {
  ensureGraph,
  getNextNodeId,
  getStartNodeId,
  isSendNode,
  pickVariantId,
  getVariantContent,
  type SequenceGraph,
  type SequenceNode,
} from './crm-sequence-graph.util';

const MAX_RETRIES = 3;
const BRANCH_RECHECK_INTERVAL_MS = 60 * 60 * 1000; // re-poll branch nodes hourly

type EnrollmentMeta = {
  retries?: number;
  lastError?: string | null;
  variantAssignments?: Record<string, string>;
  stepEvents?: Record<
    string,
    {
      variantId?: string | null;
      sentAt?: string;
      openedAt?: string;
      clickedAt?: string;
      repliedAt?: string;
      convertedAt?: string;
    }
  >;
  branchEnteredAt?: Record<string, string>;
  baselineHealth?: string | null;
};

@Injectable()
export class CrmSequenceSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CrmSequenceSchedulerService.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(CrmTimelineService) private readonly timeline: CrmTimelineService,
  ) {}

  private get db() {
    return this.prisma.client as any;
  }

  onModuleInit() {
    this.intervalRef = setInterval(() => {
      this.processDueEnrollments().catch((err) => {
        this.logger.error('Error processing due enrollments', err);
      });
    }, 60_000);
    this.logger.log('Sequence scheduler started (60s interval)');
  }

  onModuleDestroy() {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
    }
  }

  async processDueEnrollments() {
    if (this.running) return;
    this.running = true;
    try {
      await this.processDueEnrollmentsInner();
    } finally {
      this.running = false;
    }
  }

  private async processDueEnrollmentsInner() {
    const now = new Date();

    const dueEnrollments = await this.db.crmSequenceEnrollment.findMany({
      where: {
        status: 'active',
        nextStepAt: { lte: now },
      },
      include: {
        sequence: true,
        contact: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            relationshipHealth: true,
            bestChannel: true,
          },
        },
      },
    });

    if (dueEnrollments.length === 0) return;

    this.logger.log(`Processing ${dueEnrollments.length} due enrollment(s)`);

    for (const enrollment of dueEnrollments) {
      try {
        await this.processEnrollmentWithRetry(enrollment);
      } catch (err: any) {
        this.logger.error(`Failed to process enrollment ${enrollment.id}`, err);
      }
    }
  }

  private getRetryMeta(enrollment: any): { retries: number; lastError: string | null } {
    const meta = (enrollment.metadata ?? {}) as EnrollmentMeta;
    return {
      retries: typeof meta.retries === 'number' ? meta.retries : 0,
      lastError: meta.lastError ?? null,
    };
  }

  private async processEnrollmentWithRetry(enrollment: any) {
    try {
      await this.processEnrollment(enrollment);

      const currentMeta = (enrollment.metadata ?? {}) as EnrollmentMeta;
      if (currentMeta.retries && currentMeta.retries > 0) {
        await this.db.crmSequenceEnrollment.update({
          where: { id: enrollment.id },
          data: {
            metadata: { ...currentMeta, retries: 0, lastError: null },
          },
        });
      }
    } catch (err: any) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const { retries } = this.getRetryMeta(enrollment);
      const newRetries = retries + 1;
      const currentMeta = (enrollment.metadata ?? {}) as EnrollmentMeta;

      const contactName = [enrollment.contact?.firstName, enrollment.contact?.lastName]
        .filter(Boolean)
        .join(' ') || enrollment.contact?.email || 'Unknown';
      const businessId = enrollment.sequence.businessId;
      const graph = ensureGraph({ graph: enrollment.sequence.graph, steps: enrollment.sequence.steps });
      const currentNodeId = enrollment.currentNodeId ?? getStartNodeId(graph);
      const node = currentNodeId ? graph.nodes.find((n) => n.id === currentNodeId) : null;
      const nodeType = node?.type ?? 'unknown';

      if (newRetries >= MAX_RETRIES) {
        await this.db.crmSequenceEnrollment.update({
          where: { id: enrollment.id },
          data: {
            status: 'failed',
            nextStepAt: null,
            metadata: { ...currentMeta, retries: newRetries, lastError: errorMessage },
          },
        });

        await this.logEvent(businessId, enrollment.contactId, CONTACT_EVENT.SEQUENCE_STEP_FAILED, {
          sequenceId: enrollment.sequenceId,
          sequenceName: enrollment.sequence.name,
          nodeId: currentNodeId,
          nodeType,
          error: errorMessage,
          retryCount: newRetries,
          permanent: true,
        });

        this.events.emit('sequence.step_failed', {
          businessId,
          contactId: enrollment.contactId,
          contactName,
          sequenceId: enrollment.sequenceId,
          sequenceName: enrollment.sequence.name,
          nodeId: currentNodeId,
          nodeType,
          enrollmentId: enrollment.id,
          error: errorMessage,
          retryCount: newRetries,
        });

        this.logger.error(
          `Enrollment ${enrollment.id} permanently failed after ${newRetries} retries: ${errorMessage}`,
        );
      } else {
        await this.db.crmSequenceEnrollment.update({
          where: { id: enrollment.id },
          data: {
            metadata: { ...currentMeta, retries: newRetries, lastError: errorMessage },
          },
        });

        await this.logEvent(businessId, enrollment.contactId, CONTACT_EVENT.SEQUENCE_STEP_RETRY, {
          sequenceId: enrollment.sequenceId,
          sequenceName: enrollment.sequence.name,
          nodeId: currentNodeId,
          nodeType,
          error: errorMessage,
          retryCount: newRetries,
        });

        this.logger.warn(
          `Enrollment ${enrollment.id} step failed (retry ${newRetries}/${MAX_RETRIES}): ${errorMessage}`,
        );
      }
    }
  }

  private async advanceTo(
    enrollmentId: string,
    nodeId: string | null,
    graph: SequenceGraph,
    opts: { skipDelay?: boolean; metadata?: EnrollmentMeta } = {},
  ) {
    if (!nodeId) {
      await this.db.crmSequenceEnrollment.update({
        where: { id: enrollmentId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          nextStepAt: null,
          ...(opts.metadata ? { metadata: opts.metadata as any } : {}),
        },
      });
      return;
    }
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node || node.type === 'end') {
      await this.db.crmSequenceEnrollment.update({
        where: { id: enrollmentId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          nextStepAt: null,
          currentNodeId: nodeId,
          ...(opts.metadata ? { metadata: opts.metadata as any } : {}),
        },
      });
      return;
    }
    const delayDays = opts.skipDelay ? 0 : node.data?.delayDays ?? 0;
    const delayHours = opts.skipDelay ? 0 : node.data?.delayHours ?? 0;
    const nextStepAt = new Date(Date.now() + delayDays * 86400_000 + delayHours * 3600_000);
    await this.db.crmSequenceEnrollment.update({
      where: { id: enrollmentId },
      data: {
        currentNodeId: nodeId,
        nextStepAt,
        ...(opts.metadata ? { metadata: opts.metadata as any } : {}),
      },
    });
  }

  private async processEnrollment(enrollment: any) {
    const graph = ensureGraph({ graph: enrollment.sequence.graph, steps: enrollment.sequence.steps });
    const currentNodeId = enrollment.currentNodeId ?? getStartNodeId(graph);
    if (!currentNodeId) {
      await this.db.crmSequenceEnrollment.update({
        where: { id: enrollment.id },
        data: { status: 'completed', completedAt: new Date(), nextStepAt: null },
      });
      return;
    }

    const node = graph.nodes.find((n) => n.id === currentNodeId);
    if (!node || node.type === 'end') {
      await this.db.crmSequenceEnrollment.update({
        where: { id: enrollment.id },
        data: { status: 'completed', completedAt: new Date(), nextStepAt: null, currentNodeId },
      });
      return;
    }

    const contactName = [enrollment.contact?.firstName, enrollment.contact?.lastName]
      .filter(Boolean)
      .join(' ') || enrollment.contact?.email || 'Unknown';
    const businessId = enrollment.sequence.businessId;
    const meta: EnrollmentMeta = { ...((enrollment.metadata ?? {}) as EnrollmentMeta) };

    if (node.type === 'wait') {
      const nextId = getNextNodeId(graph, currentNodeId, 'default');
      await this.advanceTo(enrollment.id, nextId, graph, { skipDelay: true });
      await this.logEvent(businessId, enrollment.contactId, CONTACT_EVENT.SEQUENCE_STEP_DUE, {
        sequenceId: enrollment.sequenceId,
        sequenceName: enrollment.sequence.name,
        nodeId: currentNodeId,
        nodeType: 'wait',
        action: 'auto_advanced',
      });
      return;
    }

    if (node.type === 'branch') {
      meta.branchEnteredAt = meta.branchEnteredAt ?? {};
      if (!meta.branchEnteredAt[currentNodeId]) {
        meta.branchEnteredAt[currentNodeId] = new Date().toISOString();
        // Stash baseline health for relationship_health_changed_to comparison
        if (node.data?.condition === 'relationship_health_changed_to') {
          meta.baselineHealth = enrollment.contact?.relationshipHealth ?? null;
        }
      }

      const evaluation = await this.evaluateBranch(enrollment, node, meta);
      if (evaluation === 'pending') {
        // Wait window not elapsed yet; reschedule for later check
        const next = new Date(Date.now() + BRANCH_RECHECK_INTERVAL_MS);
        await this.db.crmSequenceEnrollment.update({
          where: { id: enrollment.id },
          data: { nextStepAt: next, metadata: meta as any },
        });
        return;
      }

      const branch: 'yes' | 'no' = evaluation;
      const nextId = getNextNodeId(graph, currentNodeId, branch);
      await this.advanceTo(enrollment.id, nextId, graph, { metadata: meta });
      await this.logEvent(businessId, enrollment.contactId, CONTACT_EVENT.SEQUENCE_STEP_DUE, {
        sequenceId: enrollment.sequenceId,
        sequenceName: enrollment.sequence.name,
        nodeId: currentNodeId,
        nodeType: 'branch',
        condition: node.data?.condition,
        branch,
        action: 'branched',
      });
      return;
    }

    let variantId: string | null = null;
    let payload: { subject?: string; body?: string; variantId: string | null };

    if (isSendNode(node)) {
      meta.variantAssignments = meta.variantAssignments ?? {};
      const existing = meta.variantAssignments[currentNodeId];
      if (existing) {
        variantId = existing;
      } else if (Array.isArray(node.data?.variants) && node.data!.variants!.length > 0) {
        variantId = pickVariantId(node);
        if (variantId) meta.variantAssignments[currentNodeId] = variantId;
      }
      payload = getVariantContent(node, variantId);

      meta.stepEvents = meta.stepEvents ?? {};
      const prior = meta.stepEvents[currentNodeId] ?? {};
      meta.stepEvents[currentNodeId] = {
        ...prior,
        variantId: variantId ?? prior.variantId ?? null,
        sentAt: prior.sentAt ?? new Date().toISOString(),
      };

      await this.logEvent(businessId, enrollment.contactId, CONTACT_EVENT.SEQUENCE_STEP_DUE, {
        sequenceId: enrollment.sequenceId,
        sequenceName: enrollment.sequence.name,
        nodeId: currentNodeId,
        nodeType: node.type,
        variantId,
        subject: payload.subject ?? null,
        body: payload.body ?? null,
        action: 'needs_approval',
      });
    }

    this.events.emit('sequence.step_due', {
      businessId,
      contactId: enrollment.contactId,
      contactName,
      sequenceId: enrollment.sequenceId,
      sequenceName: enrollment.sequence.name,
      nodeId: currentNodeId,
      nodeType: node.type,
      variantId,
      enrollmentId: enrollment.id,
    });

    const nextId = getNextNodeId(graph, currentNodeId, 'default');
    await this.advanceTo(enrollment.id, nextId, graph, { metadata: meta });
  }

  /**
   * Evaluate a branch node against engagement signals on the enrollment.
   * Returns 'yes' | 'no' | 'pending' (still waiting for the wait window).
   */
  private async evaluateBranch(
    enrollment: any,
    node: SequenceNode,
    meta: EnrollmentMeta,
  ): Promise<'yes' | 'no' | 'pending'> {
    const condition = node.data?.condition ?? 'no_reply';
    const waitForDays = node.data?.waitForDays ?? 3;
    const enteredAtIso = meta.branchEnteredAt?.[node.id];
    const enteredAt = enteredAtIso ? new Date(enteredAtIso) : new Date();
    const windowEnd = new Date(enteredAt.getTime() + waitForDays * 86400_000);
    const now = new Date();

    // Find the most recent send-node step's sentAt as the engagement reference window
    const stepEvents = meta.stepEvents ?? {};
    const recentSent = Object.values(stepEvents)
      .map((s) => (s.sentAt ? new Date(s.sentAt) : null))
      .filter((d): d is Date => !!d)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    const since = recentSent ?? enteredAt;

    switch (condition) {
      case 'opened': {
        if (this.hasEngagementEvent(enrollment, ['opened'], since)) return 'yes';
        if (now < windowEnd) return 'pending';
        return 'no';
      }
      case 'clicked': {
        if (this.hasEngagementEvent(enrollment, ['clicked'], since)) return 'yes';
        if (now < windowEnd) return 'pending';
        return 'no';
      }
      case 'replied': {
        if (this.hasReplyEvent(enrollment, since)) return 'yes';
        if (now < windowEnd) return 'pending';
        return 'no';
      }
      case 'engaged': {
        if (
          this.hasEngagementEvent(enrollment, ['opened', 'clicked'], since) ||
          this.hasReplyEvent(enrollment, since)
        ) return 'yes';
        if (now < windowEnd) return 'pending';
        return 'no';
      }
      case 'no_reply': {
        if (this.hasReplyEvent(enrollment, since)) return 'no';
        if (now < windowEnd) return 'pending';
        return 'yes';
      }
      case 'not_opened_in_days': {
        if (this.hasEngagementEvent(enrollment, ['opened'], since)) return 'no';
        if (now < windowEnd) return 'pending';
        return 'yes';
      }
      case 'relationship_health_changed_to': {
        const target = node.data?.targetHealth ?? null;
        const current = enrollment.contact?.relationshipHealth ?? null;
        const baseline = meta.baselineHealth ?? null;
        if (target && current === target && current !== baseline) return 'yes';
        if (now < windowEnd) return 'pending';
        return 'no';
      }
      case 'best_channel': {
        // Point-in-time check on the contact's best-channel field — never waits.
        const target = node.data?.targetChannel ?? null;
        const current = enrollment.contact?.bestChannel ?? null;
        return target && current === target ? 'yes' : 'no';
      }
      default:
        return 'no';
    }
  }

  /**
   * Engagement is sourced exclusively from this enrollment's stepEvents
   * (written by the delivery.opened / delivery.clicked listeners). We
   * deliberately do NOT fall back to contact-level events so that
   * unrelated communications/campaigns from other channels cannot
   * accidentally satisfy a sequence branch condition.
   */
  private hasEngagementEvent(
    enrollment: any,
    kinds: Array<'opened' | 'clicked'>,
    since: Date,
  ): boolean {
    const meta = (enrollment.metadata ?? {}) as EnrollmentMeta;
    const stepEvents = meta.stepEvents ?? {};
    for (const ev of Object.values(stepEvents)) {
      if (kinds.includes('opened') && ev.openedAt && new Date(ev.openedAt) >= since) return true;
      if (kinds.includes('clicked') && ev.clickedAt && new Date(ev.clickedAt) >= since) return true;
    }
    return false;
  }

  private hasReplyEvent(enrollment: any, since: Date): boolean {
    const meta = (enrollment.metadata ?? {}) as EnrollmentMeta;
    const stepEvents = meta.stepEvents ?? {};
    for (const ev of Object.values(stepEvents)) {
      if (ev.repliedAt && new Date(ev.repliedAt) >= since) return true;
    }
    return false;
  }

  // ------- Engagement listeners -----------------------------------------

  /**
   * When a delivery is opened or clicked, mark the most recent send-step
   * on the matching active enrollment as opened/clicked. This lets variant
   * stats and branch conditions see real engagement without a hard
   * delivery↔enrollment foreign key.
   */
  @OnEvent('delivery.opened', { async: true })
  async onDeliveryOpened(payload: { deliveryId: string; businessId?: string }) {
    await this.markEngagementForLatestSend(payload, 'openedAt');
  }

  @OnEvent('delivery.clicked', { async: true })
  async onDeliveryClicked(payload: { deliveryId: string; businessId?: string }) {
    await this.markEngagementForLatestSend(payload, 'clickedAt');
  }

  /**
   * Inbound message bus → reply attribution. Fires for any inbound channel
   * that emits `message.received` (currently WhatsApp; email/SMS handlers
   * can adopt the same event shape to participate).
   */
  @OnEvent('message.received', { async: true })
  async onMessageReceived(payload: { contactId?: string | null }) {
    if (payload?.contactId) {
      await this.markReplyForContact(payload.contactId);
    }
  }

  private async markEngagementForLatestSend(
    payload: { deliveryId: string; businessId?: string },
    field: 'openedAt' | 'clickedAt',
  ) {
    try {
      const delivery = await this.db.outboundDelivery.findUnique({
        where: { id: payload.deliveryId },
        select: { contactId: true, businessId: true, resultSnapshot: true },
      });
      if (!delivery?.contactId) return;
      // Prefer exact enrollment linkage if the sender stamped it in
      // resultSnapshot ({ sequenceEnrollmentId }). Falls back to recent-send
      // matching when no linkage is present.
      const snap = (delivery.resultSnapshot ?? null) as { sequenceEnrollmentId?: string } | null;
      const enrollmentId = snap?.sequenceEnrollmentId ?? null;
      await this.markEngagementOnEnrollment(delivery.contactId, field, { enrollmentId });
    } catch (err: any) {
      this.logger.warn(`Failed to mark ${field} engagement: ${(err as Error).message}`);
    }
  }

  /**
   * Public hook used when a contact replies via inbound message; marks the
   * most recent send step's `repliedAt`. Other modules can call this directly
   * if they have a contactId for an inbound communication.
   */
  async markReplyForContact(contactId: string) {
    await this.markEngagementOnEnrollment(contactId, 'repliedAt');
  }

  /**
   * Public hook for downstream conversion signals (e.g. deal won, booking
   * confirmed). Marks the most recent send step's `convertedAt` so variant
   * reports can attribute the conversion to the variant the contact saw.
   */
  async markConversionForContact(contactId: string) {
    await this.markEngagementOnEnrollment(contactId, 'convertedAt');
  }

  /**
   * Auto-attribute deal wins as conversions for any active enrollment of
   * the deal's primary contact. Decoupled from deal internals via event bus.
   */
  @OnEvent('crm.deal.won', { async: true })
  async onDealWon(payload: { contactId?: string | null }) {
    if (payload?.contactId) {
      await this.markConversionForContact(payload.contactId);
    }
  }

  private static readonly ENGAGEMENT_LOOKBACK_MS = 14 * 86400_000;

  /**
   * Mark an engagement timestamp on the appropriate enrollment step.
   * Attribution rules (in priority order):
   *   1. If an explicit `enrollmentId` is provided, target only that
   *      enrollment (used when the delivery snapshot links to a sequence).
   *   2. Otherwise, target the single active enrollment whose most-recent
   *      send-step is closest to "now" AND within the lookback window.
   *      This prevents cross-sequence contamination when a contact is
   *      enrolled in several sequences at once.
   */
  private async markEngagementOnEnrollment(
    contactId: string,
    field: 'openedAt' | 'clickedAt' | 'repliedAt' | 'convertedAt',
    opts: { enrollmentId?: string | null } = {},
  ) {
    const enrollments = await this.db.crmSequenceEnrollment.findMany({
      where: opts.enrollmentId
        ? { id: opts.enrollmentId, contactId }
        : { contactId, status: 'active' },
      orderBy: { startedAt: 'desc' },
    });
    if (enrollments.length === 0) return;

    type Candidate = { enr: any; nodeId: string; sentAtMs: number };
    const candidates: Candidate[] = [];
    const cutoff = Date.now() - CrmSequenceSchedulerService.ENGAGEMENT_LOOKBACK_MS;
    for (const enr of enrollments) {
      const meta = (enr.metadata ?? {}) as EnrollmentMeta;
      const stepEvents = meta.stepEvents ?? {};
      let bestNode: string | null = null;
      let bestT = 0;
      for (const [nodeId, ev] of Object.entries(stepEvents)) {
        if (ev.sentAt) {
          const t = new Date(ev.sentAt).getTime();
          if (t > bestT && t >= cutoff) { bestT = t; bestNode = nodeId; }
        }
      }
      if (bestNode) candidates.push({ enr, nodeId: bestNode, sentAtMs: bestT });
    }
    if (candidates.length === 0) return;

    // When attributing without explicit linkage, pick the single most-recent
    // candidate; otherwise apply to all matched enrollments (just one).
    const chosen = opts.enrollmentId
      ? candidates
      : [candidates.sort((a, b) => b.sentAtMs - a.sentAtMs)[0]];

    for (const c of chosen) {
      const meta: EnrollmentMeta = { ...((c.enr.metadata ?? {}) as EnrollmentMeta) };
      const stepEvents = { ...(meta.stepEvents ?? {}) };
      const ev = stepEvents[c.nodeId] ?? {};
      if (ev[field]) continue; // idempotent
      stepEvents[c.nodeId] = { ...ev, [field]: new Date().toISOString() };
      meta.stepEvents = stepEvents;
      await this.db.crmSequenceEnrollment.update({
        where: { id: c.enr.id },
        data: { metadata: meta as any },
      });
    }
  }

  private async logEvent(
    businessId: string,
    contactId: string,
    type: string,
    data: Record<string, unknown>,
  ) {
    try {
      await this.timeline.logEvent(businessId, contactId, type, data, {
        actorType: 'system',
        source: 'sequence_scheduler',
      });
    } catch (err: any) {
      this.logger.warn(`Failed to log event ${type} for contact ${contactId}`, err);
    }
  }
}
