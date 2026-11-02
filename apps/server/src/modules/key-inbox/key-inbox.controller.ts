import { createHash } from 'crypto';
import {
  BadRequestException,
  Body,
  ConflictException,
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
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CanonicalModule, LEVEL_RANK, defaultScopesForRole, rankOf } from '../../core/authority/module-vocabulary';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
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

/**
 * V1-31b-KEY-ACTION-ROUTES-BIND. The module scope each stored suggestion type
 * needs to be executed, beyond the route's operations write: create_task,
 * schedule_followup and create_contact write CRM rows (contact tasks, a
 * contact); create_invoice and create_booking hand back a link to the revenue
 * and bookings screens. A type not listed is refused (deny by default).
 */
const KEY_INBOX_ACTION_SCOPES: Readonly<Record<string, { module: CanonicalModule; minLevel: 'read' | 'write' }>> = {
  create_task: { module: 'crm', minLevel: 'write' },
  schedule_followup: { module: 'crm', minLevel: 'write' },
  create_contact: { module: 'crm', minLevel: 'write' },
  escalate: { module: 'operations', minLevel: 'write' },
  draft_reply: { module: 'operations', minLevel: 'write' },
  create_invoice: { module: 'revenue', minLevel: 'write' },
  create_booking: { module: 'bookings', minLevel: 'write' },
  none: { module: 'operations', minLevel: 'write' },
  review: { module: 'operations', minLevel: 'write' },
};

/**
 * V1-31b. The payload fields of a stored suggestion the confirming member may
 * edit in the confirm dialog (apps/web key-inbox page): text they type, never
 * the action's type or target (thread, contact), which stay the stored ones.
 * Any other key is refused 400.
 */
const KEY_INBOX_EDITABLE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  create_task: ['title'],
  schedule_followup: ['title', 'dueDate'],
  draft_reply: ['draft', 'content'],
};
const KEY_INBOX_EDITABLE_MAX_LENGTH = 5000;
/** idempotency_keys row that claims one stored suggestion: `<prefix><messageId>:<index>`. */
const KEY_INBOX_ACTION_CLAIM_PREFIX = 'key-inbox-action:';

function editablePayloadOverride(actionType: string, override: Record<string, unknown> | undefined): Record<string, string> | undefined {
  if (override === undefined || override === null) return undefined;
  const editable = Object.prototype.hasOwnProperty.call(KEY_INBOX_EDITABLE_FIELDS, actionType) ? KEY_INBOX_EDITABLE_FIELDS[actionType] : [];
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(override)) {
    if (!editable.includes(key)) {
      throw new BadRequestException(`"${key}" cannot be changed on a ${actionType} suggestion; only the stored action is executed`);
    }
    if (typeof value !== 'string' || value.length > KEY_INBOX_EDITABLE_MAX_LENGTH) {
      throw new BadRequestException(`"${key}" must be text of at most ${KEY_INBOX_EDITABLE_MAX_LENGTH} characters`);
    }
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

@Controller('key-inbox/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
export class KeyInboxController {
  constructor(
    @Inject(KeyInboxService) private readonly keyInbox: KeyInboxService,
    @Inject(KeyInboxActionExecutorService) private readonly actionExecutor: KeyInboxActionExecutorService,
    @Inject(KeyInboxIntelligenceService) private readonly intelligence: KeyInboxIntelligenceService,
    @Inject(BusinessEventService) private readonly businessEvents: BusinessEventService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  /**
   * V1-31b: the member's scope on `module`, as ModuleScopeGuard computes it
   * (SUPER_ADMIN passes; else the membership's explicit scope map or its role
   * defaults). A non-member, or a level below `minLevel`, is 403.
   */
  private async requireModuleScope(
    businessId: string,
    user: { id?: string; role?: string },
    module: CanonicalModule,
    minLevel: 'read' | 'write',
  ): Promise<void> {
    if (user.role === 'SUPER_ADMIN') return;
    const membership = await this.prisma.client.membership.findUnique({
      where: { userId_businessId: { userId: user.id!, businessId } },
      select: { role: true, permissionScopes: true },
    });
    if (!membership) throw new ForbiddenException('Not a member of this business');
    const explicit = membership.permissionScopes;
    const scopes: Record<string, string> =
      explicit && typeof explicit === 'object' && !Array.isArray(explicit)
        ? (explicit as Record<string, string>)
        : defaultScopesForRole(membership.role);
    const level = scopes[module] || 'none';
    if (rankOf(level) < LEVEL_RANK[minLevel]) {
      throw new ForbiddenException(`Insufficient permissions: ${module} requires ${minLevel} access (you have ${level})`);
    }
  }

  @Get('threads')
  @RequireModuleScope('operations')
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
  @RequireModuleScope('operations')
  async getThread(
    @Param('businessId') businessId: string,
    @Param('threadId') threadId: string,
  ) {
    const thread = await this.keyInbox.getThread(businessId, threadId);
    if (!thread) throw new NotFoundException('Thread not found');
    return thread;
  }

  @Post('threads/:threadId/analyze')
  @RequireModuleScope('operations', 'write')
  async analyzeThread(
    @Param('businessId') businessId: string,
    @Param('threadId') threadId: string,
  ) {
    return this.keyInbox.analyzeThread(businessId, threadId);
  }

  @Get('brief')
  @RequireModuleScope('operations')
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
  @RequireModuleScope('operations', 'write')
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
  @RequireModuleScope('operations', 'write')
  async generateIntelligence(
    @Param('businessId') businessId: string,
    @Body() body: GenerateKeyInboxIntelligenceDto,
    @Req() req: Request & { user?: { id?: string } },
  ) {
    return this.intelligence.generateReport(businessId, body, req.user?.id);
  }

  @Get('intelligence/latest')
  @RequireModuleScope('operations')
  async getLatestIntelligence(
    @Param('businessId') businessId: string,
    @Query('scope') scope: IntelligenceScope = 'WEEKLY',
  ) {
    const report = await this.intelligence.getLatestReport(businessId, scope);
    if (!report) throw new NotFoundException('No intelligence report found for this scope');
    return report;
  }

  @Get('intelligence')
  @RequireModuleScope('operations')
  async listIntelligence(
    @Param('businessId') businessId: string,
    @Query('scope') scope?: IntelligenceScope,
    @Query('limit') limit?: string,
  ) {
    return this.intelligence.listReports(businessId, scope, limit ? Number(limit) : undefined);
  }

  @Get('intelligence/:insightId')
  @RequireModuleScope('operations')
  async getIntelligence(
    @Param('businessId') businessId: string,
    @Param('insightId') insightId: string,
  ) {
    const report = await this.intelligence.getReport(businessId, insightId);
    if (!report) throw new NotFoundException('Intelligence report not found');
    return report;
  }

  @Patch('threads/:threadId')
  @RequireModuleScope('operations', 'write')
  async updateThread(
    @Param('businessId') businessId: string,
    @Param('threadId') threadId: string,
    @Body() body: UpdateThreadDto,
  ) {
    return this.keyInbox.updateThread(businessId, threadId, body);
  }

  @Post('threads/:threadId/reply')
  @RequireModuleScope('operations', 'write')
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
  @RequireModuleScope('operations', 'write')
  async executeAction(
    @Param('businessId') businessId: string,
    @Param('threadId') threadId: string,
    @Param('actionIndex') actionIndex: string,
    @Body() body: ExecuteActionDto,
    @Req() req: Request & { user?: { id?: string } },
  ) {
    // V1-31b: the confirming member is the authenticated caller ('user' stood in for none).
    const userId = req?.user?.id;
    if (typeof userId !== 'string' || userId.length === 0) {
      throw new UnauthorizedException('Authenticated user required');
    }
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
    const index = /^\d+$/.test(actionIndex) ? Number(actionIndex) : -1;
    const action = message ? actions[index] : undefined;

    if (!message || !action || typeof action !== 'object') {
      throw new NotFoundException('Suggested action not found');
    }

    // V1-31b: the module the stored action writes to, deny by default.
    const requirement = Object.prototype.hasOwnProperty.call(KEY_INBOX_ACTION_SCOPES, action.type)
      ? KEY_INBOX_ACTION_SCOPES[action.type]
      : undefined;
    if (!requirement) {
      throw new BadRequestException(`Suggested action type "${String(action.type)}" is not executable`);
    }
    const payloadOverride = editablePayloadOverride(action.type, body.payloadOverride);
    await this.requireModuleScope(businessId, req.user!, requirement.module, requirement.minLevel);

    // V1-31b: one execution per stored suggestion. The claim row is created
    // before anything runs; the unique (business, key) makes a concurrent or
    // repeated confirmation 409. A run that wrote nothing (success false) gives
    // the claim back so the member can try again; one that threw keeps it.
    const claimKey = `${KEY_INBOX_ACTION_CLAIM_PREFIX}${message.id}:${index}`;
    try {
      await this.prisma.client.idempotencyKey.create({
        data: {
          businessId,
          idempotencyKey: claimKey,
          status: 'claimed',
          requestHash: createHash('sha256').update(JSON.stringify({ businessId, threadId, messageId: message.id, index, action })).digest('hex'),
          response: { kind: 'key_inbox_action', threadId, messageId: message.id, actionIndex: index, actionType: action.type, claimedBy: userId },
        },
      });
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === 'P2002') {
        throw new ConflictException('This suggested action was already executed');
      }
      throw err;
    }
    const settle = (data: { status: string; error?: string } | null) =>
      (data
        ? this.prisma.client.idempotencyKey.updateMany({ where: { businessId, idempotencyKey: claimKey }, data })
        : this.prisma.client.idempotencyKey.deleteMany({ where: { businessId, idempotencyKey: claimKey, status: 'claimed' } })
      ).catch(() => undefined);

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

    let result: Awaited<ReturnType<KeyInboxActionExecutorService['execute']>>;
    try {
      result = await this.actionExecutor.execute(
        businessId,
        threadId,
        { ...action, payload: action.payload ?? {} },
        {
          messageId: message.id,
          userId,
          ...(payloadOverride ? { payloadOverride } : {}),
        },
      );
    } catch (err: unknown) {
      await settle({ status: 'failed', error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
    await settle(result.success ? { status: 'completed' } : null);

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
  @RequireModuleScope('operations')
  async getTimeline(
    @Param('businessId') businessId: string,
    @Param('threadId') threadId: string,
  ) {
    const thread = await this.keyInbox.getThread(businessId, threadId);
    if (!thread) throw new NotFoundException('Thread not found');

    return this.businessEvents.getTimeline('KeyInboxThread', threadId);
  }

  @Post('ingest')
  @RequireModuleScope('operations', 'write')
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
