import { Body, Controller, Get, Inject, Param, Post, Patch, UseGuards, Logger } from '@nestjs/common';
import { AutomationService } from './automation.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PlanLimitGuard, RequirePlanLimit } from '../subscriptions/plan-limit.guard';
import { ActivityService } from '../flow/activity.service';
import OpenAI from 'openai';

@Controller('automation')
export class AutomationController {
  private readonly logger = new Logger(AutomationController.name);
  private readonly openai: OpenAI | null;

  constructor(
    @Inject(AutomationService) private readonly automation: AutomationService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {
    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    this.openai = apiKey ? new OpenAI({ apiKey, baseURL }) : null;
  }

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
    if (!this.openai) {
      return { success: false, error: 'AI service not configured' };
    }
    if (!body.prompt?.trim()) {
      return { success: false, error: 'Prompt is required' };
    }

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.3,
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
      });

      const content = completion.choices[0]?.message?.content?.trim();
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
}
