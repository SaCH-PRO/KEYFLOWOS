import { Injectable, Inject, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EntityResolutionService } from '../../core/connectors/entity-resolution.service';
import { AiOversightService } from '../ai/ai-oversight.service';
import { DriveIntakeOrchestrator, DriveIntakePlan } from '../commerce/drive-intake-orchestrator.service';
import { KeyInboxService } from '../key-inbox/key-inbox.service';
import { KeyInboxActionExecutorService, ActionExecutionResult } from '../key-inbox/key-inbox-action-executor.service';
import { InboxSuggestedAction } from '../key-inbox/key-inbox.types';
import { normalizeKeyInboxChannel } from '../key-inbox/key-inbox.constants';
import { IngestionItemInput } from '../../core/connectors/connector.interface';

/**
 * Phase 1 adapter strategy:
 * - IngestionOrchestrator is the canonical entry point and writes to IngestionItem.
 * - Message sources are normalized into KeyInboxThread / KeyInboxMessage and analysed
 *   by the Key Inbox pipeline, so the IngestionItem plan reflects the same actions
 *   the user sees in the Key Inbox UI.
 * - Drive and generic sources continue to use the legacy DriveIntakeOrchestrator or
 *   a generic fallback plan until they are fully migrated.
 * - Legacy MessageIntake is no longer used for new ingestion events.
 */
@Injectable()
export class IngestionOrchestrator {
  private readonly logger = new Logger(IngestionOrchestrator.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EntityResolutionService) private readonly entityResolution: EntityResolutionService,
    @Inject(AiOversightService) private readonly governance: AiOversightService,
    @Inject(DriveIntakeOrchestrator) private readonly driveOrchestrator: DriveIntakeOrchestrator,
    @Inject(KeyInboxService) private readonly keyInbox: KeyInboxService,
    @Inject(KeyInboxActionExecutorService) private readonly keyInboxActionExecutor: KeyInboxActionExecutorService,
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

    const connectorType = input.sourceConnectorType ?? input.sourceType;
    const connectorStatus = await this.getConnectorStatus(businessId, connectorType);
    if (!connectorStatus || !connectorStatus.intakeEnabled) {
      return this.prisma.client.ingestionItem.update({
        where: { id: item.id },
        data: { status: 'rejected', errorMessage: 'Intake disabled for this connector' },
      });
    }

    let current = item;
    try {
      await this.buildPlan(item.id);
      current = (await this.prisma.client.ingestionItem.findUnique({ where: { id: item.id } })) ?? item;
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`buildPlan failed for ${item.id}: ${message}`);
      current = await this.prisma.client.ingestionItem.update({
        where: { id: item.id },
        data: { status: 'error', errorMessage: message },
      });
    }

    if (
      connectorStatus.autoApproveThreshold != null &&
      current.status === 'reviewing' &&
      current.confidence != null &&
      current.confidence >= connectorStatus.autoApproveThreshold
    ) {
      try {
        current = await this.execute(item.id, 'system');
      } catch (err: any) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Auto-execute failed for ${item.id}: ${message}`);
      }
    }

    return current;
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
      if (item.sourceType === 'google_drive') {
        const legacy = await this.getOrCreateLegacyDriveIntake(item);
        results = await this.driveOrchestrator.executePlan(
          item.businessId,
          legacy.id,
          userId,
          item.proposedActions as unknown as DriveIntakePlan,
        ) as any;
      } else if (this.isMessageSource(item.sourceType)) {
        results = {
          handledBy: 'key_inbox',
          results: await this.executeMessageActions(item, userId),
        };
      } else {
        throw new BadRequestException(`Unsupported source type for execution: ${item.sourceType}`);
      }

      return await this.applyStatusLockedUpdate(
        itemId,
        ['reviewing', 'error'],
        { status: 'approved', executedResults: results as any, errorMessage: null },
      );
    } catch (err: any) {
      if (err instanceof ConflictException) throw err;
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

    return this.applyStatusLockedUpdate(
      itemId,
      ['reviewing', 'error', 'pending'],
      {
        status: 'rejected',
        userFeedback: {
          action: 'rejected',
          reason: reason ?? null,
        } as any,
      },
    );
  }

  async correct(itemId: string, correctedActions: Record<string, unknown>[], note?: string) {
    const item = await this.prisma.client.ingestionItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Ingestion item not found');
    if (item.status !== 'reviewing' && item.status !== 'error') {
      throw new BadRequestException(`Cannot correct item with status ${item.status}`);
    }

    return this.applyStatusLockedUpdate(
      itemId,
      ['reviewing', 'error'],
      {
        proposedActions: correctedActions as any,
        userFeedback: {
          action: 'corrected',
          note: note ?? null,
          correctedActions,
        } as any,
      },
    );
  }

  private async buildMessagePlan(item: { id: string; businessId: string; sourceType: string; sourceConnectorType: string; externalId: string | null; fromEmail: string | null; fromPhone: string | null; fromName: string | null; fromExternalId: string | null; toDestination: string | null; subject: string | null; body: string | null; rawPayload: any; contactId: string | null; receivedAt: Date | null }) {
    const channel = normalizeKeyInboxChannel(item.sourceType);
    const threadExternalId = item.fromEmail || item.fromPhone || item.fromExternalId || item.externalId || `ingestion-${item.id}`;

    const thread = await this.keyInbox.upsertThread({
      businessId: item.businessId,
      channel,
      externalThreadId: threadExternalId,
      contactId: item.contactId ?? null,
      subject: item.subject ?? this.truncate(item.body ?? 'New message', 100),
      status: 'OPEN',
      priority: 'NORMAL',
      metadata: {
        ingestionItemId: item.id,
        sourceConnectorType: item.sourceConnectorType,
        rawPayload: item.rawPayload,
      },
    });

    const { message } = await this.keyInbox.addMessage({
      businessId: item.businessId,
      threadId: thread.id,
      channel,
      direction: 'INBOUND',
      senderName: item.fromName ?? null,
      senderEmail: item.fromEmail ?? null,
      senderPhone: item.fromPhone ?? null,
      senderHandle: item.fromEmail || item.fromPhone || null,
      contentText: item.body ?? null,
      externalMessageId: item.externalId ?? null,
      receivedAt: item.receivedAt ?? new Date(),
      metadata: {
        ingestionItemId: item.id,
        sourceConnectorType: item.sourceConnectorType,
      },
      skipAnalysis: true,
    });

    await this.keyInbox.analyzeMessage(item.businessId, message.id);
    const analyzedThread = await this.keyInbox.analyzeThread(item.businessId, thread.id);
    const analyzedMessage = await this.prisma.client.keyInboxMessage.findUnique({
      where: { id: message.id },
    });

    const summary = analyzedThread.aiSummary || item.subject || this.truncate(item.body ?? 'New message', 100);
    const intentType = analyzedThread.aiIntent || (analyzedMessage?.aiAnalysis as Record<string, string> | undefined)?.intent || 'unknown';
    const confidence = analyzedThread.aiUrgency ? 0.9 : analyzedMessage?.aiConfidence ?? 0.5;
    const extractedData = {
      ...(analyzedMessage?.extractedEntities as Record<string, unknown> ?? {}),
      _keyInboxThreadId: thread.id,
      _keyInboxMessageId: message.id,
    };
    const proposedActions = (analyzedMessage?.suggestedActions as Record<string, unknown>[]) ?? [
      { type: 'review', label: 'Review in Key Inbox', confidence: 1, payload: { threadId: thread.id } },
    ];

    await this.prisma.client.ingestionItem.update({
      where: { id: item.id },
      data: {
        status: 'reviewing',
        summary,
        intentType,
        confidence,
        extractedData: extractedData as any,
        proposedActions: proposedActions as any,
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

  private async getConnectorStatus(businessId: string, connectorType: string) {
    return this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType } },
    });
  }

  private async applyStatusLockedUpdate(
    itemId: string,
    allowedStatuses: string[],
    data: Prisma.IngestionItemUpdateInput,
  ) {
    try {
      return await this.prisma.client.ingestionItem.update({
        where: { id: itemId, status: { in: allowedStatuses } },
        data,
      });
    } catch (err: any) {
      if (err?.code === 'P2025') {
        const current = await this.prisma.client.ingestionItem.findUnique({ where: { id: itemId } });
        throw new ConflictException({
          message: 'Ingestion item was modified by another request',
          current,
        });
      }
      throw err;
    }
  }

  private async executeMessageActions(
    item: { businessId: string; extractedData: any; proposedActions: any },
    userId: string,
  ): Promise<ActionExecutionResult[]> {
    const ref = (item.extractedData ?? {}) as Record<string, unknown>;
    const threadId = typeof ref._keyInboxThreadId === 'string' ? ref._keyInboxThreadId : null;
    if (!threadId) {
      throw new BadRequestException('Missing Key Inbox thread reference for execution');
    }
    const messageId = typeof ref._keyInboxMessageId === 'string' ? ref._keyInboxMessageId : undefined;
    const actions = (item.proposedActions ?? []) as InboxSuggestedAction[];
    if (!actions.length) {
      throw new BadRequestException('No actions to execute for this message source');
    }

    const results: ActionExecutionResult[] = [];
    for (const action of actions) {
      results.push(
        await this.keyInboxActionExecutor.execute(item.businessId, threadId, action, { messageId, userId }),
      );
    }
    return results;
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

  private truncate(text: string, maxLength: number): string {
    if (!text) return 'New message';
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
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
