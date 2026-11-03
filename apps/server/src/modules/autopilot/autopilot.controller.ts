import { BadRequestException, Controller, Get, Post, Patch, Param, Body, Query, UseGuards, Inject, Req, Logger, GoneException, UnauthorizedException } from '@nestjs/common';
import { AutopilotService } from './autopilot.service';
import { AutopilotAiService } from './autopilot-ai.service';
import { DelegationLoopService } from './delegation-loop.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { AiUsageService } from '../ai/ai-usage.service';
import { PrismaService } from '../../core/prisma/prisma.service';

/** The authenticated member resolving an approval (V1-31b); 401 without one. */
function resolvingUserId(req: { user?: { id?: string } } | undefined): string {
  const userId = req?.user?.id;
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new UnauthorizedException('Authenticated user required');
  }
  return userId;
}

/*
 * V1-31b review SEC-V131b-3 / SEC-V131b-4: who may resolve an autopilot task. A
 * member's approve (COMPLETED) or deny (SKIPPED) is the human evidence
 * DelegationLoopService.adaptGovernanceFromHistory counts to raise the
 * business's maxAutoTier, so resolving one is an automations write
 * (RequireModuleScope('automations', 'write') under ModuleScopeGuard; STAFF
 * defaults to automations read). The status route needs the same scope: it
 * writes the same COMPLETED / SKIPPED rows.
 */

/**
 * Statuses only the autopilot itself records: AUTO_EXECUTED is the loop's own
 * execution (executedBy 'AI'), never a member's, and it skips the approval
 * check in AutopilotService.updateTaskStatus.
 */
const SYSTEM_ONLY_TASK_STATUSES: ReadonlySet<string> = new Set(['AUTO_EXECUTED']);

@Controller('autopilot/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
export class AutopilotController {
  private readonly logger = new Logger(AutopilotController.name);
  constructor(
    @Inject(AutopilotService) private autopilotService: AutopilotService,
    @Inject(AutopilotAiService) private autopilotAiService: AutopilotAiService,
    @Inject(DelegationLoopService) private delegationLoopService: DelegationLoopService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get('tasks/today')
  async getTodaysTasks(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string
  ) {
    return this.autopilotService.getTodaysTasks(businessId, limit ? parseInt(limit, 10) : 3);
  }

  @Get('tasks')
  async getAllTasks(
    @Param('businessId') businessId: string,
    @Query('status') status?: string
  ) {
    return this.autopilotService.getAllTasks(businessId, status);
  }

  @Post('tasks')
  async createTask(
    @Param('businessId') businessId: string,
    @Body() body: {
      title: string;
      description?: string;
      category: string;
      priority?: string;
      autoExecutable?: boolean;
      requiresApproval?: boolean;
      approvalData?: Record<string, unknown>;
      scheduledFor?: string;
      dueDate?: string;
      relatedType?: string;
      relatedId?: string;
    }
  ) {
    return this.autopilotService.createTask({
      businessId,
      title: body.title,
      description: body.description,
      category: body.category,
      priority: body.priority,
      autoExecutable: body.autoExecutable,
      requiresApproval: body.requiresApproval,
      approvalData: body.approvalData,
      scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : undefined,
      dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
      relatedType: body.relatedType,
      relatedId: body.relatedId,
    });
  }

  /**
   * V1-31b review SEC-V131b-4: the member who sets the status is the
   * authenticated caller (a body executedBy is not read), and AUTO_EXECUTED,
   * which skips the approval check, is refused: a member does not record the
   * autopilot's own execution.
   */
  @Patch('tasks/:taskId/status')
  @RequireModuleScope('automations', 'write')
  async updateTaskStatus(
    @Param('businessId') businessId: string,
    @Param('taskId') taskId: string,
    @Body() body: { status: string },
    @Req() req: { user?: { id?: string } },
  ) {
    const userId = resolvingUserId(req);
    const status = typeof body?.status === 'string' ? body.status : '';
    if (!status) throw new BadRequestException('status is required');
    if (SYSTEM_ONLY_TASK_STATUSES.has(status)) {
      throw new BadRequestException(`${status} is recorded only by the autopilot itself`);
    }
    return this.autopilotService.updateTaskStatus(taskId, businessId, status, userId);
  }

  /**
   * V1-31b-KEY-ACTION-ROUTES-BIND: the approver is the authenticated caller.
   * `approvedBy` came from the request body, so any member could record the
   * approval in anyone's name; a body value is no longer read. The approver
   * needs automations write (review SEC-V131b-3).
   */
  @Post('tasks/:taskId/approve')
  @RequireModuleScope('automations', 'write')
  async approveTask(
    @Param('businessId') businessId: string,
    @Param('taskId') taskId: string,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.autopilotService.approveTask(taskId, businessId, resolvingUserId(req));
  }

  @Post('tasks/:taskId/deny')
  @RequireModuleScope('automations', 'write')
  async denyTask(
    @Param('businessId') businessId: string,
    @Param('taskId') taskId: string,
    @Req() req: { user?: { id?: string } },
  ) {
    resolvingUserId(req);
    return this.autopilotService.denyTask(taskId, businessId);
  }

  @Post('tasks/generate-setup')
  async generateSetupTasks(
    @Param('businessId') businessId: string
  ) {
    return this.autopilotService.generateSetupTasks(businessId);
  }

  @Get('stats')
  async getTaskStats(
    @Param('businessId') businessId: string
  ) {
    return this.autopilotService.getTaskStats(businessId);
  }

  @Get('alerts')
  async getCriticalAlerts(
    @Param('businessId') businessId: string
  ) {
    return this.autopilotService.getCriticalAlerts(businessId);
  }

  @Post('actions/:actionId/draft')
  async generateDraft(
    @Param('businessId') businessId: string,
    @Param('actionId') actionId: string,
    @Body() body: {
      type: 'follow_up' | 'birthday' | 'payment_reminder' | 'check_in' | 'offer' | 'review_request' | 'referral_request' | 'thank_you' | 're_engage';
      contactId: string;
      contactName: string;
      description: string;
    }
  ) {
    return this.autopilotAiService.generateDraft(businessId, {
      id: actionId,
      type: body.type,
      contactId: body.contactId,
      contactName: body.contactName,
      description: body.description,
    });
  }

  /**
   * V1-31b-KEY-ACTION-ROUTES-BIND: refused (410). Every KEY "execute action"
   * route executes only a proposal the server holds, by id. These action ids
   * (auto_, pending_, overdue_inv_, checkin_, nudge_, postbooking_,
   * autowelcome_, stalenudge_) are computed on each read by
   * CrmActionsService and never stored, so there is nothing to bind: the
   * route took the contact, channel and message from the body and wrote a
   * "WhatsApp sent" / "email sent" / autopilot timeline row on that contact,
   * attributed to AI, for a message the server never sent. A member records a
   * message they sent themselves through the CRM timeline routes.
   */
  @Post('actions/:actionId/execute')
  async executeAction(): Promise<never> {
    throw new GoneException(
      'Autopilot suggestions are not stored, so they are not executed here. Record a message you sent yourself on the contact timeline.',
    );
  }

  @Get('settings')
  async getSettings(
    @Param('businessId') businessId: string
  ) {
    return this.autopilotService.getSettings(businessId);
  }

  @Patch('settings')
  async updateSettings(
    @Param('businessId') businessId: string,
    @Body() body: Record<string, unknown>
  ) {
    return this.autopilotService.updateSettings(businessId, body);
  }

  @Get('loops')
  async getLoops(@Param('businessId') businessId: string) {
    return this.delegationLoopService.getLoops(businessId);
  }

  @Patch('loops/:loopId')
  async updateLoop(
    @Param('businessId') businessId: string,
    @Param('loopId') loopId: string,
    @Body() body: { enabled?: boolean; config?: Record<string, unknown>; intervalMin?: number },
  ) {
    return this.delegationLoopService.updateLoop(businessId, loopId, body);
  }

  @Post('loops/:loopId/run')
  async runLoop(
    @Param('businessId') businessId: string,
    @Param('loopId') loopId: string,
  ) {
    return this.delegationLoopService.runLoop(businessId, loopId);
  }

  @Get('loops/:loopId/runs')
  async getLoopRuns(
    @Param('businessId') businessId: string,
    @Param('loopId') loopId: string,
    @Query('limit') limit?: string,
  ) {
    return this.delegationLoopService.getRunHistory(businessId, loopId, limit ? parseInt(limit, 10) : 20);
  }

  /* ---------- KEY Talk Pipeline for Autopilot Delegations ---------- */

  @Post('key/interpret')
  async keyInterpretDelegation(
    @Param('businessId') businessId: string,
    @Body() body: { intent: string },
  ) {
    if (!body.intent?.trim()) {
      return { success: false, error: 'Intent is required' };
    }
    try {
      const response = await this.aiUsage.trackAndComplete(
        businessId,
        undefined,
        'key_delegation_interpret',
        {
          messages: [
            {
              role: 'system',
              content: `You are KEY, the AI delegation designer for KeyFlowOS, a Caribbean business platform.

The user is describing an autopilot delegation they want in plain English. Your job is to:
1. Interpret what they REALLY want
2. Recommend the best delegation loop type and configuration
3. Provide confidence score and alternatives

Available delegation loop types:
- payment_recovery: Find overdue invoices and create escalating reminder tasks (config: graceDays, escalationDays)
- lead_reactivation: Find stale leads and create re-engagement tasks (config: staleDays)
- post_purchase: After a sale, create thank-you, review-request, and cross-sell tasks (config: thankYouDelayHours, reviewDelayDays, crossSellDelayDays)
- booking_prep: Before/after bookings, create reminder and follow-up tasks (config: reminderHours, followUpHours)
- weekly_hygiene: Weekly cleanup — stale drafts, overdue invoices, incomplete profiles (config: enabledChecks)

Return ONLY valid JSON in this exact format:
{
  "interpretation": "What the user wants",
  "recommendation": "Why this loop type is best",
  "confidence": 0.92,
  "recommendedLoopType": "payment_recovery",
  "proposedConfig": { "graceDays": 3, "escalationDays": [7, 14] },
  "alternatives": [
    {"label": "Brief label", "loopType": "...", "description": "Why this alternative"}
  ]
}`,
            },
            { role: 'user', content: body.intent },
          ],
          maxTokens: 1200,
          temperature: 0.3,
        },
      );
      const content = response.content?.trim() ?? '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { success: false, error: 'Could not parse AI interpretation' };
      }
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        success: true,
        interpretation: parsed.interpretation || '',
        recommendation: parsed.recommendation || '',
        confidence: parsed.confidence ?? 0,
        recommendedLoopType: parsed.recommendedLoopType || '',
        proposedConfig: parsed.proposedConfig || {},
        alternatives: Array.isArray(parsed.alternatives) ? parsed.alternatives : [],
      };
    } catch (err: any) {
      this.logger.error('KEY delegation interpretation failed', err);
      return { success: false, error: err?.message || 'Interpretation failed' };
    }
  }

  @Post('key/build')
  async keyBuildDelegation(
    @Param('businessId') businessId: string,
    @Body() body: { recommendedLoopType: string; proposedConfig?: Record<string, unknown>; enabled?: boolean },
  ) {
    try {
      const loop = await this.prisma.client.delegationLoop.findFirst({
        where: { businessId, loopType: body.recommendedLoopType },
      });
      if (!loop) {
        return { success: false, error: `Delegation loop type "${body.recommendedLoopType}" not found` };
      }

      const updated = await this.prisma.client.delegationLoop.update({
        where: { id: loop.id },
        data: {
          config: (body.proposedConfig as any) ?? loop.config,
          enabled: body.enabled ?? true,
        },
      });

      return {
        success: true,
        loopId: updated.id,
        loop: {
          id: updated.id,
          loopType: updated.loopType,
          name: updated.name,
          enabled: updated.enabled,
          config: updated.config,
          intervalMin: updated.intervalMin,
          riskTier: updated.riskTier,
        },
      };
    } catch (err: any) {
      this.logger.error('KEY delegation build failed', err);
      return { success: false, error: err?.message || 'Build failed' };
    }
  }

  @Post('key/execute')
  async keyExecuteDelegation(
    @Param('businessId') businessId: string,
    @Body() body: { loopId: string },
  ) {
    try {
      const result = await this.delegationLoopService.runLoop(businessId, body.loopId);

      const runHistory = await this.delegationLoopService.getRunHistory(businessId, body.loopId, 5);
      const recentTasks = await this.prisma.client.autopilotTask.findMany({
        where: { businessId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      return {
        success: true,
        result,
        proof: {
          runHistory,
          recentTasks,
        },
      };
    } catch (err: any) {
      this.logger.error('KEY delegation execution failed', err);
      return { success: false, error: err?.message || 'Execution failed' };
    }
  }

  @Post('key/talk')
  async keyTalkDelegation(
    @Param('businessId') businessId: string,
    @Body() body: { intent: string; autoExecute?: boolean },
  ) {
    const interpretResult = await this.keyInterpretDelegation(businessId, body);
    if (!interpretResult.success || !interpretResult.recommendedLoopType) {
      return interpretResult;
    }

    const buildResult = await this.keyBuildDelegation(businessId, {
      recommendedLoopType: interpretResult.recommendedLoopType,
      proposedConfig: interpretResult.proposedConfig,
      enabled: true,
    });
    if (!buildResult.success) {
      return { ...interpretResult, buildError: buildResult.error };
    }

    let executionResult = null;
    if (body.autoExecute && buildResult.loopId) {
      executionResult = await this.keyExecuteDelegation(businessId, { loopId: buildResult.loopId });
    }

    return {
      success: true,
      interpretation: interpretResult.interpretation,
      recommendation: interpretResult.recommendation,
      confidence: interpretResult.confidence,
      loop: buildResult.loop,
      executionProof: executionResult,
    };
  }
}
