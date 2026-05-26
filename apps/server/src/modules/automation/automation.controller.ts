import { Body, Controller, Get, Inject, Param, Post, Patch, UseGuards, Logger } from '@nestjs/common';
import { AutomationService } from './automation.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PlanLimitGuard, RequirePlanLimit } from '../subscriptions/plan-limit.guard';
import { ActivityService } from '../flow/activity.service';
import { AiUsageService } from '../ai/ai-usage.service';
import { AutomationExecutorService } from '../flow/automation-executor.service';

@Controller('automation')
export class AutomationController {
  private readonly logger = new Logger(AutomationController.name);
  constructor(
    @Inject(AutomationService) private readonly automation: AutomationService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ActivityService) private readonly activity: ActivityService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
    @Inject(AutomationExecutorService) private readonly executor: AutomationExecutorService,
  ) {}

  @Get('health')
  health() {
    return this.automation.health();
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/playbooks')
  async listPlaybooks(@Param('businessId') businessId: string) {
    const rows = await this.prisma.client.automation.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      triggerEvent: r.trigger,
      condition: r.condition ?? null,
      actions: r.actionData ?? [],
      enabled: r.enabled ?? true,
      lastRunAt: r.lastRunAt,
      runCount: r.runCount ?? 0,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  @UseGuards(AuthGuard, BusinessGuard, PlanLimitGuard)
  @RequirePlanLimit('automations')
  @Post('businesses/:businessId/playbooks')
  async createPlaybook(
    @Param('businessId') businessId: string,
    @Body() body: { name: string; triggerEvent?: string; trigger?: string; actions?: any; actionData?: any; condition?: string | null },
  ) {
    const row = await this.prisma.client.automation.create({
      data: {
        businessId,
        name: body.name,
        trigger: body.triggerEvent || body.trigger || '',
        actionData: body.actions || body.actionData || null,
        condition: body.condition || null,
      },
    });
    return {
      id: row.id,
      name: row.name,
      triggerEvent: row.trigger,
      condition: row.condition ?? null,
      actions: row.actionData ?? [],
      enabled: row.enabled ?? true,
      lastRunAt: row.lastRunAt,
      runCount: row.runCount ?? 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/playbooks/:playbookId')
  async updatePlaybook(
    @Param('businessId') businessId: string,
    @Param('playbookId') playbookId: string,
    @Body() body: { name?: string; triggerEvent?: string; trigger?: string; actions?: any; actionData?: any; condition?: string | null; enabled?: boolean },
  ) {
    const updateData: any = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.triggerEvent !== undefined || body.trigger !== undefined) updateData.trigger = body.triggerEvent || body.trigger;
    if (body.actions !== undefined || body.actionData !== undefined) updateData.actionData = body.actions || body.actionData;
    if (body.condition !== undefined) updateData.condition = body.condition;
    if (body.enabled !== undefined) updateData.enabled = body.enabled;

    const row = await this.prisma.client.automation.update({
      where: { id: playbookId, businessId },
      data: updateData,
    });
    return {
      id: row.id,
      name: row.name,
      triggerEvent: row.trigger,
      condition: row.condition ?? null,
      actions: row.actionData ?? [],
      enabled: row.enabled ?? true,
      lastRunAt: row.lastRunAt,
      runCount: row.runCount ?? 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/playbooks/:playbookId/test-run')
  async testRunPlaybook(
    @Param('businessId') businessId: string,
    @Param('playbookId') playbookId: string,
  ) {
    const playbook = await this.prisma.client.automation.findFirst({
      where: { id: playbookId, businessId, deletedAt: null },
    });
    if (!playbook) return { success: false, error: 'Playbook not found' };

    try {
      await this.activity.log({
        businessId,
        module: 'automation',
        entityType: playbook.trigger || 'manual',
        entityId: playbookId,
        action: 'executed',
        title: `Test run: ${playbook.name}`,
        detail: `Manual test execution triggered for playbook "${playbook.name}"`,
        tone: 'success',
      });

      await this.prisma.client.automation.update({
        where: { id: playbookId },
        data: {
          lastRunAt: new Date(),
          runCount: { increment: 1 },
        },
      });

      return { success: true, message: `Test run completed for "${playbook.name}"` };
    } catch (err: any) {
      this.logger.error(`Test run failed for playbook ${playbookId}`, err);
      await this.activity.log({
        businessId,
        module: 'automation',
        entityType: playbook.trigger || 'manual',
        entityId: playbookId,
        action: 'failed',
        title: `Test run failed: ${playbook.name}`,
        detail: err?.message || 'Unknown error during test run',
        tone: 'error',
      });
      return { success: false, error: err?.message || 'Test run failed' };
    }
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/ai/generate-flow')
  async aiGenerateFlow(
    @Param('businessId') businessId: string,
    @Body() body: { prompt: string },
  ) {
    if (!body.prompt?.trim()) {
      return { success: false, error: 'Prompt is required' };
    }

    try {
      const response = await this.aiUsage.trackAndComplete(
        businessId,
        undefined,
        'automation_generate',
        {
          messages: [
            {
              role: 'system',
              content: `You are an automation flow designer for KeyFlowOS, a Caribbean business platform.
Given a user's plain-English description, generate a structured automation flow configuration.

Available triggers: contact.created, contact.updated, contact.stage_changed, contact.inactive, contact.no_activity_30d, lead.scored, invoice.paid, invoice.sent, invoice.overdue, quote.sent, quote.accepted, quote.viewed, quote.not_accepted_xdays, payment.received, recurring.failed, booking.created, booking.confirmed, booking.completed, booking.cancelled, booking.scheduled, booking.reminder, campaign.sent, campaign.opened, campaign.not_opened_14d, post.published, form.submitted, subscriber.joined, segment.changed, staff.assignment_missing, schedule.daily, schedule.weekly, schedule.monthly

Available actions: send_email, send_email_campaign, send_whatsapp, send_sms, send_notification, notify_staff, add_tag, remove_tag, create_task, move_pipeline, create_invoice, schedule_followup, delay, request_review, enroll_campaign, update_contact, add_note, assign_staff, schedule_reengagement

Available conditions: contact.has_email, contact.has_phone, contact.is_active, contact.is_new, invoice.above_threshold, booking.is_first, time.business_hours

Return ONLY valid JSON in this exact format:
{
  "name": "Short descriptive name",
  "triggerEvent": "trigger.event",
  "actions": [{"type": "action_name", "config": {}}],
  "conditions": ["condition.name"],
  "reasoning": "Brief explanation of what this flow does and why"
}

Always pick the most relevant trigger. Include 1-3 actions in logical order. Add conditions only when the description implies filtering. For delay actions, include {"hours": "N"} in config.`,
            },
            {
              role: 'user',
              content: body.prompt,
            },
          ],
          maxTokens: 800,
          temperature: 0.3,
        },
      );

      const content = response.content?.trim() ?? '';
      if (!content) {
        return { success: false, error: 'AI returned empty response' };
      }

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { success: false, error: 'Could not parse AI response' };
      }

      const flow = JSON.parse(jsonMatch[0]);
      return {
        success: true,
        flow: {
          name: flow.name || 'AI-Generated Flow',
          triggerEvent: flow.triggerEvent || '',
          actions: Array.isArray(flow.actions) ? flow.actions : [],
          conditions: Array.isArray(flow.conditions) ? flow.conditions : [],
          reasoning: flow.reasoning || '',
        },
      };
    } catch (err: any) {
      this.logger.error('AI flow generation failed', err);
      return { success: false, error: err?.message || 'AI generation failed' };
    }
  }

  /* ---------- KEY Talk Pipeline ---------- */

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/key/interpret')
  async keyInterpretFlow(
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
        'key_flow_interpret',
        {
          messages: [
            {
              role: 'system',
              content: `You are KEY, the AI automation designer for KeyFlowOS, a Caribbean business platform.

The user is describing an automation they want in plain English. Your job is to:
1. Interpret what they REALLY want (read between the lines)
2. Recommend the best automation structure
3. Provide confidence score and alternatives

Available triggers: contact.created, contact.updated, contact.stage_changed, contact.inactive, invoice.paid, invoice.sent, invoice.overdue, quote.sent, quote.accepted, quote.viewed, payment.received, recurring.failed, booking.created, booking.confirmed, booking.completed, booking.cancelled, campaign.sent, campaign.opened, form.submitted, schedule.daily, schedule.weekly

Available actions: send_email, send_whatsapp, create_task, add_tag, update_status, send_email_campaign, delay, request_review, enroll_campaign, update_contact, add_note, assign_staff

Available conditions: contact.has_email, contact.has_phone, contact.is_active, contact.is_new, invoice.above_threshold, booking.is_first, time.business_hours

Return ONLY valid JSON in this exact format:
{
  "interpretation": "What the user wants in my own words",
  "recommendation": "Why this trigger/action combo is best",
  "confidence": 0.92,
  "proposedFlow": {
    "name": "Short descriptive name",
    "triggerEvent": "trigger.event",
    "actions": [{"type": "action_name", ...}],
    "condition": "condition.name"
  },
  "alternatives": [
    {"label": "Brief label", "triggerEvent": "...", "description": "Why this alternative"}
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
        proposedFlow: parsed.proposedFlow || null,
        alternatives: Array.isArray(parsed.alternatives) ? parsed.alternatives : [],
      };
    } catch (err: any) {
      this.logger.error('KEY flow interpretation failed', err);
      return { success: false, error: err?.message || 'Interpretation failed' };
    }
  }

  @UseGuards(AuthGuard, BusinessGuard, PlanLimitGuard)
  @RequirePlanLimit('automations')
  @Post('businesses/:businessId/key/build')
  async keyBuildFlow(
    @Param('businessId') businessId: string,
    @Body() body: { proposedFlow: any },
  ) {
    try {
      const flow = body.proposedFlow;
      const row = await this.prisma.client.automation.create({
        data: {
          businessId,
          name: flow.name || 'KEY Flow',
          trigger: flow.triggerEvent || flow.trigger || '',
          actionData: flow.actions || flow.actionData || null,
          condition: flow.condition || null,
        },
      });
      return {
        success: true,
        flowId: row.id,
        flow: {
          id: row.id,
          name: row.name,
          triggerEvent: row.trigger,
          condition: row.condition ?? null,
          actions: row.actionData ?? [],
          enabled: row.enabled ?? true,
        },
      };
    } catch (err: any) {
      this.logger.error('KEY flow build failed', err);
      return { success: false, error: err?.message || 'Build failed' };
    }
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/key/execute')
  async keyExecuteFlow(
    @Param('businessId') businessId: string,
    @Body() body: { flowId: string; testContext?: Record<string, any> },
  ) {
    try {
      const playbook = await this.prisma.client.automation.findFirst({
        where: { id: body.flowId, businessId, deletedAt: null },
      });
      if (!playbook) {
        return { success: false, error: 'Flow not found' };
      }

      const context = body.testContext || { contactId: 'test-contact', trigger: playbook.trigger };
      const result = await this.executor.runPlaybookTest(businessId, body.flowId, context);

      const recentActivity = await this.prisma.client.activity.findMany({
        where: { businessId, module: 'automation', createdAt: { gte: new Date(Date.now() - 60000) } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      return {
        success: result.success,
        executed: result.executed,
        actionsRun: result.actionsRun,
        error: result.error,
        proof: {
          activityLog: recentActivity,
          runCount: playbook.runCount + (result.executed ? 1 : 0),
        },
      };
    } catch (err: any) {
      this.logger.error('KEY flow execution failed', err);
      return { success: false, error: err?.message || 'Execution failed' };
    }
  }

  @UseGuards(AuthGuard, BusinessGuard, PlanLimitGuard)
  @RequirePlanLimit('automations')
  @Post('businesses/:businessId/key/talk')
  async keyTalkFlow(
    @Param('businessId') businessId: string,
    @Body() body: { intent: string; autoExecute?: boolean },
  ) {
    const interpretResult = await this.keyInterpretFlow(businessId, body);
    if (!interpretResult.success || !interpretResult.proposedFlow) {
      return interpretResult;
    }

    const buildResult = await this.keyBuildFlow(businessId, { proposedFlow: interpretResult.proposedFlow });
    if (!buildResult.success) {
      return { ...interpretResult, buildError: buildResult.error };
    }

    let executionResult = null;
    if (body.autoExecute && buildResult.flowId) {
      executionResult = await this.keyExecuteFlow(businessId, { flowId: buildResult.flowId });
    }

    return {
      success: true,
      interpretation: interpretResult.interpretation,
      recommendation: interpretResult.recommendation,
      confidence: interpretResult.confidence,
      flow: buildResult.flow,
      executionProof: executionResult,
    };
  }
}
