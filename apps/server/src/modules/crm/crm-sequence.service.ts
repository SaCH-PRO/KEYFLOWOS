import { Inject, Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class CrmSequenceService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client as any;
  }

  async listSequences(businessId: string) {
    const sequences = await this.db.crmSequence.findMany({
      where: { businessId, status: { not: 'archived' } },
      include: {
        _count: { select: { enrollments: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return sequences.map((s: any) => ({
      id: s.id,
      businessId: s.businessId,
      name: s.name,
      description: s.description,
      steps: s.steps,
      status: s.status,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
      enrollmentCount: s._count.enrollments,
    }));
  }

  private validateSteps(steps: unknown): void {
    if (!Array.isArray(steps)) {
      throw new HttpException('steps must be an array', HttpStatus.BAD_REQUEST);
    }
    const validTypes = ['email', 'whatsapp', 'call', 'wait'];
    for (const step of steps) {
      if (!step || typeof step !== 'object') {
        throw new HttpException('Each step must be an object', HttpStatus.BAD_REQUEST);
      }
      const s = step as Record<string, unknown>;
      if (typeof s.stepNumber !== 'number' || !validTypes.includes(s.type as string)) {
        throw new HttpException('Each step must have a valid stepNumber and type (email/whatsapp/call/wait)', HttpStatus.BAD_REQUEST);
      }
      if (typeof s.delayDays !== 'number' || s.delayDays < 0) {
        throw new HttpException('Each step must have a non-negative delayDays', HttpStatus.BAD_REQUEST);
      }
    }
  }

  async createSequence(businessId: string, data: { name: string; description?: string; steps: unknown }) {
    if (!data.name) {
      throw new HttpException('name is required', HttpStatus.BAD_REQUEST);
    }
    this.validateSteps(data.steps);

    const sequence = await this.db.crmSequence.create({
      data: {
        businessId,
        name: data.name,
        description: data.description ?? null,
        steps: data.steps as any,
        status: 'active',
      },
    });

    return {
      id: sequence.id,
      businessId: sequence.businessId,
      name: sequence.name,
      description: sequence.description,
      steps: sequence.steps,
      status: sequence.status,
      createdAt: sequence.createdAt.toISOString(),
      updatedAt: sequence.updatedAt.toISOString(),
      enrollmentCount: 0,
    };
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

    return {
      id: sequence.id,
      businessId: sequence.businessId,
      name: sequence.name,
      description: sequence.description,
      steps: sequence.steps,
      status: sequence.status,
      createdAt: sequence.createdAt.toISOString(),
      updatedAt: sequence.updatedAt.toISOString(),
      enrollments: sequence.enrollments.map((e: any) => ({
        id: e.id,
        contactId: e.contactId,
        contactName: [e.contact.firstName, e.contact.lastName].filter(Boolean).join(' ') || e.contact.email || 'Unknown',
        contactEmail: e.contact.email,
        contactStatus: e.contact.status,
        currentStep: e.currentStep,
        status: e.status,
        nextStepAt: e.nextStepAt?.toISOString() ?? null,
        startedAt: e.startedAt.toISOString(),
        completedAt: e.completedAt?.toISOString() ?? null,
      })),
    };
  }

  async updateSequence(businessId: string, id: string, data: { name?: string; description?: string; steps?: unknown; status?: string }) {
    const existing = await this.db.crmSequence.findFirst({
      where: { id, businessId },
    });

    if (!existing) {
      throw new HttpException('Sequence not found', HttpStatus.NOT_FOUND);
    }

    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.steps !== undefined) {
      this.validateSteps(data.steps);
      updateData.steps = data.steps;
    }
    if (data.status !== undefined) updateData.status = data.status;

    const updated = await this.db.crmSequence.update({
      where: { id },
      data: updateData as any,
    });

    return {
      id: updated.id,
      businessId: updated.businessId,
      name: updated.name,
      description: updated.description,
      steps: updated.steps,
      status: updated.status,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
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
      await this.db.contactEvent.create({
        data: {
          businessId,
          contactId,
          type,
          data,
          actorType: 'system',
          source: 'sequence',
        },
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

    const steps = sequence.steps as any[];
    const firstStepDelay = steps?.[0]?.delayDays ?? 0;
    const nextStepAt = new Date(Date.now() + firstStepDelay * 24 * 60 * 60 * 1000);

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
        status: 'active',
        nextStepAt,
      })),
    });

    await Promise.all(
      newContactIds.map((contactId) =>
        this.logEvent(businessId, contactId, 'sequence_enrolled', {
          sequenceId,
          sequenceName: sequence.name,
          firstStepType: steps?.[0]?.type ?? null,
          totalSteps: steps.length,
        }),
      ),
    );

    return { enrolled: newContactIds.length, skipped: alreadyEnrolled.size };
  }

  async advanceEnrollment(businessId: string, enrollmentId: string) {
    const enrollment = await this.db.crmSequenceEnrollment.findFirst({
      where: { id: enrollmentId },
      include: { sequence: { select: { businessId: true, name: true, steps: true } } },
    });

    if (!enrollment || enrollment.sequence.businessId !== businessId) {
      throw new HttpException('Enrollment not found', HttpStatus.NOT_FOUND);
    }

    const steps = enrollment.sequence.steps as any[];
    const nextStep = enrollment.currentStep + 1;
    const currentStepData = steps[enrollment.currentStep] ?? null;

    if (nextStep >= steps.length) {
      await this.db.crmSequenceEnrollment.update({
        where: { id: enrollmentId },
        data: {
          currentStep: nextStep,
          status: 'completed',
          completedAt: new Date(),
          nextStepAt: null,
        },
      });

      await this.logEvent(businessId, enrollment.contactId, 'sequence_step_advanced', {
        sequenceId: enrollment.sequenceId,
        sequenceName: enrollment.sequence.name,
        fromStep: enrollment.currentStep,
        toStep: nextStep,
        stepType: currentStepData?.type ?? null,
        stepSubject: currentStepData?.subject ?? null,
        completed: true,
      });

      return { status: 'completed', currentStep: nextStep };
    }

    const nextDelay = steps[nextStep]?.delayDays ?? 0;
    const nextStepAt = new Date(Date.now() + nextDelay * 24 * 60 * 60 * 1000);

    await this.db.crmSequenceEnrollment.update({
      where: { id: enrollmentId },
      data: {
        currentStep: nextStep,
        nextStepAt,
      },
    });

    await this.logEvent(businessId, enrollment.contactId, 'sequence_step_advanced', {
      sequenceId: enrollment.sequenceId,
      sequenceName: enrollment.sequence.name,
      fromStep: enrollment.currentStep,
      toStep: nextStep,
      stepType: currentStepData?.type ?? null,
      stepSubject: currentStepData?.subject ?? null,
      nextStepType: steps[nextStep]?.type ?? null,
      completed: false,
    });

    return { status: 'active', currentStep: nextStep, nextStepAt: nextStepAt.toISOString() };
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
        status: 'active',
      },
    });

    return {
      id: sequence.id,
      businessId: sequence.businessId,
      name: sequence.name,
      description: sequence.description,
      steps: sequence.steps,
      status: sequence.status,
      createdAt: sequence.createdAt.toISOString(),
      updatedAt: sequence.updatedAt.toISOString(),
      enrollmentCount: 0,
    };
  }

  async unenrollContact(businessId: string, enrollmentId: string) {
    const enrollment = await this.db.crmSequenceEnrollment.findFirst({
      where: { id: enrollmentId },
      include: { sequence: { select: { businessId: true, name: true, steps: true } } },
    });

    if (!enrollment || enrollment.sequence.businessId !== businessId) {
      throw new HttpException('Enrollment not found', HttpStatus.NOT_FOUND);
    }

    await this.db.crmSequenceEnrollment.update({
      where: { id: enrollmentId },
      data: { status: 'unenrolled', nextStepAt: null },
    });

    const steps = enrollment.sequence.steps as any[];
    await this.logEvent(businessId, enrollment.contactId, 'sequence_unenrolled', {
      sequenceId: enrollment.sequenceId,
      sequenceName: enrollment.sequence.name,
      stoppedAtStep: enrollment.currentStep,
      totalSteps: steps.length,
    });

    return { success: true };
  }
}
