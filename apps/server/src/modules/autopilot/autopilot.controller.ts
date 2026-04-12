import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, Inject, Req } from '@nestjs/common';
import { AutopilotService } from './autopilot.service';
import { AutopilotAiService } from './autopilot-ai.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';

@Controller('autopilot/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class AutopilotController {
  constructor(
    @Inject(AutopilotService) private autopilotService: AutopilotService,
    @Inject(AutopilotAiService) private autopilotAiService: AutopilotAiService,
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
}
