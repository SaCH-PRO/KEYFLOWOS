import { Inject, Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CrmTimelineService } from './crm-timeline.service';
import { CONTACT_EVENT } from '@keyflow/shared';
import {
  ensureGraph,
  getStartNodeId,
  graphToLegacySteps,
  isSequenceGraph,
  legacyStepsToGraph,
  validateGraph,
  type SequenceGraph,
} from './crm-sequence-graph.util';

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
    } catch (err) {
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

    await this.db.crmSequenceEnrollment.createMany({
      data: newContactIds.map((contactId) => ({
        sequenceId,
        contactId,
        currentStep: 0,
        currentNodeId: startNodeId,
        status: 'active',
        nextStepAt,
      })),
    });

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
