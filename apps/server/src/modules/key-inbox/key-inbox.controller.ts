import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { BusinessEventService } from '../business-events/business-event.service';
import { KeyInboxService } from './key-inbox.service';
import { KeyInboxActionExecutorService } from './key-inbox-action-executor.service';
import { KeyInboxIntelligenceService } from './key-inbox-intelligence.service';
import { ExecuteActionDto } from './dto/execute-action.dto';
import { ReplyDto } from './dto/reply.dto';
import { UpdateThreadDto } from './dto/update-thread.dto';
import { GenerateKeyInboxIntelligenceDto } from './dto/generate-intelligence.dto';
import type { IntelligenceScope } from './key-inbox-intelligence.types';
import type { CreateInboxMessageInput, CreateInboxThreadInput } from './key-inbox.types';
import { normalizeKeyInboxChannel } from './key-inbox.constants';

@Controller('key-inbox/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class KeyInboxController {
  constructor(
    @Inject(KeyInboxService) private readonly keyInbox: KeyInboxService,
    @Inject(KeyInboxActionExecutorService) private readonly actionExecutor: KeyInboxActionExecutorService,
    @Inject(KeyInboxIntelligenceService) private readonly intelligence: KeyInboxIntelligenceService,
    @Inject(BusinessEventService) private readonly businessEvents: BusinessEventService,
  ) {}

  @Get('threads')
  async listThreads(
    @Param('businessId') businessId: string,
    @Query('channel') channel?: string,
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('intent') intent?: string,
    @Query('urgency') urgency?: string,
    @Query('sentiment') sentiment?: string,
    @Query('sendStatus') sendStatus?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.keyInbox.listThreads(businessId, {
      channel,
      status,
      priority,
      intent,
      urgency,
      sentiment,
      sendStatus,
      search,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Get('threads/:threadId')
  async getThread(
    @Param('businessId') businessId: string,
    @Param('threadId') threadId: string,
  ) {
    const thread = await this.keyInbox.getThread(businessId, threadId);
    if (!thread) throw new NotFoundException('Thread not found');
    return thread;
  }

  @Post('threads/:threadId/analyze')
  async analyzeThread(
    @Param('businessId') businessId: string,
    @Param('threadId') threadId: string,
  ) {
    return this.keyInbox.analyzeThread(businessId, threadId);
  }

  @Get('brief')
  async getBrief(
    @Param('businessId') businessId: string,
    @Query('scope') scope: 'DAILY' | 'WEEKLY' | 'CUSTOM' = 'DAILY',
    @Query('start') start?: string,
    @Query('end') end?: string,
  ) {
    const insights = await this.keyInbox.listInsights(businessId, scope, 1);
    if (insights.length > 0) return insights[0];

    return this.keyInbox.generateBrief(
      businessId,
      scope,
      start ? new Date(start) : undefined,
      end ? new Date(end) : undefined,
    );
  }

  @Post('brief/generate')
  async generateBrief(
    @Param('businessId') businessId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const scope = (body.scope as 'DAILY' | 'WEEKLY' | 'CUSTOM') ?? 'DAILY';
    return this.keyInbox.generateBrief(
      businessId,
      scope,
      body.start ? new Date(String(body.start)) : undefined,
      body.end ? new Date(String(body.end)) : undefined,
    );
  }

  @Post('intelligence/generate')
  async generateIntelligence(
    @Param('businessId') businessId: string,
    @Body() body: GenerateKeyInboxIntelligenceDto,
    @Req() req: Request & { user?: { id?: string } },
  ) {
    return this.intelligence.generateReport(businessId, body, req.user?.id);
  }

  @Get('intelligence/latest')
  async getLatestIntelligence(
    @Param('businessId') businessId: string,
    @Query('scope') scope: IntelligenceScope = 'WEEKLY',
  ) {
    const report = await this.intelligence.getLatestReport(businessId, scope);
    if (!report) throw new NotFoundException('No intelligence report found for this scope');
    return report;
  }

  @Get('intelligence')
  async listIntelligence(
    @Param('businessId') businessId: string,
    @Query('scope') scope?: IntelligenceScope,
    @Query('limit') limit?: string,
  ) {
    return this.intelligence.listReports(businessId, scope, limit ? Number(limit) : undefined);
  }

  @Get('intelligence/:insightId')
  async getIntelligence(
    @Param('businessId') businessId: string,
    @Param('insightId') insightId: string,
  ) {
    const report = await this.intelligence.getReport(businessId, insightId);
    if (!report) throw new NotFoundException('Intelligence report not found');
    return report;
  }

  @Patch('threads/:threadId')
  async updateThread(
    @Param('businessId') businessId: string,
    @Param('threadId') threadId: string,
    @Body() body: UpdateThreadDto,
  ) {
    return this.keyInbox.updateThread(businessId, threadId, body);
  }

  @Post('threads/:threadId/reply')
  async reply(
    @Param('businessId') businessId: string,
    @Param('threadId') threadId: string,
    @Body() body: ReplyDto,
    @Req() req: Request & { user?: { id?: string } },
  ) {
    return this.keyInbox.addReply(
      businessId,
      threadId,
      body.contentText,
      body.attachments?.map((a) => ({ type: a.type, url: a.url })) ?? [],
      { mode: body.mode ?? 'draft', userId: req.user?.id },
    );
  }

  @Post('threads/:threadId/actions/:actionIndex/execute')
  async executeAction(
    @Param('businessId') businessId: string,
    @Param('threadId') threadId: string,
    @Param('actionIndex') actionIndex: string,
    @Body() body: ExecuteActionDto,
    @Req() req: Request & { user?: { id?: string } },
  ) {
    if (body.confirmed !== true) {
      throw new BadRequestException('Action must be confirmed before execution');
    }

    const thread = await this.keyInbox.getThread(businessId, threadId);
    if (!thread) throw new NotFoundException('Thread not found');

    const sourceMessageId = body.messageId;
    const message = sourceMessageId
      ? thread.messages.find((m) => m.id === sourceMessageId)
      : thread.messages[0];
    const actions = (message?.suggestedActions ?? []) as unknown as Array<{
      type: string;
      label: string;
      confidence: number;
      payload?: Record<string, unknown>;
    }>;
    const action = actions[Number(actionIndex)];

    if (!action) {
      throw new NotFoundException('Suggested action not found');
    }

    const userId = req.user?.id ?? 'user';

    await this.businessEvents.emit({
      businessId,
      eventType: 'key_inbox.action_confirmed',
      subjectType: 'KeyInboxThread',
      subjectId: threadId,
      actorType: 'human',
      actorId: userId,
      action: 'confirm_action',
      source: 'web',
      metadata: { actionType: action.type, messageId: message?.id },
    });

    const result = await this.actionExecutor.execute(
      businessId,
      threadId,
      { ...action, payload: action.payload ?? {} },
      {
        messageId: message?.id,
        userId,
        ...(body.payloadOverride ? { payloadOverride: body.payloadOverride } : {}),
      },
    );

    await this.businessEvents.emit({
      businessId,
      eventType: result.success ? 'key_inbox.action_executed' : 'key_inbox.action_failed',
      subjectType: 'KeyInboxThread',
      subjectId: threadId,
      actorType: 'human',
      actorId: userId,
      action: 'execute_action',
      source: 'web',
      metadata: { actionType: action.type, result },
    });

    return result;
  }

  @Get('threads/:threadId/timeline')
  async getTimeline(
    @Param('businessId') businessId: string,
    @Param('threadId') threadId: string,
  ) {
    const thread = await this.keyInbox.getThread(businessId, threadId);
    if (!thread) throw new NotFoundException('Thread not found');

    return this.businessEvents.getTimeline('KeyInboxThread', threadId);
  }

  @Post('ingest')
  async ingest(
    @Param('businessId') businessId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const threadInput = body.thread as CreateInboxThreadInput | undefined;
    const messageInput = body.message as CreateInboxMessageInput | undefined;

    if (!messageInput) {
      throw new ForbiddenException('message is required');
    }

    if (messageInput.businessId && messageInput.businessId !== businessId) {
      throw new ForbiddenException('businessId mismatch');
    }
    if (threadInput?.businessId && threadInput.businessId !== businessId) {
      throw new ForbiddenException('businessId mismatch');
    }

    let threadId: string | undefined;

    if (threadInput) {
      const thread = await this.keyInbox.upsertThread({
        ...threadInput,
        businessId,
        channel: normalizeKeyInboxChannel(threadInput.channel),
      });
      threadId = thread.id;
    }

    return this.keyInbox.addMessage({
      ...messageInput,
      businessId,
      threadId,
      channel: normalizeKeyInboxChannel(messageInput.channel),
    });
  }
}
