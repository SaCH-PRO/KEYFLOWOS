import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AgentTriggerService } from './agent-trigger.service';
import { DocumentIntelligenceService } from './document-intelligence.service';
import { AgentBusService } from './agent-bus.service';
import { PlanExecutorService } from './plan-executor.service';
import { AiExecutionLogService } from './ai-execution-log.service';
import { ConversationalAIService } from './conversational-ai.service';
import { GoogleDriveService } from '../google-drive/google-drive.service';

interface ScannedFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  modifiedTime: string;
  size?: number;
}

interface ScannedMessage {
  id: string;
  from: string;
  body?: string;
  timestamp: string;
  type: string;
  mediaUrl?: string;
}

@Injectable()
export class ConnectorIntelligenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConnectorIntelligenceService.name);
  private scanInterval: NodeJS.Timeout | null = null;
  private readonly SCAN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  private processedFileIds = new Set<string>();
  private processedMessageIds = new Set<string>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(AgentTriggerService) private readonly triggerService: AgentTriggerService,
    @Inject(DocumentIntelligenceService) private readonly docIntel: DocumentIntelligenceService,
    @Inject(AgentBusService) private readonly agentBus: AgentBusService,
    @Inject(PlanExecutorService) private readonly planExecutor: PlanExecutorService,
    @Inject(AiExecutionLogService) private readonly executionLog: AiExecutionLogService,
    @Inject(ConversationalAIService) private readonly conversationalAI: ConversationalAIService,
    @Inject(GoogleDriveService) private readonly googleDrive: GoogleDriveService,
  ) {}

  onModuleInit() {
    this.scanInterval = setInterval(() => this.scanAllConnectors(), this.SCAN_INTERVAL_MS);
    this.logger.log(`Connector intelligence scanning every ${this.SCAN_INTERVAL_MS}ms`);
    setTimeout(() => this.scanAllConnectors(), 30_000);
  }

  onModuleDestroy() {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
  }

  async scanAllConnectors(): Promise<void> {
    const businesses = await this.prisma.client.business.findMany({
      select: { id: true },
      take: 50,
    });

    for (const biz of businesses) {
      try {
        await this.scanBusinessConnectors(biz.id);
      } catch (err) {
        this.logger.error(`Connector scan failed for ${biz.id}: ${(err as Error).message}`);
      }
    }
  }

  async scanBusinessConnectors(businessId: string): Promise<void> {
    // Get all connected connectors for this business
    const connectorStatuses = await this.prisma.client.connectorStatus.findMany({
      where: { businessId, status: 'connected' },
    });

    for (const status of connectorStatuses) {
      try {
        switch (status.connectorType) {
          case 'google_drive':
            await this.scanGoogleDrive(businessId);
            break;
          case 'whatsapp':
            await this.scanWhatsApp(businessId);
            break;
          case 'meta_social':
            await this.scanMetaMessages(businessId);
            break;
          case 'google_forms':
            await this.scanGoogleForms(businessId);
            break;
        }
      } catch (err) {
        this.logger.warn(`Scan ${status.connectorType} for ${businessId}: ${(err as Error).message}`);
      }
    }
  }

  async syncGoogleDrive(businessId: string): Promise<{ scanned: number; newFiles: number }> {
    const status = await this.prisma.client.driveSyncCursor.upsert({
      where: { businessId },
      create: { businessId, status: 'running' },
      update: { status: 'running', errorMessage: null },
    });

    let scanned = 0;
    let newFiles = 0;
    let pageToken: string | undefined;

    try {
      // Ensure token is valid before scanning
      await this.googleDrive.getValidAccessToken(businessId);

      const lastSync = status.lastSyncAt.toISOString();
      const query = `modifiedTime > '${lastSync}' and (mimeType contains 'image/' or mimeType contains 'application/pdf' or mimeType contains 'text/') and trashed = false`;

      do {
        const list = await this.googleDrive.listFiles(businessId, {
          query,
          pageSize: 50,
          pageToken,
          orderBy: 'modifiedTime desc',
        });

        pageToken = list.nextPageToken;
        const files = list.files ?? [];
        scanned += files.length;

        for (const file of files) {
          const modifiedTime = file.modifiedTime ? new Date(file.modifiedTime) : new Date();

          // Idempotency: same Drive file id + modifiedTime is one intake record
          const existing = await this.prisma.client.driveIntakeFile.findUnique({
            where: { businessId_driveFileId: { businessId, driveFileId: file.id } },
          });

          if (existing && existing.modifiedTime.getTime() >= modifiedTime.getTime()) {
            continue;
          }

          newFiles += 1;

          const intake = await this.prisma.client.driveIntakeFile.upsert({
            where: { businessId_driveFileId: { businessId, driveFileId: file.id } },
            create: {
              businessId,
              driveFileId: file.id,
              name: file.name,
              mimeType: file.mimeType,
              webViewLink: file.webViewLink,
              size: file.size ? Number(file.size) : null,
              modifiedTime,
              status: 'pending',
            },
            update: {
              name: file.name,
              mimeType: file.mimeType,
              webViewLink: file.webViewLink,
              size: file.size ? Number(file.size) : null,
              modifiedTime,
              status: 'pending',
              confidence: null,
              documentType: null,
              extractedData: Prisma.JsonNull,
              proposedActions: Prisma.JsonNull,
              errorMessage: null,
              processedAt: null,
            },
          });

          // Process asynchronously so one bad file does not block the scan
          this.processDriveIntakeFile(businessId, intake.id, file.id).catch((err) => {
            this.logger.warn(`Drive intake processing failed for ${file.id}: ${(err as Error).message}`);
          });
        }
      } while (pageToken);

      await this.prisma.client.driveSyncCursor.update({
        where: { businessId },
        data: { status: 'idle', lastSyncAt: new Date(), pageToken: null },
      });

      return { scanned, newFiles };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.client.driveSyncCursor.update({
        where: { businessId },
        data: { status: 'error', errorMessage: message },
      });
      throw err;
    }
  }

  private async processDriveIntakeFile(businessId: string, intakeId: string, driveFileId: string): Promise<void> {
    const intake = await this.prisma.client.driveIntakeFile.findUnique({ where: { id: intakeId } });
    if (!intake || intake.status !== 'pending') return;

    try {
      const { base64, mimeType, name } = await this.googleDrive.downloadBinary(businessId, driveFileId);

      const result = await this.docIntel.extractFromDocument({
        businessId,
        source: 'google_drive',
        mimeType,
        base64Content: base64,
        filename: name,
        externalId: driveFileId,
        sourceConnector: 'google_drive',
      });

      await this.prisma.client.driveIntakeFile.update({
        where: { id: intakeId },
        data: {
          status: result.confidence > 0.6 ? 'reviewing' : 'extracted',
          confidence: result.confidence,
          documentType: result.documentType,
          extractedData: result as unknown as Record<string, unknown>,
        },
      });

      this.events.emit('file.uploaded', {
        businessId,
        connectorType: 'google_drive',
        externalId: driveFileId,
        fileName: name,
        mimeType,
        intakeId,
        result,
      });

      this.events.emit('ingestion.item.received', {
        businessId,
        inputs: [
          {
            sourceType: 'google_drive',
            sourceConnectorType: 'google_drive',
            externalId: driveFileId,
            receivedAt: new Date(),
            from: { name: 'Google Drive' },
            subject: name,
            rawPayload: {
              driveFileId,
              name,
              mimeType,
              extractedData: result,
              documentType: result.documentType,
              confidence: result.confidence,
            },
          },
        ],
      });

      this.logger.log(`Extracted Drive file: ${name} (${result.documentType}, ${Math.round(result.confidence * 100)}%) for ${businessId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.client.driveIntakeFile.update({
        where: { id: intakeId },
        data: { status: 'error', errorMessage: message },
      });
    }
  }

  private async scanGoogleDrive(businessId: string): Promise<void> {
    // Kept for backward compatibility with the 5-minute background interval.
    await this.syncGoogleDrive(businessId).catch((err) => {
      this.logger.warn(`Background Drive sync failed for ${businessId}: ${(err as Error).message}`);
    });
  }

  private async scanWhatsApp(businessId: string): Promise<void> {
    // WhatsApp messages are received via webhooks, not polling
    // But we can check for unread messages or message status updates
    // For now, this is a placeholder for future WhatsApp Business API polling
    // The actual message ingestion happens via webhooks

    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { messageIntakeEnabled: true },
    });
    const intakeEnabled = business?.messageIntakeEnabled ?? false;

    // Check for pending message responses that AI should handle
    const pendingResponses = await this.prisma.client.whatsAppMessage.findMany({
      where: {
        businessId,
        direction: 'INBOUND',
        status: 'RECEIVED',
        createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
      },
      take: 10,
    });

    for (const msg of pendingResponses) {
      // Get contact phone from related WhatsAppContact
      const contact = await this.prisma.client.whatsAppContact.findUnique({
        where: { id: msg.whatsappContactId },
        select: { phoneNumber: true },
      });
      const fromPhone = contact?.phoneNumber ?? 'unknown';

      if (intakeEnabled) {
        this.events.emit('message.intake.received', {
          businessId,
          connectorType: 'whatsapp',
          sourceChannel: 'whatsapp',
          externalId: msg.wamid ?? msg.id,
          from: fromPhone,
          body: msg.body,
        });
        continue;
      }

      this.events.emit('message.received', {
        businessId,
        channel: 'whatsapp',
        from: fromPhone,
        body: msg.body,
        messageId: msg.id,
      });

      // Publish to agent bus for AI response routing
      this.agentBus.publish(businessId, {
        topic: 'whatsapp.inbound',
        payload: {
          messageId: msg.id,
          from: fromPhone,
          body: msg.body,
          timestamp: msg.createdAt,
        },
        senderAgentId: 'whatsapp_connector',
        priority: msg.body?.includes('urgent') || msg.body?.includes('emergency') ? 2 : 0,
      }).catch(() => {});

      // Process via conversational AI
      this.conversationalAI.handleInboundMessage({
        businessId,
        channel: 'whatsapp',
        from: fromPhone,
        messageBody: msg.body ?? '',
        messageId: msg.id,
      }).then((response) => {
        this.logger.log(`WhatsApp AI response for ${fromPhone}: ${response.reply.slice(0, 80)}...`);
      }).catch((err) => {
        this.logger.error(`Conversational AI failed for WhatsApp: ${(err as Error).message}`);
      });
    }
  }

  private async scanMetaMessages(businessId: string): Promise<void> {
    // Meta messages (Facebook/Instagram DMs) are received via webhooks
    // Check for recent engagement that needs AI response
    const recentEngagements = await this.prisma.client.socialEngagement.findMany({
      where: {
        businessId,
        type: { in: ['COMMENT', 'DM', 'MENTION'] },
        createdAt: { gte: new Date(Date.now() - 15 * 60 * 1000) },
        aiHandled: false,
      },
      take: 20,
    });

    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { messageIntakeEnabled: true },
    });
    const intakeEnabled = business?.messageIntakeEnabled ?? false;

    for (const engagement of recentEngagements) {
      if (intakeEnabled && engagement.type === 'DM' && engagement.content) {
        this.events.emit('message.intake.received', {
          businessId,
          connectorType: 'meta_social',
          sourceChannel: engagement.platform.toLowerCase() === 'instagram' ? 'instagram' : 'messenger',
          externalId: engagement.externalId ?? engagement.id,
          from: engagement.fromUserId ?? engagement.fromUserName ?? 'unknown',
          fromName: engagement.fromUserName ?? undefined,
          body: engagement.content,
        });
      }

      this.events.emit('social.engagement_received', {
        businessId,
        platform: engagement.platform,
        type: engagement.type,
        postId: engagement.postId,
        externalId: engagement.externalId,
      });

      // Publish to agent bus
      this.agentBus.publish(businessId, {
        topic: `social.${engagement.platform.toLowerCase()}.engagement`,
        payload: {
          engagementId: engagement.id,
          type: engagement.type,
          content: engagement.content,
          fromUser: engagement.fromUserName,
        },
        senderAgentId: 'meta_connector',
        priority: engagement.type === 'DM' ? 1 : 0,
      }).catch(() => {});

      // Process DMs via conversational AI
      if (engagement.type === 'DM' && engagement.content) {
        this.conversationalAI.handleInboundMessage({
          businessId,
          channel: engagement.platform.toLowerCase() === 'instagram' ? 'instagram' : 'messenger',
          from: engagement.fromUserName ?? engagement.fromUserId ?? 'unknown',
          messageBody: engagement.content,
          messageId: engagement.id,
        }).then((response) => {
          this.logger.log(`Social AI response for ${engagement.fromUserName}: ${response.reply.slice(0, 80)}...`);
        }).catch((err) => {
          this.logger.error(`Conversational AI failed for social DM: ${(err as Error).message}`);
        });
      }
    }
  }

  private async scanGoogleForms(businessId: string): Promise<void> {
    // Google Form responses are received via webhooks
    // This scans for recent form submissions that might need AI processing
    const recentSubmissions = await this.prisma.client.leadFormSubmission.findMany({
      where: {
        businessId,
        createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
      },
      include: { form: true },
      take: 20,
    });

    for (const submission of recentSubmissions) {
      this.events.emit('form.submitted', {
        businessId,
        formId: submission.formId,
        submissionId: submission.id,
        data: submission.data,
      });

      // Mark as processed - no aiProcessed field, rely on timestamp window

      // Trigger agent for lead qualification
      this.agentBus.publish(businessId, {
        topic: 'form.submission',
        payload: {
          submissionId: submission.id,
          formName: submission.form?.name,
          data: submission.data,
        },
        senderAgentId: 'google_forms_connector',
        priority: 1,
      }).catch(() => {});
    }
  }
}
