import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FlowService } from './flow.service';
import { ActivityService } from './activity.service';
import { CrossModuleAgentService } from './cross-module-agent.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { PrismaService } from '../../core/prisma/prisma.service';
import { FlowEngineService } from './flow-engine.service';
import { FlowRunnerService } from './flow-runner.service';
import { FlowTemplateService } from './flow-template.service';
import { CreateFlowDto, UpdateFlowDto, TestFlowDto } from './dto';

@Controller('api/flows')
export class FlowController {
  constructor(
    @Inject(FlowService) private readonly flowService: FlowService,
    @Inject(ActivityService) private readonly activityService: ActivityService,
    @Inject(CrossModuleAgentService) private readonly crossModuleAgent: CrossModuleAgentService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly engine: FlowEngineService,
    private readonly runner: FlowRunnerService,
    private readonly templates: FlowTemplateService,
  ) {}

  // ─── Health ───

  @Get('health')
  health() {
    return { status: 'ok', module: 'flow' };
  }

  // ─── Cockpit / Activity / Search (legacy) ───

  @Get('businesses/:businessId/cockpit')
  @UseGuards(AuthGuard, BusinessGuard)
  async getCockpitSummary(@Param('businessId') businessId: string) {
    return this.flowService.getCockpitSummary(businessId);
  }

  @Get('businesses/:businessId/activity')
  @UseGuards(AuthGuard, BusinessGuard)
  async getActivityFeed(
    @Param('businessId') businessId: string,
    @Query('module') module?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.activityService.listForBusiness(businessId, {
      module,
      limit: limit ? parseInt(limit, 10) : 30,
      cursor,
    });
  }

  @Get('businesses/:businessId/cross-module-workflows')
  @UseGuards(AuthGuard, BusinessGuard)
  async listCrossModuleWorkflows(@Param('businessId') businessId: string) {
    return this.crossModuleAgent.listWorkflows(businessId);
  }

  @Patch('businesses/:businessId/cross-module-workflows/:workflowKey')
  @UseGuards(AuthGuard, BusinessGuard)
  async updateCrossModuleWorkflow(
    @Param('businessId') businessId: string,
    @Param('workflowKey') workflowKey: string,
    @Body() body: { enabled?: boolean; config?: any },
  ) {
    return this.crossModuleAgent.updateWorkflow(businessId, workflowKey, body);
  }

  @Get('businesses/:businessId/search')
  @UseGuards(AuthGuard, BusinessGuard)
  async universalSearch(
    @Param('businessId') businessId: string,
    @Query('q') query: string,
  ) {
    if (!query || query.trim().length < 2) {
      return { contacts: [], invoices: [], bookings: [], products: [], projects: [] };
    }

    const q = query.trim();
    const containsFilter = { contains: q, mode: 'insensitive' as const };

    const [contacts, invoices, bookings, products, projects] = await Promise.all([
      this.prisma.client.contact.findMany({
        where: {
          businessId,
          deletedAt: null,
          OR: [
            { firstName: containsFilter },
            { lastName: containsFilter },
            { displayName: containsFilter },
            { email: containsFilter },
            { phone: containsFilter },
          ],
        },
        select: { id: true, firstName: true, lastName: true, displayName: true, email: true, status: true },
        take: 8,
      }),
      this.prisma.client.invoice.findMany({
        where: {
          businessId,
          deletedAt: null,
          OR: [
            { invoiceNumber: containsFilter },
            { contact: { OR: [{ firstName: containsFilter }, { lastName: containsFilter }, { email: containsFilter }] } },
          ],
        },
        select: { id: true, invoiceNumber: true, total: true, currency: true, status: true },
        take: 8,
      }),
      this.prisma.client.booking.findMany({
        where: {
          businessId,
          deletedAt: null,
          OR: [
            { contact: { OR: [{ firstName: containsFilter }, { lastName: containsFilter }] } },
            { service: { name: containsFilter } },
          ],
        },
        select: { id: true, startTime: true, status: true, service: { select: { name: true } }, contact: { select: { firstName: true, lastName: true } } },
        take: 8,
      }),
      this.prisma.client.product.findMany({
        where: {
          businessId,
          deletedAt: null,
          OR: [
            { name: containsFilter },
            { description: containsFilter },
          ],
        },
        select: { id: true, name: true, price: true, currency: true },
        take: 8,
      }),
      this.prisma.client.project.findMany({
        where: {
          businessId,
          deletedAt: null,
          OR: [
            { name: containsFilter },
            { description: containsFilter },
          ],
        },
        select: { id: true, name: true, status: true, priority: true },
        take: 8,
      }),
    ]);

    return { contacts, invoices, bookings, products, projects };
  }

  // ─── Automation Flow Studio ───

  @Get('businesses/:businessId/templates')
  @UseGuards(BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('automations', 'read')
  async listTemplates() {
    return this.templates.findMany();
  }

  @Post('businesses/:businessId/templates/:templateId/clone')
  @UseGuards(BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('automations', 'write')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async cloneTemplate(
    @Param('businessId') businessId: string,
    @Param('templateId') templateId: string,
    @Request() req: { user?: { sub?: string } },
  ) {
    const createdBy = req.user?.sub ?? 'system';
    return this.templates.createFromTemplate(businessId, templateId, createdBy);
  }

  @Get('businesses/:businessId/flows')
  @UseGuards(BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('automations', 'read')
  async listFlows(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.engine.findMany(businessId, {
      status,
      category,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Post('businesses/:businessId/flows')
  @UseGuards(BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('automations', 'write')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async createFlow(
    @Param('businessId') businessId: string,
    @Request() req: { user?: { sub?: string } },
    @Body() body: CreateFlowDto,
  ) {
    const createdBy = req.user?.sub ?? 'system';
    return this.engine.createFlow(businessId, createdBy, body);
  }

  @Get('businesses/:businessId/flows/:flowId')
  @UseGuards(BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('automations', 'read')
  async getFlow(
    @Param('businessId') businessId: string,
    @Param('flowId') flowId: string,
  ) {
    return this.engine.findOne(businessId, flowId);
  }

  @Get('businesses/:businessId/flows/:flowId/versions')
  @UseGuards(BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('automations', 'read')
  async getFlowVersions(
    @Param('businessId') businessId: string,
    @Param('flowId') flowId: string,
  ) {
    return this.engine.findVersions(businessId, flowId);
  }

  @Patch('businesses/:businessId/flows/:flowId')
  @UseGuards(BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('automations', 'write')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async updateFlow(
    @Param('businessId') businessId: string,
    @Param('flowId') flowId: string,
    @Body() body: UpdateFlowDto,
  ) {
    return this.engine.updateFlow(businessId, flowId, body);
  }

  @Post('businesses/:businessId/flows/:flowId/publish')
  @UseGuards(BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('automations', 'write')
  async publishFlow(
    @Param('businessId') businessId: string,
    @Param('flowId') flowId: string,
  ) {
    return this.engine.publishFlow(businessId, flowId);
  }

  @Post('businesses/:businessId/flows/:flowId/test')
  @UseGuards(BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('automations', 'write')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async testFlow(
    @Param('businessId') businessId: string,
    @Param('flowId') flowId: string,
    @Body() body: TestFlowDto,
  ) {
    return this.runner.runFlow(businessId, flowId, {
      ...(body.payload ?? {}),
      contactId: body.contactId ?? null,
      sourceEventId: body.sourceEventId ?? null,
    });
  }

  @Get('businesses/:businessId/flows/:flowId/runs')
  @UseGuards(BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('automations', 'read')
  async listRuns(
    @Param('businessId') businessId: string,
    @Param('flowId') flowId: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.runner.findRuns(businessId, flowId, {
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get('businesses/:businessId/flows/:flowId/runs/:runId/steps')
  @UseGuards(BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('automations', 'read')
  async getRunSteps(
    @Param('businessId') _businessId: string,
    @Param('flowId') _flowId: string,
    @Param('runId') runId: string,
  ) {
    return this.runner.findRunSteps(runId);
  }

  @Delete('businesses/:businessId/flows/:flowId')
  @UseGuards(BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('automations', 'write')
  async deleteFlow(
    @Param('businessId') businessId: string,
    @Param('flowId') flowId: string,
  ) {
    return this.engine.deleteFlow(businessId, flowId);
  }
}
