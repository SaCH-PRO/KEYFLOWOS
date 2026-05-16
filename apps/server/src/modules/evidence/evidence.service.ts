import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { BusinessEventService } from '../business-events/business-event.service';

export interface SubmitEvidenceInput {
  businessId: string;
  evidenceType: 'photo' | 'file' | 'signature' | 'checklist' | 'message' | 'note' | 'document';
  url: string;
  storageKey: string;
  mimeType?: string;
  sizeBytes?: number;
  submittedBy: string; // userId or "key_ai"
  linkedType: string; // "ContactTask" | "ProjectTask" | "ApprovalRequest" | "Contact" | "CallLog"
  linkedId: string;
  metadata?: Record<string, unknown>;
}

export interface VerifyEvidenceInput {
  evidenceId: string;
  verifierId: string;
}

@Injectable()
export class EvidenceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessEventService) private readonly events: BusinessEventService,
    @Inject(EventEmitter2) private readonly emitter: EventEmitter2,
  ) {}

  async submit(input: SubmitEvidenceInput) {
    const evidence = await this.prisma.client.evidence.create({
      data: {
        businessId: input.businessId,
        evidenceType: input.evidenceType,
        url: input.url,
        storageKey: input.storageKey,
        mimeType: input.mimeType ?? null,
        sizeBytes: input.sizeBytes ?? null,
        submittedBy: input.submittedBy,
        linkedType: input.linkedType,
        linkedId: input.linkedId,
        metadata: input.metadata ?? undefined,
      },
    });

    await this.events.emit({
      businessId: input.businessId,
      eventType: 'evidence.submitted',
      subjectType: 'evidence',
      subjectId: evidence.id,
      actorType: input.submittedBy === 'key_ai' ? 'ai' : 'human',
      actorId: input.submittedBy,
      action: 'submit',
      source: 'web',
      metadata: {
        evidenceType: input.evidenceType,
        linkedType: input.linkedType,
        linkedId: input.linkedId,
      },
    });

    this.emitter.emit('evidence.submitted', {
      evidence: { businessId: input.businessId, id: evidence.id, evidenceType: input.evidenceType },
      linkedType: input.linkedType,
      linkedId: input.linkedId,
    });

    return evidence;
  }

  async verify(input: VerifyEvidenceInput) {
    const evidence = await this.prisma.client.evidence.findFirst({
      where: { id: input.evidenceId },
    });
    if (!evidence) throw new NotFoundException('Evidence not found');

    const updated = await this.prisma.client.evidence.update({
      where: { id: input.evidenceId },
      data: {
        verifiedBy: input.verifierId,
        verifiedAt: new Date(),
      },
    });

    await this.events.emit({
      businessId: evidence.businessId,
      eventType: 'evidence.verified',
      subjectType: 'evidence',
      subjectId: evidence.id,
      actorType: 'human',
      actorId: input.verifierId,
      action: 'verify',
      source: 'web',
    });

    this.emitter.emit('evidence.verified', {
      evidence: { businessId: evidence.businessId, id: evidence.id },
      verifierId: input.verifierId,
    });

    return updated;
  }

  async getForObject(linkedType: string, linkedId: string, businessId?: string) {
    const where: any = { linkedType, linkedId };
    if (businessId) where.businessId = businessId;

    return this.prisma.client.evidence.findMany({
      where,
      orderBy: { submittedAt: 'desc' },
    });
  }

  async getById(evidenceId: string) {
    const evidence = await this.prisma.client.evidence.findUnique({
      where: { id: evidenceId },
    });
    if (!evidence) throw new NotFoundException('Evidence not found');
    return evidence;
  }

  async listForBusiness(businessId: string, options?: { evidenceType?: string; limit?: number; offset?: number }) {
    const where: any = { businessId };
    if (options?.evidenceType) where.evidenceType = options.evidenceType;

    const [items, total] = await Promise.all([
      this.prisma.client.evidence.findMany({
        where,
        orderBy: { submittedAt: 'desc' },
        skip: options?.offset ?? 0,
        take: options?.limit ?? 50,
      }),
      this.prisma.client.evidence.count({ where }),
    ]);

    return { items, total, offset: options?.offset ?? 0, limit: options?.limit ?? 50 };
  }

  async delete(evidenceId: string, deletedBy: string) {
    const evidence = await this.prisma.client.evidence.findUnique({
      where: { id: evidenceId },
    });
    if (!evidence) throw new NotFoundException('Evidence not found');

    await this.prisma.client.evidence.delete({ where: { id: evidenceId } });

    await this.events.emit({
      businessId: evidence.businessId,
      eventType: 'evidence.deleted',
      subjectType: 'evidence',
      subjectId: evidence.id,
      actorType: 'human',
      actorId: deletedBy,
      action: 'delete',
      source: 'web',
    });

    this.emitter.emit('evidence.deleted', {
      evidence: { businessId: evidence.businessId, id: evidence.id },
      deletedBy,
    });

    return { success: true };
  }

  /**
   * Check if a task has sufficient evidence for completion.
   */
  async checkTaskEvidence(taskType: string, taskId: string): Promise<{ required: boolean; hasEvidence: boolean; evidenceCount: number }> {
    let evidenceRequired = false;

    if (taskType === 'ContactTask') {
      const task = await this.prisma.client.contactTask.findUnique({
        where: { id: taskId },
        select: { evidenceRequired: true },
      });
      evidenceRequired = task?.evidenceRequired ?? false;
    } else if (taskType === 'ProjectTask') {
      const task = await this.prisma.client.projectTask.findUnique({
        where: { id: taskId },
        select: { evidenceRequired: true },
      });
      evidenceRequired = task?.evidenceRequired ?? false;
    }

    const evidence = await this.getForObject(taskType, taskId);
    return {
      required: evidenceRequired,
      hasEvidence: evidence.length > 0,
      evidenceCount: evidence.length,
    };
  }
}
