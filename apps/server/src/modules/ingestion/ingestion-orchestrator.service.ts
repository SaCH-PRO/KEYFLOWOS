import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EntityResolutionService } from '../../core/connectors/entity-resolution.service';
import { AiOversightService } from '../ai/ai-oversight.service';
import { MessageIntakeOrchestrator } from '../communications/message-intake-orchestrator.service';
import { DriveIntakeOrchestrator } from '../commerce/drive-intake-orchestrator.service';
import { IngestionItemInput } from '../../core/connectors/connector.interface';

/**
 * Phase 1 adapter strategy:
 * - IngestionOrchestrator is the canonical entry point and writes to IngestionItem.
 * - To reuse existing AI/plan logic without refactoring legacy orchestrators yet,
 *   we mirror the item into the legacy MessageIntake/DriveIntakeFile table,
 *   call the legacy orchestrator, then copy the plan back.
 * - Phase 2/3 will refactor legacy orchestrators into pure functions.
 */
@Injectable()
export class IngestionOrchestrator {
  private readonly logger = new Logger(IngestionOrchestrator.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EntityResolutionService) private readonly entityResolution: EntityResolutionService,
    @Inject(AiOversightService) private readonly governance: AiOversightService,
    @Inject(MessageIntakeOrchestrator) private readonly messageOrchestrator: MessageIntakeOrchestrator,
    @Inject(DriveIntakeOrchestrator) private readonly driveOrchestrator: DriveIntakeOrchestrator,
  ) {}

  async receive(input: IngestionItemInput, businessId: string) {
    const dedupeHash = this.computeDedupeHash(input, businessId);
    const existing = input.externalId
      ? await this.prisma.client.ingestionItem.findUnique({
          where: {
            businessId_sourceType_externalId: {
              businessId,
              sourceType: input.sourceType,
              externalId: input.externalId,
            },
          },
        })
      : await this.prisma.client.ingestionItem.findUnique({
          where: { businessId_dedupeHash: { businessId, dedupeHash } },
        });

    if (existing) {
      this.logger.log(`Duplicate ingestion item skipped: ${existing.id}`);
      return existing;
    }

    const resolved = await this.entityResolution.resolveContact(businessId, {
      source: input.sourceConnectorType ?? input.sourceType,
      externalId: input.from.id,
      email: input.from.email,
      phone: input.from.phone,
      firstName: input.from.name?.split(' ')[0],
      lastName: input.from.name?.split(' ').slice(1).join(' ') || undefined,
    });

    const item = await this.prisma.client.ingestionItem.create({
      data: {
        businessId,
        sourceType: input.sourceType,
        sourceConnectorType: input.sourceConnectorType ?? input.sourceType,
        externalId: input.externalId,
        contactId: resolved.contactId,
        status: 'pending',
        rawPayload: input.rawPayload,
        summary: this.buildSummary(input),
        subject: input.subject,
        body: input.body,
        toDestination: input.to,
        receivedAt: input.receivedAt,
        attachments: input.attachments ? (input.attachments as any) : undefined,
        fromName: input.from.name,
        fromEmail: input.from.email,
        fromPhone: input.from.phone,
        fromExternalId: input.from.id,
        dedupeHash,
      },
    });

    try {
      await this.buildPlan(item.id);
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`buildPlan failed for ${item.id}: ${message}`);
      await this.prisma.client.ingestionItem.update({
        where: { id: item.id },
        data: { status: 'error', errorMessage: message },
      });
    }

    return item;
  }

  async buildPlan(itemId: string, attempt = 1): Promise<void> {
    const item = await this.prisma.client.ingestionItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Ingestion item not found');

    const maxAttempts = 3;
    try {
      if (this.isMessageSource(item.sourceType)) {
        await this.buildMessagePlan(item);
      } else if (item.sourceType === 'google_drive') {
        await this.buildDrivePlan(item);
      } else {
        await this.persistGenericPlan(item);
      }
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt < maxAttempts) {
        const delay = Math.pow(3, attempt) * 1000;
        this.logger.warn(`buildPlan attempt ${attempt} failed for ${itemId}, retrying in ${delay}ms: ${message}`);
        await new Promise((r) => setTimeout(r, delay));
        return this.buildPlan(itemId, attempt + 1);
      }
      throw err;
    }
  }

  async execute(itemId: string, userId: string) {
    const item = await this.prisma.client.ingestionItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Ingestion item not found');
    if (item.status === 'approved' || item.status === 'auto_executed') return item;
    if (item.status !== 'reviewing' && item.status !== 'error') {
      throw new BadRequestException(`Cannot execute item with status ${item.status}`);
    }

    const plan = item.proposedActions as Record<string, unknown> | null;
    if (!plan) throw new BadRequestException('No action plan found');

    try {
      let results: Record<string, unknown> = {};
      if (this.isMessageSource(item.sourceType)) {
        const legacy = await this.getOrCreateLegacyMessageIntake(item);
        results = await this.messageOrchestrator.executePlan(item.businessId, legacy.id, userId) as any;
      } else if (item.sourceType === 'google_drive') {
        const legacy = await this.getOrCreateLegacyDriveIntake(item);
        results = await this.driveOrchestrator.executePlan(item.businessId, legacy.id, userId) as any;
      } else {
        throw new BadRequestException(`Unsupported source type for execution: ${item.sourceType}`);
      }

      return await this.prisma.client.ingestionItem.update({
        where: { id: itemId, status: { in: ['reviewing', 'error'] } },
        data: { status: 'approved', executedResults: results as any, errorMessage: null },
      });
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Execution failed for ${itemId}: ${message}`);
      return await this.prisma.client.ingestionItem.update({
        where: { id: itemId },
        data: { status: 'error', errorMessage: message },
      });
    }
  }

  async reject(itemId: string, _userId: string, reason?: string) {
    const item = await this.prisma.client.ingestionItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Ingestion item not found');
    if (item.status !== 'reviewing' && item.status !== 'error' && item.status !== 'pending') {
      throw new BadRequestException(`Cannot reject item with status ${item.status}`);
    }

    return this.prisma.client.ingestionItem.update({
      where: { id: itemId, status: { in: ['reviewing', 'error', 'pending'] } },
      data: {
        status: 'rejected',
        userFeedback: {
          action: 'rejected',
          reason: reason ?? null,
        } as any,
      },
    });
  }

  async correct(itemId: string, correctedActions: Record<string, unknown>[], note?: string) {
    const item = await this.prisma.client.ingestionItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Ingestion item not found');
    if (item.status !== 'reviewing' && item.status !== 'error') {
      throw new BadRequestException(`Cannot correct item with status ${item.status}`);
    }

    return this.prisma.client.ingestionItem.update({
      where: { id: itemId, status: { in: ['reviewing', 'error'] } },
      data: {
        proposedActions: correctedActions as any,
        userFeedback: {
          action: 'corrected',
          note: note ?? null,
          correctedActions,
        } as any,
      },
    });
  }

  private async buildMessagePlan(item: { id: string; businessId: string; sourceType: string; sourceConnectorType: string; externalId: string | null; fromEmail: string | null; fromPhone: string | null; fromName: string | null; toDestination: string | null; subject: string | null; body: string | null; rawPayload: any; contactId: string | null }) {
    const legacy = await this.getOrCreateLegacyMessageIntake(item);
    await this.messageOrchestrator.buildPlan(legacy.id);
    const updated = await this.prisma.client.messageIntake.findUnique({ where: { id: legacy.id } });
    if (!updated) throw new Error('Legacy message intake disappeared');

    const summary = this.buildSummaryFromLegacy(updated);
    await this.prisma.client.ingestionItem.update({
      where: { id: item.id },
      data: {
        status: 'reviewing',
        summary,
        intentType: updated.intentType,
        confidence: updated.confidence,
        extractedData: updated.extractedData as any,
        proposedActions: updated.proposedActions as any,
      },
    });

    await this.createGovernanceItem(item.businessId, item.id, summary);
  }

  private async buildDrivePlan(item: { id: string; businessId: string; rawPayload: any; summary?: string | null }) {
    const legacy = await this.getOrCreateLegacyDriveIntake(item);
    const plan = await this.driveOrchestrator.buildPlan(item.businessId, legacy.id);
    await this.driveOrchestrator.createApprovalItem(item.businessId, plan);
    const updated = await this.prisma.client.driveIntakeFile.findUnique({ where: { id: legacy.id } });
    if (!updated) throw new Error('Legacy drive intake disappeared');

    await this.prisma.client.ingestionItem.update({
      where: { id: item.id },
      data: {
        status: 'reviewing',
        summary: updated.name,
        intentType: updated.documentType,
        confidence: updated.confidence,
        extractedData: updated.extractedData as any,
        proposedActions: updated.proposedActions as any,
      },
    });
  }

  private async persistGenericPlan(item: { id: string; sourceType: string; body?: string | null; summary?: string | null }) {
    await this.prisma.client.ingestionItem.update({
      where: { id: item.id },
      data: {
        status: 'reviewing',
        summary: item.summary || item.body || `Generic ${item.sourceType} item`,
        proposedActions: {
          intakeId: item.id,
          sourceChannel: item.sourceType,
          intentType: 'unknown',
          actions: [{ type: 'log_note', payload: { body: item.body || 'No content' } }],
          summary: item.summary || item.body || `Generic ${item.sourceType} item`,
        } as any,
      },
    });
  }

  private async getOrCreateLegacyMessageIntake(item: {
    id: string;
    businessId: string;
    sourceType: string;
    sourceConnectorType: string;
    externalId: string | null;
    fromEmail: string | null;
    fromPhone: string | null;
    fromName: string | null;
    toDestination: string | null;
    subject: string | null;
    body: string | null;
    rawPayload: any;
    contactId: string | null;
  }) {
    if (item.externalId) {
      const existing = await this.prisma.client.messageIntake.findUnique({
        where: {
          businessId_sourceChannel_externalId: {
            businessId: item.businessId,
            sourceChannel: item.sourceType,
            externalId: item.externalId,
          },
        },
      });
      if (existing) return existing;
    }

    return this.prisma.client.messageIntake.create({
      data: {
        businessId: item.businessId,
        connectorType: item.sourceConnectorType,
        sourceChannel: item.sourceType,
        externalId: item.externalId,
        from: item.fromEmail ?? item.fromPhone ?? 'unknown',
        fromName: item.fromName,
        to: item.toDestination,
        subject: item.subject,
        body: item.body ?? '',
        rawPayload: item.rawPayload,
        contactId: item.contactId,
        status: 'pending',
      },
    });
  }

  private async getOrCreateLegacyDriveIntake(item: { id: string; businessId: string; rawPayload: any; summary?: string | null }) {
    const payload = item.rawPayload as Record<string, unknown>;
    const driveFileId = (payload.driveFileId as string) || (payload.id as string) || `ingestion-${item.id}`;

    const existing = await this.prisma.client.driveIntakeFile.findUnique({
      where: { businessId_driveFileId: { businessId: item.businessId, driveFileId } },
    });
    if (existing) return existing;

    return this.prisma.client.driveIntakeFile.create({
      data: {
        businessId: item.businessId,
        driveFileId,
        name: (payload.name as string) || item.summary || 'Untitled',
        mimeType: (payload.mimeType as string) || 'application/octet-stream',
        webViewLink: (payload.webViewLink as string) || null,
        size: (payload.size as number) || 0,
        modifiedTime: new Date(),
        status: payload.extractedData ? 'reviewing' : 'pending',
        documentType: (payload.documentType as string) || null,
        confidence: typeof payload.confidence === 'number' ? payload.confidence : null,
        extractedData: payload.extractedData ? (payload.extractedData as any) : undefined,
      },
    });
  }

  private async createGovernanceItem(businessId: string, ingestionItemId: string, title: string) {
    await this.governance.createApprovalItem(businessId, {
      toolName: 'ingestion_item_review',
      module: 'operations',
      title: `Review: ${title}`,
      description: `KEY assessed an ingestion item and proposed actions.`,
      rationale: title,
      inputPayload: { ingestionItemId },
      affectedEntities: [{ type: 'ingestionItem', id: ingestionItemId }],
    });
  }

  private buildSummaryFromLegacy(item: { subject?: string | null; body: string }): string {
    return item.subject || item.body.slice(0, 120);
  }

  private isMessageSource(sourceType: string): boolean {
    return ['email', 'whatsapp', 'sms', 'instagram', 'messenger'].includes(sourceType);
  }

  private buildSummary(input: IngestionItemInput): string {
    if (input.subject) return input.subject;
    if (input.body) return input.body.slice(0, 120);
    if (input.attachments?.length) return `Attachment: ${input.attachments[0].name}`;
    return `New ${input.sourceType} item`;
  }

  private computeDedupeHash(input: IngestionItemInput, businessId: string): string {
    const receivedAt =
      input.receivedAt instanceof Date
        ? input.receivedAt.toISOString()
        : typeof input.receivedAt === 'string'
          ? input.receivedAt
          : new Date().toISOString();
    const key = [
      businessId,
      input.sourceType,
      input.from.email || input.from.phone || input.from.name || '',
      input.subject || '',
      input.body || '',
      receivedAt,
    ].join('|');
    return createHash('sha256').update(key).digest('hex');
  }
}
