import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';

const MAX_RETRIES = 3;

@Injectable()
export class CrmSequenceSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CrmSequenceSchedulerService.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
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
      const steps = enrollment.sequence.steps as any[];
      const currentStepIndex = enrollment.currentStep;
      const step = steps[currentStepIndex];
      const stepType = step?.type ?? 'unknown';

      if (newRetries >= MAX_RETRIES) {
        await this.db.crmSequenceEnrollment.update({
          where: { id: enrollment.id },
          data: {
            status: 'failed',
            nextStepAt: null,
            metadata: { ...currentMeta, retries: newRetries, lastError: errorMessage },
          },
        });

        await this.logEvent(businessId, enrollment.contactId, 'sequence_step_failed', {
          sequenceId: enrollment.sequenceId,
          sequenceName: enrollment.sequence.name,
          stepIndex: currentStepIndex,
          stepType,
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
          stepIndex: currentStepIndex,
          stepType,
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

        await this.logEvent(businessId, enrollment.contactId, 'sequence_step_retry', {
          sequenceId: enrollment.sequenceId,
          sequenceName: enrollment.sequence.name,
          stepIndex: currentStepIndex,
          stepType,
          error: errorMessage,
          retryCount: newRetries,
        });

        this.logger.warn(
          `Enrollment ${enrollment.id} step failed (retry ${newRetries}/${MAX_RETRIES}): ${errorMessage}`,
        );
      }
    }
  }

  private async processEnrollment(enrollment: any) {
    const steps = enrollment.sequence.steps as any[];
    const currentStepIndex = enrollment.currentStep;

    if (currentStepIndex >= steps.length) {
      await this.db.crmSequenceEnrollment.update({
        where: { id: enrollment.id },
        data: { status: 'completed', completedAt: new Date(), nextStepAt: null },
      });
      return;
    }

    const step = steps[currentStepIndex];
    const contactName = [enrollment.contact?.firstName, enrollment.contact?.lastName]
      .filter(Boolean)
      .join(' ') || enrollment.contact?.email || 'Unknown';
    const businessId = enrollment.sequence.businessId;

    if (step.type === 'wait') {
      const nextStep = currentStepIndex + 1;
      if (nextStep >= steps.length) {
        await this.db.crmSequenceEnrollment.update({
          where: { id: enrollment.id },
          data: { currentStep: nextStep, status: 'completed', completedAt: new Date(), nextStepAt: null },
        });
      } else {
        const nextDelay = steps[nextStep]?.delayDays ?? 0;
        const nextStepAt = new Date(Date.now() + nextDelay * 24 * 60 * 60 * 1000);
        await this.db.crmSequenceEnrollment.update({
          where: { id: enrollment.id },
          data: { currentStep: nextStep, nextStepAt },
        });
      }

      await this.logEvent(businessId, enrollment.contactId, 'sequence_step_due', {
        sequenceId: enrollment.sequenceId,
        sequenceName: enrollment.sequence.name,
        stepIndex: currentStepIndex,
        stepType: 'wait',
        action: 'auto_advanced',
      });

      return;
    }

    if (step.type === 'email' || step.type === 'whatsapp') {
      await this.logEvent(businessId, enrollment.contactId, 'sequence_step_due', {
        sequenceId: enrollment.sequenceId,
        sequenceName: enrollment.sequence.name,
        stepIndex: currentStepIndex,
        stepType: step.type,
        subject: step.subject ?? null,
        body: step.body ?? null,
        action: 'needs_approval',
      });
    }

    if (step.type === 'call') {
      await this.db.contactTask.create({
        data: {
          businessId,
          contactId: enrollment.contactId,
          title: `Call: ${step.subject || enrollment.sequence.name} - Step ${currentStepIndex + 1}`,
          description: step.body || `Sequence "${enrollment.sequence.name}" requires a call to ${contactName}`,
          priority: 'high',
          status: 'pending',
          dueDate: new Date(),
        },
      });

      await this.logEvent(businessId, enrollment.contactId, 'sequence_step_due', {
        sequenceId: enrollment.sequenceId,
        sequenceName: enrollment.sequence.name,
        stepIndex: currentStepIndex,
        stepType: 'call',
        action: 'task_created',
      });
    }

    this.events.emit('sequence.step_due', {
      businessId,
      contactId: enrollment.contactId,
      contactName,
      sequenceId: enrollment.sequenceId,
      sequenceName: enrollment.sequence.name,
      stepIndex: currentStepIndex,
      stepType: step.type,
      enrollmentId: enrollment.id,
    });

    const nextStep = currentStepIndex + 1;
    if (nextStep >= steps.length) {
      await this.db.crmSequenceEnrollment.update({
        where: { id: enrollment.id },
        data: { currentStep: nextStep, status: 'completed', completedAt: new Date(), nextStepAt: null },
      });
    } else {
      const nextDelay = steps[nextStep]?.delayDays ?? 0;
      const nextStepAt = new Date(Date.now() + nextDelay * 24 * 60 * 60 * 1000);
      await this.db.crmSequenceEnrollment.update({
        where: { id: enrollment.id },
        data: { currentStep: nextStep, nextStepAt },
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
      await this.db.contactEvent.create({
        data: {
          businessId,
          contactId,
          type,
          data,
          actorType: 'system',
          source: 'sequence_scheduler',
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to log event ${type} for contact ${contactId}`, err);
    }
  }
}
