import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CrmTimelineService } from './crm-timeline.service';
import { CONTACT_EVENT } from '@keyflow/shared';
import { ensureGraph, getNextNodeId, getStartNodeId } from './crm-sequence-graph.util';

const MAX_RETRIES = 3;

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
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    if (dueEnrollments.length === 0) return;

    this.logger.log(`Processing ${dueEnrollments.length} due enrollment(s)`);

    for (const enrollment of dueEnrollments) {
      try {
        await this.processEnrollmentWithRetry(enrollment);
      } catch (err) {
        this.logger.error(`Failed to process enrollment ${enrollment.id}`, err);
      }
    }
  }

  private getRetryMeta(enrollment: any): { retries: number; lastError: string | null } {
    const meta = enrollment.metadata ?? {};
    return {
      retries: typeof meta.retries === 'number' ? meta.retries : 0,
      lastError: meta.lastError ?? null,
    };
  }

  private async processEnrollmentWithRetry(enrollment: any) {
    try {
      await this.processEnrollment(enrollment);

      const currentMeta = enrollment.metadata ?? {};
      if (currentMeta.retries && currentMeta.retries > 0) {
        await this.db.crmSequenceEnrollment.update({
          where: { id: enrollment.id },
          data: {
            metadata: { ...currentMeta, retries: 0, lastError: null },
          },
        });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const { retries } = this.getRetryMeta(enrollment);
      const newRetries = retries + 1;
      const currentMeta = enrollment.metadata ?? {};

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
    graph: ReturnType<typeof ensureGraph>,
    opts: { skipDelay?: boolean } = {},
  ) {
    if (!nodeId) {
      await this.db.crmSequenceEnrollment.update({
        where: { id: enrollmentId },
        data: { status: 'completed', completedAt: new Date(), nextStepAt: null },
      });
      return;
    }
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node || node.type === 'end') {
      await this.db.crmSequenceEnrollment.update({
        where: { id: enrollmentId },
        data: { status: 'completed', completedAt: new Date(), nextStepAt: null, currentNodeId: nodeId },
      });
      return;
    }
    const delayDays = opts.skipDelay ? 0 : node.data?.delayDays ?? 0;
    const delayHours = opts.skipDelay ? 0 : node.data?.delayHours ?? 0;
    const nextStepAt = new Date(Date.now() + delayDays * 86400_000 + delayHours * 3600_000);
    await this.db.crmSequenceEnrollment.update({
      where: { id: enrollmentId },
      data: { currentNodeId: nodeId, nextStepAt },
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

    if (node.type === 'wait') {
      // Wait node's delay was already honored on entry. Advance to next node
      // immediately so the next action's own delayDays is not double-counted.
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
      // Default branching: until engagement signals are wired (next M4 task), follow the "no" path
      const branch: 'yes' | 'no' = 'no';
      const nextId = getNextNodeId(graph, currentNodeId, branch);
      await this.advanceTo(enrollment.id, nextId, graph);
      await this.logEvent(businessId, enrollment.contactId, CONTACT_EVENT.SEQUENCE_STEP_DUE, {
        sequenceId: enrollment.sequenceId,
        sequenceName: enrollment.sequence.name,
        nodeId: currentNodeId,
        nodeType: 'branch',
        branch,
        action: 'branched',
      });
      return;
    }

    if (node.type === 'email' || node.type === 'whatsapp' || node.type === 'sms') {
      await this.logEvent(businessId, enrollment.contactId, CONTACT_EVENT.SEQUENCE_STEP_DUE, {
        sequenceId: enrollment.sequenceId,
        sequenceName: enrollment.sequence.name,
        nodeId: currentNodeId,
        nodeType: node.type,
        subject: node.data?.subject ?? null,
        body: node.data?.body ?? null,
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
      enrollmentId: enrollment.id,
    });

    const nextId = getNextNodeId(graph, currentNodeId, 'default');
    await this.advanceTo(enrollment.id, nextId, graph);
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
    } catch (err) {
      this.logger.warn(`Failed to log event ${type} for contact ${contactId}`, err);
    }
  }
}
