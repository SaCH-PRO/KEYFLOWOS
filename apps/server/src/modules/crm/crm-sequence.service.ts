import { Inject, Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CrmTimelineService } from './crm-timeline.service';
import { CONTACT_EVENT } from '@keyflow/shared';
import {
  ensureGraph,
  getStartNodeId,
  graphToLegacySteps,
  isSendNode,
  isSequenceGraph,
  legacyStepsToGraph,
  pickVariantId,
  validateGraph,
  type SequenceGraph,
  type SequenceNode,
} from './crm-sequence-graph.util';

/**
 * Pre-compute variant assignments for every reachable send node in the
 * graph at enrollment time. This satisfies the "sticky per contact, locked
 * at enrollment" semantic: subsequent winner promotions only affect newly
 * enrolled contacts, never those already in flight.
 */
function precomputeVariantAssignments(graph: SequenceGraph): Record<string, string> {
  const assignments: Record<string, string> = {};
  for (const node of graph.nodes) {
    if (!isSendNode(node)) continue;
    const vid = pickVariantId(node);
    if (vid) assignments[node.id] = vid;
  }
  return assignments;
}

type VariantBucket = {
  variantId: string;
  label: string;
  weight: number;
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  converted: number;
};

export type VariantStepReport = {
  nodeId: string;
  nodeType: string;
  nodeLabel: string;
  totalEnrollments: number;
  variants: Array<
    VariantBucket & {
      openRate: number;
      clickRate: number;
      replyRate: number;
      conversionRate: number;
      isPromoted: boolean;
      isWinner: boolean;
      confidence: number;
    }
  >;
  promotedVariantId: string | null;
  winnerVariantId: string | null;
  winnerConfidence: number;
};

const MIN_PER_VARIANT_FOR_WINNER = 30;
const WINNER_CONFIDENCE_THRESHOLD = 0.95;

/**
 * Two-proportion z-test confidence that p1 > p2. Returns a value in [0, 1].
 * Used to decide if a candidate winner is statistically meaningful.
 */
function zTestConfidence(s1: number, n1: number, s2: number, n2: number): number {
  if (n1 < MIN_PER_VARIANT_FOR_WINNER || n2 < MIN_PER_VARIANT_FOR_WINNER) return 0;
  const p1 = s1 / n1;
  const p2 = s2 / n2;
  const pPool = (s1 + s2) / (n1 + n2);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / n1 + 1 / n2));
  if (!Number.isFinite(se) || se === 0) return 0;
  const z = (p1 - p2) / se;
  // Standard normal CDF approximation
  const cdf = 0.5 * (1 + erf(z / Math.SQRT2));
  return Math.max(0, Math.min(1, cdf));
}

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-a * a);
  return sign * y;
}

@Injectable()
export class CrmSequenceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CrmTimelineService) private readonly timeline: CrmTimelineService,
  ) {}

  private get db() {
    return this.prisma.client as any;
  }

  private toClientSequence(s: any) {
    const graph = ensureGraph({ graph: s.graph, steps: s.steps });
    return {
      id: s.id,
      businessId: s.businessId,
      name: s.name,
      description: s.description,
      steps: s.steps,
      graph,
      status: s.status,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
      enrollmentCount: s._count?.enrollments,
    };
  }

  async listSequences(businessId: string) {
    const sequences = await this.db.crmSequence.findMany({
      where: { businessId, status: { not: 'archived' } },
      include: {
        _count: { select: { enrollments: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return sequences.map((s: any) => this.toClientSequence(s));
  }

  private validateSteps(steps: unknown): void {
    if (!Array.isArray(steps)) {
      throw new HttpException('steps must be an array', HttpStatus.BAD_REQUEST);
    }
    const validTypes = ['email', 'whatsapp', 'sms', 'call', 'wait'];
    for (const step of steps) {
      if (!step || typeof step !== 'object') {
        throw new HttpException('Each step must be an object', HttpStatus.BAD_REQUEST);
      }
      const s = step as Record<string, unknown>;
      if (typeof s.stepNumber !== 'number' || !validTypes.includes(s.type as string)) {
        throw new HttpException('Each step must have a valid stepNumber and type', HttpStatus.BAD_REQUEST);
      }
      if (typeof s.delayDays !== 'number' || s.delayDays < 0) {
        throw new HttpException('Each step must have a non-negative delayDays', HttpStatus.BAD_REQUEST);
      }
    }
  }

  private resolveGraphAndSteps(payload: { graph?: unknown; steps?: unknown; status?: string }): {
    graph: SequenceGraph | null;
    steps: unknown;
  } {
    if (payload.graph !== undefined && payload.graph !== null) {
      if (!isSequenceGraph(payload.graph)) {
        throw new HttpException('graph must be a valid SequenceGraph object', HttpStatus.BAD_REQUEST);
      }
      const graph = payload.graph as SequenceGraph;
      // Strict content validation only when activating; drafts/paused can be partial
      const strict = payload.status === 'active';
      const result = validateGraph(graph, { strict });
      if (!result.ok) {
        throw new HttpException(`Invalid sequence graph: ${result.errors.join('; ')}`, HttpStatus.BAD_REQUEST);
      }
      const steps = graphToLegacySteps(graph);
      return { graph, steps };
    }
    if (payload.steps !== undefined) {
      this.validateSteps(payload.steps);
      const graph = legacyStepsToGraph(payload.steps as any);
      return { graph, steps: payload.steps };
    }
    return { graph: null, steps: undefined };
  }

  async createSequence(businessId: string, data: { name: string; description?: string; steps?: unknown; graph?: unknown; status?: string }) {
    if (!data.name) {
      throw new HttpException('name is required', HttpStatus.BAD_REQUEST);
    }
    const status = data.status === 'draft' || data.status === 'paused' || data.status === 'active'
      ? data.status
      : 'draft';
    const { graph, steps } = this.resolveGraphAndSteps({ ...data, status });
    if (!graph || steps === undefined) {
      throw new HttpException('Either steps or graph must be provided', HttpStatus.BAD_REQUEST);
    }

    const sequence = await this.db.crmSequence.create({
      data: {
        businessId,
        name: data.name,
        description: data.description ?? null,
        steps: steps as any,
        graph: graph as any,
        status,
      },
    });

    return this.toClientSequence({ ...sequence, _count: { enrollments: 0 } });
  }

  async getSequence(businessId: string, id: string) {
    const sequence = await this.db.crmSequence.findFirst({
      where: { id, businessId },
      include: {
        enrollments: {
          include: {
            contact: {
              select: { id: true, firstName: true, lastName: true, email: true, status: true },
            },
          },
          orderBy: { startedAt: 'desc' },
        },
      },
    });

    if (!sequence) {
      throw new HttpException('Sequence not found', HttpStatus.NOT_FOUND);
    }

    const base = this.toClientSequence(sequence);
    return {
      ...base,
      enrollments: sequence.enrollments.map((e: any) => ({
        id: e.id,
        contactId: e.contactId,
        contactName: [e.contact.firstName, e.contact.lastName].filter(Boolean).join(' ') || e.contact.email || 'Unknown',
        contactEmail: e.contact.email,
        contactStatus: e.contact.status,
        currentStep: e.currentStep,
        currentNodeId: e.currentNodeId,
        status: e.status,
        nextStepAt: e.nextStepAt?.toISOString() ?? null,
        startedAt: e.startedAt.toISOString(),
        completedAt: e.completedAt?.toISOString() ?? null,
      })),
    };
  }

  async updateSequence(businessId: string, id: string, data: { name?: string; description?: string; steps?: unknown; graph?: unknown; status?: string }) {
    const existing = await this.db.crmSequence.findFirst({
      where: { id, businessId },
    });

    if (!existing) {
      throw new HttpException('Sequence not found', HttpStatus.NOT_FOUND);
    }

    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    const effectiveStatus = data.status ?? existing.status;
    if (data.graph !== undefined || data.steps !== undefined) {
      const { graph, steps } = this.resolveGraphAndSteps({ ...data, status: effectiveStatus });
      if (graph !== null) updateData.graph = graph;
      if (steps !== undefined) updateData.steps = steps;
    }
    if (data.status !== undefined) updateData.status = data.status;

    const updated = await this.db.crmSequence.update({
      where: { id },
      data: updateData as any,
    });

    return this.toClientSequence(updated);
  }

  async deleteSequence(businessId: string, id: string) {
    const existing = await this.db.crmSequence.findFirst({
      where: { id, businessId },
    });

    if (!existing) {
      throw new HttpException('Sequence not found', HttpStatus.NOT_FOUND);
    }

    await this.db.crmSequence.update({
      where: { id },
      data: { status: 'archived' },
    });

    return { success: true };
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
        source: 'sequence',
      });
    } catch (err: any) {
      console.warn(`[CrmSequenceService] Failed to log event ${type} for contact ${contactId}:`, err);
    }
  }

  async enrollContacts(businessId: string, sequenceId: string, contactIds: string[]) {
    if (!Array.isArray(contactIds) || contactIds.length === 0) {
      throw new HttpException('contactIds must be a non-empty array', HttpStatus.BAD_REQUEST);
    }
    if (contactIds.length > 100) {
      throw new HttpException('Cannot enroll more than 100 contacts at once', HttpStatus.BAD_REQUEST);
    }

    const sequence = await this.db.crmSequence.findFirst({
      where: { id: sequenceId, businessId },
    });

    if (!sequence) {
      throw new HttpException('Sequence not found', HttpStatus.NOT_FOUND);
    }
    if (sequence.status !== 'active') {
      throw new HttpException('Only active sequences can enroll contacts', HttpStatus.BAD_REQUEST);
    }

    const graph = ensureGraph({ graph: sequence.graph, steps: sequence.steps });
    const startNodeId = getStartNodeId(graph);
    if (!startNodeId) {
      throw new HttpException('Sequence has no start node', HttpStatus.BAD_REQUEST);
    }
    const startNode = graph.nodes.find((n) => n.id === startNodeId);
    const firstDelayDays = startNode?.data?.delayDays ?? 0;
    const firstDelayHours = startNode?.data?.delayHours ?? 0;
    const nextStepAt = new Date(Date.now() + firstDelayDays * 86400_000 + firstDelayHours * 3600_000);

    const existingEnrollments = await this.db.crmSequenceEnrollment.findMany({
      where: {
        sequenceId,
        contactId: { in: contactIds },
        status: 'active',
      },
      select: { contactId: true },
    });

    const alreadyEnrolled = new Set(existingEnrollments.map((e: any) => e.contactId));
    const newContactIds = contactIds.filter((id) => !alreadyEnrolled.has(id));

    if (newContactIds.length === 0) {
      return { enrolled: 0, skipped: contactIds.length };
    }

    await Promise.all(
      newContactIds.map((contactId) => {
        // Pre-pick variants per enrollment so each contact gets independent
        // sticky assignments — promotion later won't reroute in-flight contacts.
        const variantAssignments = precomputeVariantAssignments(graph);
        return this.db.crmSequenceEnrollment.create({
          data: {
            sequenceId,
            contactId,
            currentStep: 0,
            currentNodeId: startNodeId,
            status: 'active',
            nextStepAt,
            metadata: { variantAssignments } as any,
          },
        });
      }),
    );

    await Promise.all(
      newContactIds.map((contactId) =>
        this.logEvent(businessId, contactId, CONTACT_EVENT.SEQUENCE_ENROLLED, {
          sequenceId,
          sequenceName: sequence.name,
          firstNodeType: startNode?.type ?? null,
          totalNodes: graph.nodes.length,
        }),
      ),
    );

    return { enrolled: newContactIds.length, skipped: alreadyEnrolled.size };
  }

  async advanceEnrollment(businessId: string, enrollmentId: string) {
    const enrollment = await this.db.crmSequenceEnrollment.findFirst({
      where: { id: enrollmentId },
      include: { sequence: { select: { businessId: true, name: true, steps: true, graph: true } } },
    });

    if (!enrollment || enrollment.sequence.businessId !== businessId) {
      throw new HttpException('Enrollment not found', HttpStatus.NOT_FOUND);
    }

    const graph = ensureGraph({ graph: enrollment.sequence.graph, steps: enrollment.sequence.steps });
    const currentNodeId: string | null = enrollment.currentNodeId ?? getStartNodeId(graph);
    const currentNode = currentNodeId ? graph.nodes.find((n) => n.id === currentNodeId) : null;

    // pick default outgoing edge
    const nextEdge = graph.edges.find((e) => e.source === (currentNodeId ?? '') && (e.branch ?? 'default') !== 'no')
      ?? graph.edges.find((e) => e.source === (currentNodeId ?? ''));
    const nextNodeId = nextEdge?.target ?? null;
    const nextNode = nextNodeId ? graph.nodes.find((n) => n.id === nextNodeId) : null;

    if (!nextNode || nextNode.type === 'end') {
      await this.db.crmSequenceEnrollment.update({
        where: { id: enrollmentId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          nextStepAt: null,
          currentNodeId: nextNodeId,
        },
      });

      await this.logEvent(businessId, enrollment.contactId, CONTACT_EVENT.SEQUENCE_STEP_ADVANCED, {
        sequenceId: enrollment.sequenceId,
        sequenceName: enrollment.sequence.name,
        fromNodeId: currentNodeId,
        toNodeId: nextNodeId,
        nodeType: currentNode?.type ?? null,
        completed: true,
      });

      return { status: 'completed', currentNodeId: nextNodeId };
    }

    const nextDelayDays = nextNode.data?.delayDays ?? 0;
    const nextDelayHours = nextNode.data?.delayHours ?? 0;
    const nextStepAt = new Date(Date.now() + nextDelayDays * 86400_000 + nextDelayHours * 3600_000);

    await this.db.crmSequenceEnrollment.update({
      where: { id: enrollmentId },
      data: {
        currentStep: enrollment.currentStep + 1,
        currentNodeId: nextNodeId,
        nextStepAt,
      },
    });

    await this.logEvent(businessId, enrollment.contactId, CONTACT_EVENT.SEQUENCE_STEP_ADVANCED, {
      sequenceId: enrollment.sequenceId,
      sequenceName: enrollment.sequence.name,
      fromNodeId: currentNodeId,
      toNodeId: nextNodeId,
      nodeType: currentNode?.type ?? null,
      nextNodeType: nextNode.type,
      completed: false,
    });

    return { status: 'active', currentNodeId: nextNodeId, nextStepAt: nextStepAt.toISOString() };
  }

  async duplicateSequence(businessId: string, id: string) {
    const existing = await this.db.crmSequence.findFirst({
      where: { id, businessId },
    });

    if (!existing) {
      throw new HttpException('Sequence not found', HttpStatus.NOT_FOUND);
    }

    const sequence = await this.db.crmSequence.create({
      data: {
        businessId,
        name: `${existing.name} (Copy)`,
        description: existing.description,
        steps: existing.steps as any,
        graph: existing.graph as any,
        status: 'draft',
      },
    });

    return this.toClientSequence({ ...sequence, _count: { enrollments: 0 } });
  }

  async getVariantReport(businessId: string, sequenceId: string): Promise<VariantStepReport[]> {
    const sequence = await this.db.crmSequence.findFirst({
      where: { id: sequenceId, businessId },
      include: { enrollments: true },
    });
    if (!sequence) {
      throw new HttpException('Sequence not found', HttpStatus.NOT_FOUND);
    }
    return this.buildSequenceReports(sequence);
  }

  async getAllVariantReports(
    businessId: string,
  ): Promise<Array<VariantStepReport & { sequenceId: string; sequenceName: string; sequenceStatus: string; channel: string }>> {
    const sequences = await this.db.crmSequence.findMany({
      where: { businessId, status: { not: 'archived' } },
      include: { enrollments: true },
      orderBy: { createdAt: 'desc' },
    });
    const out: Array<VariantStepReport & { sequenceId: string; sequenceName: string; sequenceStatus: string; channel: string }> = [];
    for (const sequence of sequences) {
      const reports = this.buildSequenceReports(sequence);
      for (const r of reports) {
        out.push({
          ...r,
          sequenceId: sequence.id,
          sequenceName: sequence.name,
          sequenceStatus: sequence.status,
          channel: r.nodeType,
        });
      }
    }
    return out;
  }

  private buildSequenceReports(sequence: any): VariantStepReport[] {
    const graph = ensureGraph({ graph: sequence.graph, steps: sequence.steps });
    const sendNodes = graph.nodes.filter((n: SequenceNode) => isSendNode(n));
    const reports: VariantStepReport[] = [];

    for (const node of sendNodes) {
      const declared = (node.data?.variants ?? []).slice();
      // Build a map keyed by variantId; include legacy/no-variant bucket as `__default__` if present
      const buckets = new Map<string, VariantBucket>();
      for (const v of declared) {
        buckets.set(v.id, {
          variantId: v.id,
          label: v.label ?? v.id,
          weight: v.weight,
          sent: 0,
          opened: 0,
          clicked: 0,
          replied: 0,
          converted: 0,
        });
      }

      for (const enr of sequence.enrollments) {
        const meta = (enr.metadata ?? {}) as any;
        const stepEv = meta?.stepEvents?.[node.id];
        if (!stepEv) continue;
        const vid = stepEv.variantId ?? '__default__';
        let bucket = buckets.get(vid);
        if (!bucket) {
          bucket = {
            variantId: vid,
            label: vid === '__default__' ? 'Default' : vid,
            weight: 0,
            sent: 0,
            opened: 0,
            clicked: 0,
            replied: 0,
            converted: 0,
          };
          buckets.set(vid, bucket);
        }
        if (stepEv.sentAt) bucket.sent += 1;
        if (stepEv.openedAt) bucket.opened += 1;
        if (stepEv.clickedAt) bucket.clicked += 1;
        if (stepEv.repliedAt) bucket.replied += 1;
        if (stepEv.convertedAt) bucket.converted += 1;
      }

      const arr = Array.from(buckets.values());
      // Compute rates
      const withRates = arr.map((b) => ({
        ...b,
        openRate: b.sent > 0 ? b.opened / b.sent : 0,
        clickRate: b.sent > 0 ? b.clicked / b.sent : 0,
        replyRate: b.sent > 0 ? b.replied / b.sent : 0,
        conversionRate: b.sent > 0 ? b.converted / b.sent : 0,
      }));

      // Pick winner candidate: highest reply rate (fallback open rate) with confidence
      let winnerVariantId: string | null = null;
      let winnerConfidence = 0;
      const promotedVariantId = node.data?.promotedVariantId ?? null;

      if (withRates.length >= 2) {
        const sorted = [...withRates].sort(
          (a, b) => b.replyRate - a.replyRate || b.openRate - a.openRate,
        );
        const top = sorted[0];
        const next = sorted[1];
        if (top && next && top.sent >= MIN_PER_VARIANT_FOR_WINNER) {
          // Use replyRate if any replies recorded, else openRate
          const useReply = top.replied + next.replied > 0;
          const conf = useReply
            ? zTestConfidence(top.replied, top.sent, next.replied, next.sent)
            : zTestConfidence(top.opened, top.sent, next.opened, next.sent);
          winnerConfidence = conf;
          if (conf >= WINNER_CONFIDENCE_THRESHOLD) {
            winnerVariantId = top.variantId;
          }
        }
      }

      reports.push({
        nodeId: node.id,
        nodeType: node.type,
        nodeLabel: node.data?.label ?? node.type,
        totalEnrollments: sequence.enrollments.length,
        promotedVariantId,
        winnerVariantId,
        winnerConfidence: Number(winnerConfidence.toFixed(3)),
        variants: withRates.map((b) => ({
          ...b,
          isPromoted: promotedVariantId === b.variantId,
          isWinner: winnerVariantId === b.variantId,
          confidence: winnerVariantId === b.variantId ? Number(winnerConfidence.toFixed(3)) : 0,
        })),
      });
    }

    return reports;
  }

  async promoteVariant(businessId: string, sequenceId: string, nodeId: string, variantId: string) {
    const sequence = await this.db.crmSequence.findFirst({
      where: { id: sequenceId, businessId },
    });
    if (!sequence) {
      throw new HttpException('Sequence not found', HttpStatus.NOT_FOUND);
    }
    const graph = ensureGraph({ graph: sequence.graph, steps: sequence.steps });
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node || !isSendNode(node)) {
      throw new HttpException('Send node not found', HttpStatus.NOT_FOUND);
    }
    const variant = (node.data?.variants ?? []).find((v) => v.id === variantId);
    if (!variant) {
      throw new HttpException('Variant not found on node', HttpStatus.NOT_FOUND);
    }
    node.data = { ...(node.data ?? {}), promotedVariantId: variantId };

    await this.db.crmSequence.update({
      where: { id: sequenceId },
      data: { graph: graph as any, steps: graphToLegacySteps(graph) as any },
    });

    return { success: true, promotedVariantId: variantId, nodeId };
  }

  async unenrollContact(businessId: string, enrollmentId: string) {
    const enrollment = await this.db.crmSequenceEnrollment.findFirst({
      where: { id: enrollmentId },
      include: { sequence: { select: { businessId: true, name: true, steps: true, graph: true } } },
    });

    if (!enrollment || enrollment.sequence.businessId !== businessId) {
      throw new HttpException('Enrollment not found', HttpStatus.NOT_FOUND);
    }

    await this.db.crmSequenceEnrollment.update({
      where: { id: enrollmentId },
      data: { status: 'unenrolled', nextStepAt: null },
    });

    const graph = ensureGraph({ graph: enrollment.sequence.graph, steps: enrollment.sequence.steps });
    await this.logEvent(businessId, enrollment.contactId, CONTACT_EVENT.SEQUENCE_UNENROLLED, {
      sequenceId: enrollment.sequenceId,
      sequenceName: enrollment.sequence.name,
      stoppedAtNodeId: enrollment.currentNodeId,
      totalNodes: graph.nodes.length,
    });

    return { success: true };
  }
}
