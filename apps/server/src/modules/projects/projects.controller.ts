import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ProjectsService } from './projects.service';
import { ProjectPlannerService } from './project-planner.service';
import { ProjectPlanExecutorService } from './project-plan-executor.service';
import { GeneratePlanDto, UpdatePlanEventDto, ReorderEventsDto, AnalyzeImpactDto } from './dto/generate-plan.dto';

/** The authenticated member a write acts for (AuthMiddleware attaches it; AuthGuard requires it). */
type ActorRequest = { user?: { id?: string } };

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
    @Req() req: ActorRequest,
  ) {
    // PR196-PROJECTS-SERVER: the assignment names the member (WPD-09).
    return this.projects.addTask(businessId, projectId, body, req?.user?.id ?? null);
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
      status?: string;
      position?: number;
    },
    @Req() req: ActorRequest,
  ) {
    return this.projects.updateTask(businessId, taskId, body, req?.user?.id ?? null);
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
    @Req() req: ActorRequest,
  ) {
    // PR196-PROJECTS-SERVER (WPD-08): updateTask's door, as the member.
    return this.projects.updateTaskStatus(businessId, taskId, body?.status, body?.position, req?.user?.id ?? null);
  }

  @Post('businesses/:businessId/projects/:projectId/tasks/reorder')
  reorderTasks(
    @Param('businessId') businessId: string,
    @Param('projectId') projectId: string,
    @Body() body: { updates: { taskId: string; status: string; position: number }[] },
    @Req() req: ActorRequest,
  ) {
    return this.projects.reorderTasks(businessId, projectId, body?.updates, req?.user?.id ?? null);
  }

  @Get('businesses/:businessId/projects/:projectId/budget')
  getProjectBudget(
    @Param('businessId') businessId: string,
    @Param('projectId') projectId: string,
    @Req() req: ActorRequest,
  ) {
    // W9-PROJECTS-SERVER (review SEC-W196-2; D-100's withholding rule): the costs are served to a
    // member who reads expenses, as the project's expense list is (GET .../expenses/by-project).
    return this.projects.getProjectBudget(projectId, businessId, { viewerUserId: req?.user?.id ?? null });
  }

  @Get('businesses/:businessId/projects/:projectId/timeline')
  getProjectTimeline(
    @Param('businessId') businessId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.projects.getProjectTimeline(projectId, businessId);
  }

  // Deliverables. These had no routes at all — the tab kept them in React
  // state, so typing one in and switching tabs lost it. Guarded by the same
  // controller-level AuthGuard/BusinessGuard as everything else here, and the
  // service re-proves the project belongs to the business on every call.
  @Get('businesses/:businessId/projects/:projectId/deliverables')
  listDeliverables(
    @Param('businessId') businessId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.projects.listDeliverables(projectId, businessId);
  }

  @Post('businesses/:businessId/projects/:projectId/deliverables')
  createDeliverable(
    @Param('businessId') businessId: string,
    @Param('projectId') projectId: string,
    @Body() body: { title: string; description?: string; url?: string; kind?: string; dueDate?: string },
  ) {
    return this.projects.createDeliverable(projectId, businessId, body);
  }

  @Patch('businesses/:businessId/projects/:projectId/deliverables/:deliverableId')
  updateDeliverable(
    @Param('businessId') businessId: string,
    @Param('projectId') projectId: string,
    @Param('deliverableId') deliverableId: string,
    @Body() body: { title?: string; description?: string; url?: string; kind?: string; status?: string; dueDate?: string | null },
  ) {
    return this.projects.updateDeliverable(deliverableId, projectId, businessId, body);
  }

  @Delete('businesses/:businessId/projects/:projectId/deliverables/:deliverableId')
  deleteDeliverable(
    @Param('businessId') businessId: string,
    @Param('projectId') projectId: string,
    @Param('deliverableId') deliverableId: string,
  ) {
    return this.projects.deleteDeliverable(deliverableId, projectId, businessId);
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
  async updatePlan(
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
    // 'approved' and 'materialized' are written only by the approve door (WPD-12, D-85).
    const { status, ...fields } = body ?? {};
    this.projects.assertPlanPatchStatus(status);
    // Review SEC-V88C-1: the status is written only while no approve holds the plan (else 409,
    // and nothing in the body is written); the other fields as before.
    if (status !== undefined) await this.projects.changePlanStatus(businessId, planId, status);
    return this.planner.updatePlan(businessId, planId, fields);
  }

  // PR196-PROJECTS-SERVER (WPD-12, D-85, D-46): OWNER/ADMIN or projects:write, a compare-and-set
  // so a plan is approved and materialized once (409 after), and the approver on the feed.
  @Post('businesses/:businessId/plans/:planId/approve')
  approvePlan(
    @Param('businessId') businessId: string,
    @Param('planId') planId: string,
    @Req() req: ActorRequest,
  ) {
    return this.projects.approvePlan(businessId, planId, req?.user?.id ?? null, () =>
      this.executor.materializePlan(businessId, planId),
    );
  }

  @Post('businesses/:businessId/plans/:planId/reject')
  rejectPlan(
    @Param('businessId') businessId: string,
    @Param('planId') planId: string,
  ) {
    // Review SEC-V88C-1: not while an approve holds the plan (409).
    return this.projects.changePlanStatus(businessId, planId, 'rejected');
  }

  // PR196-PROJECTS-SERVER (WPD-14, D-85, D-46): only a draft plan, by OWNER/ADMIN or
  // projects:write, with the actor on the feed.
  @Delete('businesses/:businessId/plans/:planId')
  deletePlan(
    @Param('businessId') businessId: string,
    @Param('planId') planId: string,
    @Req() req: ActorRequest,
  ) {
    return this.projects.deleteDraftPlan(businessId, planId, req?.user?.id ?? null);
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
    @Param('planId') planId: string,
    @Param('eventId') eventId: string,
    @Body() body: { evidence?: string },
    @Req() req: ActorRequest,
  ) {
    // Review SEC-V88C-3: the event's task completes through updateTask's door (the evidence gate,
    // project_task.completed, the member on the feed) before the event is marked completed.
    return this.projects.completePlanEvent(businessId, planId, eventId, req?.user?.id ?? null, () =>
      this.executor.completeOutAppEvent(businessId, eventId, body?.evidence),
    );
  }
}
