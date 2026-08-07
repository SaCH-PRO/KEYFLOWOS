import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  Inject,
} from '@nestjs/common';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard } from '../../core/auth/module-scope.guard';
import { PrismaService } from '../../core/prisma/prisma.service';
import { InteractionClassifierService } from './interaction-classifier.service';
import { ProfitTrajectoryService } from './profit-trajectory.service';
import { ResponseDraftService } from './response-draft.service';
import { ConsentService } from './consent.service';
import { TriggerDefinitionService } from './trigger-definition.service';

@Controller('api/communications/businesses/:businessId')
@UseGuards(BusinessGuard, ModuleScopeGuard)
export class OmnichannelController {
  constructor(
    @Inject(InteractionClassifierService) private readonly classifier: InteractionClassifierService,
    @Inject(ProfitTrajectoryService) private readonly profit: ProfitTrajectoryService,
    @Inject(ResponseDraftService) private readonly drafts: ResponseDraftService,
    @Inject(ConsentService) private readonly consent: ConsentService,
    @Inject(TriggerDefinitionService) private readonly triggers: TriggerDefinitionService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  // ─── Channel Accounts ───

  @Get('channel-accounts')
  async listChannelAccounts(@Param('businessId') businessId: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const accounts = await (this.classifier as any).prisma.client.channelAccount.findMany({
      where: { businessId },
      orderBy: { providerKey: 'asc' },
    });
    return { items: accounts };
  }

  // ─── Interaction Intents ───

  @Get('intents')
  async listIntents(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('intentType') intentType?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prisma = (this.classifier as any).prisma.client;
    const where: Record<string, unknown> = { businessId };
    if (status) where.status = status;
    if (intentType) where.intentType = intentType;

    const [items, total] = await Promise.all([
      prisma.interactionIntent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(parseInt(limit ?? '50', 10), 100),
        skip: parseInt(offset ?? '0', 10),
        include: {
          contact: { select: { firstName: true, lastName: true, email: true, phone: true } },
        },
      }),
      prisma.interactionIntent.count({ where }),
    ]);

    return { items, total };
  }

  @Post('intents/:id/score')
  async scoreIntent(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prisma = (this.classifier as any).prisma.client;
    const intent = await prisma.interactionIntent.findFirst({
      where: { id, businessId },
      include: { message: true, contact: true },
    });
    if (!intent) return { error: 'Intent not found' };

    const score = await this.profit.scoreInteraction(
      businessId,
      intent.contactId,
      intent.intentType,
      intent.message?.body ?? '',
    );

    return score;
  }

  // ─── Response Drafts ───

  @Get('drafts')
  async listDrafts(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('channel') channel?: string,
    @Query('riskTier') riskTier?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.drafts.listDrafts(
      businessId,
      { status, channel, riskTier },
      { skip: parseInt(offset ?? '0', 10), take: parseInt(limit ?? '50', 10) },
    );
  }

  @Post('drafts/:id/approve')
  async approveDraft(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Request() req: { user?: { sub?: string } },
  ) {
    const approvedById = req.user?.sub ?? 'system';
    return this.drafts.approveDraft(businessId, id, approvedById);
  }

  @Post('drafts/:id/reject')
  async rejectDraft(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body('reason') reason: string,
  ) {
    return this.drafts.rejectDraft(businessId, id, reason ?? 'No reason provided');
  }

  @Post('drafts/:id/sent')
  async markDraftSent(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.drafts.markSent(businessId, id);
  }

  @Post('drafts/:id/send')
  async sendDraft(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Request() req: { user?: { sub?: string } },
  ) {
    const sentById = req.user?.sub ?? 'system';
    return this.drafts.sendDraft(businessId, id, sentById);
  }

  @Patch('drafts/:id')
  async updateDraft(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body('body') body: string,
    @Request() req: { user?: { sub?: string } },
  ) {
    const updatedById = req.user?.sub ?? 'system';
    return this.drafts.updateDraftBody(businessId, id, body, updatedById);
  }

  @Post('threads/:threadId/generate-reply')
  async generateReplyDraft(
    @Param('businessId') businessId: string,
    @Param('threadId') threadId: string,
    @Request() req: { user?: { sub?: string } },
  ) {
    const thread = await this.prisma.client.keyInboxThread.findFirst({
      where: { id: threadId, businessId },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        contact: { select: { firstName: true, lastName: true, displayName: true } },
      },
    });
    if (!thread) return { error: 'Thread not found' };

    const lastInbound = thread.messages.filter((m: { direction: string }) => m.direction === 'inbound').pop();
    const body = lastInbound?.contentText ?? '';

    const classification = this.classifier.classify(body, undefined, thread.channel);
    const contactName = thread.contact?.displayName ?? thread.contact?.firstName ?? 'there';
    const draftBody = this.drafts.generateBody(classification.intentType, {
      contactName,
      detectedDate: classification.extractedData?.detectedDate as string,
    });

    const draft = await this.drafts.createDraft(
      businessId,
      req.user?.sub ?? 'system',
      {
        channel: thread.channel as 'email' | 'sms' | 'whatsapp' | 'call' | 'form',
        purpose: `Reply to ${classification.intentType}`,
        body: draftBody,
        tone: classification.intentType === 'complaint' ? 'empathetic' : 'friendly',
        requiresApproval: classification.riskLevel === 'HIGH',
        riskTier: classification.riskLevel === 'HIGH' ? 'HIGH' : 'LOW',
        evidence: {
          intentId: null,
          intentType: classification.intentType,
          confidence: classification.confidence,
          threadId,
        },
      },
      { threadId: thread.id },
    );

    return { draft, classification };
  }

  // ─── Consent ───

  @Get('consent/:contactId')
  async checkConsent(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Query('channel') channel: string,
    @Query('type') type?: string,
  ) {
    return this.consent.checkConsent(
      businessId,
      contactId,
      channel,
      (type as 'marketing' | 'recording') ?? 'marketing',
    );
  }

  @Post('consent')
  async recordConsent(
    @Param('businessId') businessId: string,
    @Body('contactId') contactId: string,
    @Body('channel') channel: string,
    @Body('consentType') consentType: string,
    @Body('status') status: string,
    @Body('source') source: string,
    @Body('evidence') evidence?: string,
  ) {
    return this.consent.recordConsent(businessId, contactId, {
      channel,
      consentType: consentType as 'marketing' | 'recording' | 'all',
      status: status as 'granted' | 'revoked' | 'pending',
      source,
      evidence,
    });
  }

  @Get('consent')
  async listConsent(
    @Param('businessId') businessId: string,
    @Query('contactId') contactId?: string,
    @Query('channel') channel?: string,
    @Query('consentType') consentType?: string,
    @Query('status') status?: string,
  ) {
    return this.consent.listConsentRecords(businessId, contactId || undefined, {
      channel: channel || undefined,
      consentType: consentType || undefined,
      status: status || undefined,
    });
  }

  // ─── Triggers ───

  @Get('triggers')
  async listTriggers(
    @Param('businessId') businessId: string,
    @Query('enabled') enabled?: string,
    @Query('channel') channel?: string,
  ) {
    return this.triggers.listTriggers(businessId, {
      enabled: enabled !== undefined ? enabled === 'true' : undefined,
      channel,
    });
  }

  @Post('triggers')
  async createTrigger(
    @Param('businessId') businessId: string,
    @Body() body: { channel: string; eventType: string; name: string; condition: Record<string, unknown>; actions: Record<string, unknown>[]; enabled?: boolean },
  ) {
    return this.triggers.createTrigger(businessId, body);
  }

  @Patch('triggers/:id/toggle')
  async toggleTrigger(
    @Param('id') id: string,
    @Body('enabled') enabled: boolean,
  ) {
    return this.triggers.toggleTrigger(id, enabled);
  }

  @Post('triggers/seed')
  async seedTriggers(@Param('businessId') businessId: string) {
    await this.triggers.seedSystemTriggers(businessId);
    return { ok: true };
  }

  // ─── Unified Inbox ───

  @Get('unified-inbox')
  async unifiedInbox(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prisma = (this.classifier as any).prisma.client;
    const take = Math.min(parseInt(limit ?? '50', 10), 100);
    const skip = parseInt(offset ?? '0', 10);

    const [threads, drafts, intents] = await Promise.all([
      prisma.keyInboxThread.findMany({
        where: { businessId },
        orderBy: { updatedAt: 'desc' },
        take,
        skip,
        include: {
          messages: { orderBy: { sentAt: 'desc' }, take: 1, select: { contentText: true, direction: true, sendStatus: true, sentAt: true } },
          contact: { select: { firstName: true, lastName: true, email: true, phone: true } },
        },
      }),
      prisma.responseDraft.findMany({
        where: { businessId, status: { in: ['PENDING_APPROVAL', 'APPROVED'] } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          contact: { select: { firstName: true, lastName: true, email: true, phone: true } },
        },
      }),
      prisma.interactionIntent.findMany({
        where: { businessId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          contact: { select: { firstName: true, lastName: true, email: true, phone: true } },
        },
      }),
    ]);

    return {
      threads: { items: threads, total: threads.length },
      drafts: { items: drafts, total: drafts.length },
      intents: { items: intents, total: intents.length },
    };
  }
}
