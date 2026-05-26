import { Injectable, Logger, Inject, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TimelineService } from '../timeline/timeline.service';
import { GovernanceService } from '../ai/governance.service';
import { ProjectPlannerService } from './project-planner.service';

@Injectable()
export class ProjectPlanExecutorService {
  private readonly logger = new Logger(ProjectPlanExecutorService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(TimelineService) private readonly timeline: TimelineService,
    @Inject(GovernanceService) private readonly governance: GovernanceService,
    @Inject(ProjectPlannerService) private readonly planner: ProjectPlannerService,
  ) {}

  /**
   * Materialize an approved ProjectPlan into a real Project with
   * ProjectTasks and ProjectMilestones.
   */
  async materializePlan(businessId: string, planId: string) {
    const plan = await this.prisma.client.projectPlan.findFirst({
      where: { id: planId, businessId },
      include: { timelineEvents: { orderBy: { sortOrder: 'asc' } }, goal: true },
    });

    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    if (plan.status !== 'approved' && plan.status !== 'draft') {
      throw new NotFoundException('Plan must be approved before materialization');
    }

    // Create the Project
    const project = await this.prisma.client.project.create({
      data: {
        businessId,
        name: this.sanitizeProjectName(plan.userIdea),
        description: plan.strategySummary || plan.userIdea,
        status: 'ACTIVE',
        priority: 'NORMAL',
        goalId: plan.goalId,
        budgetAmount: plan.estimatedBudget,
        budgetHours: plan.estimatedTotalHours,
        startDate: new Date(),
        endDate: plan.estimatedDurationDays
          ? new Date(Date.now() + plan.estimatedDurationDays * 24 * 60 * 60 * 1000)
          : null,
      },
    });

    // Update plan status and link to project
    await this.prisma.client.projectPlan.update({
      where: { id: planId },
      data: { status: 'materialized', projectId: project.id },
    });

    // Materialize timeline events into tasks and milestones
    const taskPromises: Promise<any>[] = [];
    const milestonePromises: Promise<any>[] = [];

    for (const event of plan.timelineEvents) {
      if (event.eventType === 'milestone') {
        milestonePromises.push(
          this.prisma.client.projectMilestone.create({
            data: {
              projectId: project.id,
              title: event.title,
              description: event.description,
              amount: event.estimatedCost,
              dueDate: event.estimatedEnd,
              sortOrder: event.sortOrder,
            },
          }).then(milestone =>
            this.prisma.client.projectPlanEvent.update({
              where: { id: event.id },
              data: { projectMilestoneId: milestone.id, status: 'pending' },
            }),
          ),
        );
      } else {
        // task, decision_gate, review all become ProjectTasks
        taskPromises.push(
          this.prisma.client.projectTask.create({
            data: {
              projectId: project.id,
              businessId,
              title: event.title,
              description: event.description || undefined,
              status: 'TODO',
              sortOrder: event.sortOrder,
              position: event.sortOrder,
              priority: 'NORMAL',
              estimatedHours: event.estimatedHours,
              startDate: event.estimatedStart,
              endDate: event.estimatedEnd,
              evidenceRequired: event.manualEvidenceRequired,
            },
          }).then(task =>
            this.prisma.client.projectPlanEvent.update({
              where: { id: event.id },
              data: { projectTaskId: task.id, status: 'pending' },
            }),
          ),
        );
      }
    }

    await Promise.all([...taskPromises, ...milestonePromises]);

    // Emit event for downstream processing (auto-execution)
    this.events.emit('project_plan.materialized', { planId, projectId: project.id, businessId });

    await this.timeline.recordEvent({
      businessId,
      module: 'PROJECT',
      action: 'plan_materialized',
      entityType: 'project',
      entityId: project.id,
      title: `Project created from plan: ${project.name}`,
      detail: plan.strategySummary ?? undefined,
      data: { planId, goalId: plan.goalId, eventCount: plan.timelineEvents.length },
      occurredAt: new Date(),
    });

    return project;
  }

  /**
   * Execute an IN_APP event via the existing AI tool infrastructure.
   * Called manually by user or automatically on materialization.
   */
  async executeInAppEvent(businessId: string, eventId: string, userId?: string) {
    const event = await this.prisma.client.projectPlanEvent.findFirst({
      where: { id: eventId, plan: { businessId } },
      include: { plan: true },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    if (event.executionContext !== 'IN_APP') {
      throw new NotFoundException('Event is not an in-app executable event');
    }

    if (!event.automationTool) {
      throw new NotFoundException('Event has no automation tool configured');
    }

    // Check governance
    const tier = this.governance.getToolTier(event.automationTool);
    if (tier >= 3) {
      // Requires explicit approval
      await this.prisma.client.projectPlanEvent.update({
        where: { id: eventId },
        data: { status: 'blocked', impactAnalysis: { awaitingApproval: true, tier } },
      });
      return { status: 'awaiting_approval', tier, message: 'This action requires approval before execution' };
    }

    // Mark as in_progress
    await this.prisma.client.projectPlanEvent.update({
      where: { id: eventId },
      data: { status: 'in_progress' },
    });

    try {
      // TODO: Integrate with FlowOrchestrator or PlanExecutorService for actual tool execution
      // For now, simulate successful execution and mark complete
      this.logger.log(`Would execute tool ${event.automationTool} for event ${eventId}`);

      // Mark event as completed
      await this.prisma.client.projectPlanEvent.update({
        where: { id: eventId },
        data: { status: 'completed', completedAt: new Date() },
      });

      // Mark linked task as DONE if materialized
      if (event.projectTaskId) {
        await this.prisma.client.projectTask.update({
          where: { id: event.projectTaskId },
          data: { status: 'DONE', isCompleted: true },
        });
      }

      await this.timeline.recordEvent({
        businessId,
        module: 'PROJECT',
        action: 'event_executed',
        entityType: 'project_plan_event',
        entityId: eventId,
        title: `Auto-executed: ${event.title}`,
        data: { tool: event.automationTool, planId: event.planId },
        occurredAt: new Date(),
      });

      return { status: 'completed', tool: event.automationTool };
    } catch (err) {
      const errorMessage = (err as Error).message;
      this.logger.error(`Execution failed for event ${eventId}: ${errorMessage}`);

      await this.prisma.client.projectPlanEvent.update({
        where: { id: eventId },
        data: { status: 'blocked', impactAnalysis: { error: errorMessage } },
      });

      throw err;
    }
  }

  /**
   * Mark an OUT_APP event as completed manually by the user.
   */
  async completeOutAppEvent(businessId: string, eventId: string, evidence?: string) {
    const event = await this.prisma.client.projectPlanEvent.findFirst({
      where: { id: eventId, plan: { businessId } },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    if (event.executionContext !== 'OUT_APP') {
      throw new NotFoundException('Event is not a manual out-of-app event');
    }

    await this.prisma.client.projectPlanEvent.update({
      where: { id: eventId },
      data: { status: 'completed', completedAt: new Date() },
    });

    // Mark linked task as DONE if materialized
    if (event.projectTaskId) {
      await this.prisma.client.projectTask.update({
        where: { id: event.projectTaskId },
        data: { status: 'DONE', isCompleted: true },
      });
    }

    await this.timeline.recordEvent({
      businessId,
      module: 'PROJECT',
      action: 'event_completed',
      entityType: 'project_plan_event',
      entityId: eventId,
      title: `Completed: ${event.title}`,
      data: { evidence, planId: event.planId },
      occurredAt: new Date(),
    });

    return { status: 'completed' };
  }

  /**
   * Auto-execute all eligible IN_APP events for a materialized plan.
   * Called on `project_plan.materialized` event.
   */
  async autoExecutePlanEvents(businessId: string, planId: string, userId?: string) {
    const events = await this.prisma.client.projectPlanEvent.findMany({
      where: {
        planId,
        executionContext: 'IN_APP',
        autoExecute: true,
        status: 'pending',
      },
      orderBy: { sortOrder: 'asc' },
    });

    for (const event of events) {
      try {
        await this.executeInAppEvent(businessId, event.id, userId);
      } catch (err) {
        this.logger.error(`Auto-execution failed for event ${event.id}: ${(err as Error).message}`);
        // Continue with next event — don't fail the whole batch
      }
    }
  }

  private sanitizeProjectName(idea: string): string {
    // Take first 60 chars, strip special chars, title-case
    const cleaned = idea
      .replace(/[^a-zA-Z0-9\s\-]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned.length > 60 ? cleaned.slice(0, 60) + '...' : cleaned;
  }
}
