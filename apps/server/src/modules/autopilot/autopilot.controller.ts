import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, Inject, Req, Logger } from '@nestjs/common';
import { AutopilotService } from './autopilot.service';
import { AutopilotAiService } from './autopilot-ai.service';
import { DelegationLoopService } from './delegation-loop.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { AiUsageService } from '../ai/ai-usage.service';
import { PrismaService } from '../../core/prisma/prisma.service';

@Controller('autopilot/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
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

  @Patch('tasks/:taskId/status')
  async updateTaskStatus(
    @Param('businessId') businessId: string,
    @Param('taskId') taskId: string,
    @Body() body: { status: string; executedBy?: string }
  ) {
    return this.autopilotService.updateTaskStatus(taskId, businessId, body.status, body.executedBy);
  }

  @Post('tasks/:taskId/approve')
  async approveTask(
    @Param('businessId') businessId: string,
    @Param('taskId') taskId: string,
    @Body() body: { approvedBy: string }
  ) {
    return this.autopilotService.approveTask(taskId, businessId, body.approvedBy);
  }

  @Post('tasks/:taskId/deny')
  async denyTask(
    @Param('businessId') businessId: string,
    @Param('taskId') taskId: string
  ) {
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

  @Post('actions/:actionId/execute')
  async executeAction(
    @Param('businessId') businessId: string,
    @Param('actionId') actionId: string,
    @Body() body: {
      contactId: string;
      channel: string;
      message: string;
    }
  ) {
    return this.autopilotService.executeAction(
      businessId,
      actionId,
      body.contactId,
      body.channel,
      body.message,
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
