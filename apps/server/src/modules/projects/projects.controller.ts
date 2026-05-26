import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ProjectsService } from './projects.service';
import { ProjectPlannerService } from './project-planner.service';
import { ProjectPlanExecutorService } from './project-plan-executor.service';
import { GeneratePlanDto, UpdatePlanEventDto, ReorderEventsDto, AnalyzeImpactDto } from './dto/generate-plan.dto';

@Controller('projects')
@UseGuards(AuthGuard, BusinessGuard)
export class ProjectsController {
  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(ProjectPlannerService) private readonly planner: ProjectPlannerService,
    @Inject(ProjectPlanExecutorService) private readonly executor: ProjectPlanExecutorService,
  ) {}

  // --- Existing Project Endpoints ---

  @Get('businesses/:businessId')
  listProjects(@Param('businessId') businessId: string) {
    return this.projects.listProjects(businessId);
  }

  @Get('businesses/:businessId/projects/:projectId')
  getProject(
    @Param('businessId') businessId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.projects.getProject(businessId, projectId);
  }

  @Post('businesses/:businessId')
  createProject(
    @Param('businessId') businessId: string,
    @Body() body: {
      name: string;
      description?: string;
      status?: string;
      priority?: string;
      color?: string;
      hourlyRate?: number;
      contactId?: string;
      invoiceId?: string;
      bookingId?: string;
      dueDate?: string;
      goalId?: string;
    },
  ) {
    return this.projects.createProject(businessId, body);
  }

  @Patch('businesses/:businessId/projects/:projectId')
  updateProject(
    @Param('businessId') businessId: string,
    @Param('projectId') projectId: string,
    @Body() body: {
      name?: string;
      description?: string;
      status?: string;
      priority?: string;
      color?: string;
      hourlyRate?: number | null;
      contactId?: string;
      invoiceId?: string;
      bookingId?: string;
      dueDate?: string | null;
      goalId?: string | null;
    },
  ) {
    return this.projects.updateProject(businessId, projectId, body);
  }

  @Delete('businesses/:businessId/projects/:projectId')
  deleteProject(
    @Param('businessId') businessId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.projects.deleteProject(businessId, projectId);
  }

  @Post('businesses/:businessId/projects/:projectId/tasks')
  addTask(
    @Param('businessId') businessId: string,
    @Param('projectId') projectId: string,
    @Body() body: {
      title: string;
      description?: string;
      priority?: string;
      dueDate?: string;
      assigneeId?: string;
      estimatedHours?: number;
      trackedHours?: number;
    },
  ) {
    return this.projects.addTask(businessId, projectId, body);
  }

  @Patch('businesses/:businessId/tasks/:taskId')
  updateTask(
    @Param('businessId') businessId: string,
    @Param('taskId') taskId: string,
    @Body() body: {
      title?: string;
      description?: string;
      isCompleted?: boolean;
      priority?: string;
      dueDate?: string | null;
      sortOrder?: number;
      assigneeId?: string | null;
      estimatedHours?: number | null;
      trackedHours?: number;
      evidenceIds?: string[];
    },
  ) {
    return this.projects.updateTask(businessId, taskId, body);
  }

  @Delete('businesses/:businessId/tasks/:taskId')
  deleteTask(
    @Param('businessId') businessId: string,
    @Param('taskId') taskId: string,
  ) {
    return this.projects.deleteTask(businessId, taskId);
  }

  @Patch('businesses/:businessId/tasks/:taskId/status')
  updateTaskStatus(
    @Param('businessId') businessId: string,
    @Param('taskId') taskId: string,
    @Body() body: { status: string; position?: number },
  ) {
    return this.projects.updateTaskStatus(businessId, taskId, body.status, body.position);
  }

  @Post('businesses/:businessId/projects/:projectId/tasks/reorder')
  reorderTasks(
    @Param('businessId') businessId: string,
    @Param('projectId') projectId: string,
    @Body() body: { updates: { taskId: string; status: string; position: number }[] },
  ) {
    return this.projects.reorderTasks(businessId, projectId, body.updates);
  }

  @Get('businesses/:businessId/projects/:projectId/budget')
  getProjectBudget(
    @Param('businessId') businessId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.projects.getProjectBudget(projectId, businessId);
  }

  @Get('businesses/:businessId/projects/:projectId/timeline')
  getProjectTimeline(
    @Param('businessId') businessId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.projects.getProjectTimeline(projectId, businessId);
  }

  @Post('businesses/:businessId/projects/:projectId/milestones')
  createMilestone(
    @Param('businessId') businessId: string,
    @Param('projectId') projectId: string,
    @Body() body: { title: string; description?: string; amount?: number; dueDate?: string },
  ) {
    return this.projects.createMilestone(projectId, businessId, body);
  }

  @Patch('businesses/:businessId/projects/:projectId/milestones/:milestoneId')
  updateMilestone(
    @Param('businessId') businessId: string,
    @Param('projectId') projectId: string,
    @Param('milestoneId') milestoneId: string,
    @Body() body: { title?: string; description?: string; amount?: number; dueDate?: string | null; completedAt?: string | null; invoiceId?: string | null },
  ) {
    return this.projects.updateMilestone(milestoneId, projectId, businessId, body);
  }

  @Delete('businesses/:businessId/projects/:projectId/milestones/:milestoneId')
  deleteMilestone(
    @Param('businessId') businessId: string,
    @Param('projectId') projectId: string,
    @Param('milestoneId') milestoneId: string,
  ) {
    return this.projects.deleteMilestone(milestoneId, projectId, businessId);
  }

  @Get('businesses/:businessId/templates')
  listTemplates(@Param('businessId') businessId: string) {
    return this.projects.listTemplates(businessId);
  }

  @Post('businesses/:businessId/templates')
  createTemplate(
    @Param('businessId') businessId: string,
    @Body() body: { name: string; taskTitles: string[]; productId?: string },
  ) {
    return this.projects.createTemplate(businessId, body);
  }

  @Delete('businesses/:businessId/templates/:templateId')
  deleteTemplate(
    @Param('businessId') businessId: string,
    @Param('templateId') templateId: string,
  ) {
    return this.projects.deleteTemplate(businessId, templateId);
  }

  @Post('businesses/:businessId/from-template/:templateId')
  createFromTemplate(
    @Param('businessId') businessId: string,
    @Param('templateId') templateId: string,
    @Body() body: { name?: string; contactId?: string; invoiceId?: string; bookingId?: string },
  ) {
    return this.projects.createFromTemplate(businessId, templateId, body);
  }

  // --- Smart Project Planner Endpoints ---

  @Post('businesses/:businessId/plans')
  async generatePlan(
    @Param('businessId') businessId: string,
    @Body() body: GeneratePlanDto,
  ) {
    return this.planner.generatePlan(businessId, body.userIdea, body.goalId, body.options);
  }

  @Get('businesses/:businessId/plans')
  listPlans(@Param('businessId') businessId: string) {
    return this.planner.listPlans(businessId);
  }

  @Get('businesses/:businessId/plans/:planId')
  getPlan(
    @Param('businessId') businessId: string,
    @Param('planId') planId: string,
  ) {
    return this.planner.getPlan(businessId, planId);
  }

  @Patch('businesses/:businessId/plans/:planId')
  updatePlan(
    @Param('businessId') businessId: string,
    @Param('planId') planId: string,
    @Body() body: {
      status?: string;
      strategySummary?: string;
      estimatedTotalHours?: number;
      estimatedBudget?: number;
      estimatedPeople?: number;
      estimatedDurationDays?: number;
      riskAnalysis?: Record<string, unknown>;
      swotAnalysis?: Record<string, unknown>;
    },
  ) {
    return this.planner.updatePlan(businessId, planId, body);
  }

  @Post('businesses/:businessId/plans/:planId/approve')
  async approvePlan(
    @Param('businessId') businessId: string,
    @Param('planId') planId: string,
  ) {
    await this.planner.updatePlan(businessId, planId, { status: 'approved' });
    return this.executor.materializePlan(businessId, planId);
  }

  @Post('businesses/:businessId/plans/:planId/reject')
  rejectPlan(
    @Param('businessId') businessId: string,
    @Param('planId') planId: string,
  ) {
    return this.planner.updatePlan(businessId, planId, { status: 'rejected' });
  }

  @Delete('businesses/:businessId/plans/:planId')
  deletePlan(
    @Param('businessId') businessId: string,
    @Param('planId') planId: string,
  ) {
    return this.planner.deletePlan(businessId, planId);
  }

  @Patch('businesses/:businessId/plans/:planId/events/:eventId')
  updatePlanEvent(
    @Param('businessId') businessId: string,
    @Param('planId') planId: string,
    @Param('eventId') eventId: string,
    @Body() body: UpdatePlanEventDto,
  ) {
    // Delegate to a generic update on the event
    return this.projects.updatePlanEvent(businessId, planId, eventId, body);
  }

  @Post('businesses/:businessId/plans/:planId/events/reorder')
  reorderEvents(
    @Param('businessId') businessId: string,
    @Param('planId') planId: string,
    @Body() body: ReorderEventsDto,
  ) {
    return this.planner.reorderEvents(businessId, planId, body.updates);
  }

  @Post('businesses/:businessId/plans/:planId/events/:eventId/analyze-impact')
  analyzeImpact(
    @Param('businessId') businessId: string,
    @Param('planId') planId: string,
    @Param('eventId') eventId: string,
    @Body() body: AnalyzeImpactDto,
  ) {
    return this.planner.analyzeRearrangement(businessId, planId, eventId, body.newSortOrder);
  }

  @Post('businesses/:businessId/plans/:planId/events/:eventId/execute')
  executeInAppEvent(
    @Param('businessId') businessId: string,
    @Param('eventId') eventId: string,
  ) {
    return this.executor.executeInAppEvent(businessId, eventId);
  }

  @Post('businesses/:businessId/plans/:planId/events/:eventId/complete')
  completeOutAppEvent(
    @Param('businessId') businessId: string,
    @Param('eventId') eventId: string,
    @Body() body: { evidence?: string },
  ) {
    return this.executor.completeOutAppEvent(businessId, eventId, body.evidence);
  }
}
