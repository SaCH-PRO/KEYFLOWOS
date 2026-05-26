import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TimelineService } from '../timeline/timeline.service';
import { EvidenceService } from '../evidence/evidence.service';
import { TaskAssignmentService } from '../task-assignments/task-assignment.service';

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(TimelineService) private readonly timeline: TimelineService,
    @Inject(EvidenceService) private readonly evidence: EvidenceService,
    @Inject(TaskAssignmentService) private readonly assignments: TaskAssignmentService,
  ) {}

  listProjects(businessId: string) {
    return this.prisma.client.project.findMany({
      where: { businessId, deletedAt: null },
      include: {
        tasks: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } },
        goal: { select: { id: true, title: true, category: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  getProject(businessId: string, projectId: string) {
    return this.prisma.client.project.findFirst({
      where: { id: projectId, businessId, deletedAt: null },
      include: {
        tasks: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } },
        goal: true,
      },
    });
  }

  async createProject(businessId: string, body: {
    name: string;
    description?: string;
    status?: string;
    priority?: string;
    color?: string;
    contactId?: string;
    invoiceId?: string;
    bookingId?: string;
    dueDate?: string;
    hourlyRate?: number;
    goalId?: string;
  }) {
    const project = await this.prisma.client.project.create({
      data: {
        businessId,
        name: body.name,
        description: body.description,
        status: body.status || 'ACTIVE',
        priority: body.priority || 'NORMAL',
        color: body.color,
        hourlyRate: body.hourlyRate,
        contactId: body.contactId,
        invoiceId: body.invoiceId,
        bookingId: body.bookingId,
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
        goalId: body.goalId,
      },
      include: { tasks: true, goal: true },
    });
    this.events.emit('project.created', { project, businessId });
    await this.timeline.recordEvent({
      businessId,
      module: 'PROJECT',
      action: 'created',
      entityType: 'project',
      entityId: project.id,
      title: `Project created: ${project.name}`,
      detail: project.description ?? undefined,
      contactId: project.contactId ?? undefined,
      data: { name: project.name, status: project.status },
      occurredAt: new Date(),
    });
    return project;
  }

  async updateProject(businessId: string, projectId: string, body: {
    name?: string;
    description?: string;
    status?: string;
    priority?: string;
    goalId?: string | null;
    color?: string;
    contactId?: string;
    invoiceId?: string;
    bookingId?: string;
    dueDate?: string | null;
    hourlyRate?: number | null;
  }) {
    const data: any = { ...body };
    if (body.dueDate !== undefined) {
      data.dueDate = body.dueDate ? new Date(body.dueDate) : null;
    }
    const project = await this.prisma.client.project.update({
      where: { id: projectId, businessId },
      data,
      include: { tasks: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } },
    });
    await this.timeline.recordEvent({
      businessId,
      module: 'PROJECT',
      action: 'updated',
      entityType: 'project',
      entityId: project.id,
      title: `Project updated: ${project.name}`,
      detail: project.description ?? undefined,
      contactId: project.contactId ?? undefined,
      data: { name: project.name, status: project.status },
      occurredAt: new Date(),
    });
    this.events.emit('project.updated', { project, businessId });
    if (project.status === 'COMPLETED') {
      this.events.emit('project.completed', { project, businessId });
    }
    return project;
  }

  async deleteProject(businessId: string, projectId: string) {
    const result = await this.prisma.client.project.update({
      where: { id: projectId, businessId },
      data: { deletedAt: new Date() },
    });
    this.events.emit('project.deleted', { businessId, projectId });
    await this.timeline.recordEvent({
      businessId,
      module: 'PROJECT',
      action: 'deleted',
      entityType: 'project',
      entityId: projectId,
      title: 'Project deleted',
      occurredAt: new Date(),
    });
    return result;
  }

  async addTask(businessId: string, projectId: string, body: {
    title: string;
    description?: string;
    priority?: string;
    dueDate?: string;
    assigneeId?: string;
    estimatedHours?: number;
    trackedHours?: number;
  }) {
    const maxSort = await this.prisma.client.projectTask.aggregate({
      where: { projectId, businessId, deletedAt: null },
      _max: { sortOrder: true },
    });

    const task = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.projectTask.create({
        data: {
          projectId,
          businessId,
          title: body.title,
          description: body.description,
          priority: body.priority || 'NORMAL',
          dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
          assigneeId: body.assigneeId,
          estimatedHours: body.estimatedHours,
          trackedHours: body.trackedHours ?? 0,
          sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
        },
      });

      // Phase 3: polymorphic task assignment (atomic)
      if (body.assigneeId) {
        let assignableType = 'User';
        const [user, staff] = await Promise.all([
          tx.user.findUnique({ where: { id: body.assigneeId }, select: { id: true } }),
          tx.staffMember.findUnique({ where: { id: body.assigneeId }, select: { id: true } }),
        ]);
        if (staff) assignableType = 'StaffMember';
        else if (user) assignableType = 'User';

        await tx.taskAssignment.create({
          data: {
            taskType: 'ProjectTask',
            taskId: created.id,
            assignableType,
            assignableId: body.assigneeId,
            assignedBy: 'system',
            reason: 'task_created',
          },
        });
      }

      return created;
    });

    this.events.emit('project_task.created', { task, businessId });
    return task;
  }

  async updateTask(businessId: string, taskId: string, body: {
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
  }) {
    const existing = await this.prisma.client.projectTask.findFirst({
      where: { id: taskId, businessId },
    });
    if (!existing) throw new NotFoundException('Task not found');

    // Phase 2: Check evidence requirement before marking complete
    if (body.isCompleted === true && !existing.isCompleted && existing.evidenceRequired) {
      const check = await this.evidence.checkTaskEvidence('ProjectTask', taskId);
      if (!check.hasEvidence && (!body.evidenceIds || body.evidenceIds.length === 0)) {
        throw new BadRequestException(
          `This task requires evidence before completion. Please submit proof (photo, file, note, etc.) and try again.`
        );
      }
    }

    const { evidenceIds, ...updateData } = body;
    const data: any = { ...updateData };
    if (body.dueDate !== undefined) {
      data.dueDate = body.dueDate ? new Date(body.dueDate) : null;
    }
    const task = await this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.projectTask.update({
        where: { id: taskId, businessId },
        data,
      });

      // Phase 3: update polymorphic assignment when assignee changes (atomic)
      if (body.assigneeId !== undefined && body.assigneeId !== existing.assigneeId) {
        if (body.assigneeId) {
          let assignableType = 'User';
          const [user, staff] = await Promise.all([
            tx.user.findUnique({ where: { id: body.assigneeId }, select: { id: true } }),
            tx.staffMember.findUnique({ where: { id: body.assigneeId }, select: { id: true } }),
          ]);
          if (staff) assignableType = 'StaffMember';
          else if (user) assignableType = 'User';

          await tx.taskAssignment.updateMany({
            where: { taskType: 'ProjectTask', taskId: updated.id, unassignedAt: null },
            data: { unassignedAt: new Date(), reason: 'reassigned' },
          });
          await tx.taskAssignment.create({
            data: {
              taskType: 'ProjectTask',
              taskId: updated.id,
              assignableType,
              assignableId: body.assigneeId,
              assignedBy: 'system',
              reason: 'task_updated',
            },
          });
        } else {
          await tx.taskAssignment.updateMany({
            where: { taskType: 'ProjectTask', taskId: updated.id, unassignedAt: null },
            data: { unassignedAt: new Date(), reason: 'unassigned_via_update' },
          });
        }
      }

      return updated;
    });

    this.events.emit('project_task.updated', { task, businessId });
    const prevDue = existing.dueDate?.getTime() ?? null;
    const newDue = task.dueDate?.getTime() ?? null;
    if (body.dueDate !== undefined && prevDue !== newDue) {
      this.events.emit('project_task.rescheduled', { task, businessId });
    }
    if (body.isCompleted === true && !existing.isCompleted) {
      this.events.emit('project_task.completed', { task, businessId, evidenceIds: body.evidenceIds ?? [] });
    }
    return task;
  }

  async updateTaskStatus(businessId: string, taskId: string, status: string, position?: number) {
    const task = await this.prisma.client.projectTask.findFirst({
      where: { id: taskId, businessId },
    });
    if (!task) throw new NotFoundException('Task not found');

    const data: Record<string, unknown> = { status };
    if (status === 'DONE') data.isCompleted = true;
    else if (task.isCompleted && status !== 'DONE') data.isCompleted = false;
    if (position !== undefined) data.position = position;

    return this.prisma.client.projectTask.update({ where: { id: taskId }, data });
  }

  async reorderTasks(businessId: string, projectId: string, updates: { taskId: string; status: string; position: number }[]) {
    const taskIds = updates.map(u => u.taskId);
    const tasks = await this.prisma.client.projectTask.findMany({
      where: { id: { in: taskIds }, projectId, businessId },
      select: { id: true },
    });
    if (tasks.length !== taskIds.length) {
      throw new BadRequestException('Some tasks do not belong to this project');
    }

    const results = [];
    for (const update of updates) {
      const data: Record<string, unknown> = { status: update.status, position: update.position };
      if (update.status === 'DONE') data.isCompleted = true;
      else data.isCompleted = false;
      const result = await this.prisma.client.projectTask.update({
        where: { id: update.taskId },
        data,
      });
      results.push(result);
    }
    return results;
  }

  async getProjectBudget(projectId: string, businessId: string) {
    const project = await this.prisma.client.project.findFirst({
      where: { id: projectId, businessId },
      include: {
        tasks: { where: { deletedAt: null } },
        timeEntries: { where: { billable: true, billed: false } },
        milestones: true,
      },
    });
    if (!project) throw new NotFoundException('Project not found');

    const expenses = await this.prisma.client.expense.findMany({
      where: { projectId, businessId, deletedAt: null },
    });

    const timeCost = project.timeEntries.reduce((sum, e) =>
      sum + ((e.durationMinutes ?? 0) / 60) * (e.hourlyRate ?? project.hourlyRate ?? 0), 0);
    const expenseCost = expenses.reduce((sum: number, e: { amount: number }) => sum + e.amount, 0);
    const totalCost = timeCost + expenseCost;
    const budgetAmount = project.budgetAmount ?? 0;
    const budgetHours = project.budgetHours ?? 0;
    const trackedHours = project.tasks.reduce((sum, t) => sum + (t.trackedHours ?? 0), 0);

    return {
      projectId: project.id,
      budgetAmount,
      budgetHours,
      totalCost,
      timeCost,
      expenseCost,
      trackedHours,
      remainingBudget: Math.max(0, budgetAmount - totalCost),
      percentUsed: budgetAmount > 0 ? Math.round((totalCost / budgetAmount) * 100) : 0,
      percentHoursUsed: budgetHours > 0 ? Math.round((trackedHours / budgetHours) * 100) : 0,
      status: budgetAmount > 0 && totalCost > budgetAmount ? 'OVER_BUDGET'
        : budgetAmount > 0 && totalCost > budgetAmount * 0.9 ? 'AT_RISK'
        : budgetAmount > 0 && totalCost > budgetAmount * 0.75 ? 'WARNING'
        : 'HEALTHY',
    };
  }

  async getProjectTimeline(projectId: string, businessId: string) {
    const project = await this.prisma.client.project.findFirst({
      where: { id: projectId, businessId },
      include: {
        tasks: {
          where: { deletedAt: null },
          orderBy: [{ status: 'asc' }, { position: 'asc' }],
        },
        milestones: { orderBy: { dueDate: 'asc' } },
      },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async createMilestone(projectId: string, businessId: string, data: {
    title: string;
    description?: string;
    amount?: number;
    dueDate?: string;
  }) {
    const project = await this.prisma.client.project.findFirst({
      where: { id: projectId, businessId },
    });
    if (!project) throw new NotFoundException('Project not found');

    return this.prisma.client.projectMilestone.create({
      data: {
        projectId,
        title: data.title,
        description: data.description,
        amount: data.amount,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
      },
    });
  }

  async updateMilestone(milestoneId: string, projectId: string, businessId: string, data: {
    title?: string;
    description?: string;
    amount?: number;
    dueDate?: string | null;
    completedAt?: string | null;
    invoiceId?: string | null;
  }) {
    const milestone = await this.prisma.client.projectMilestone.findFirst({
      where: { id: milestoneId, project: { id: projectId, businessId } },
    });
    if (!milestone) throw new NotFoundException('Milestone not found');

    return this.prisma.client.projectMilestone.update({
      where: { id: milestoneId },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.amount !== undefined && { amount: data.amount }),
        ...(data.dueDate !== undefined && { dueDate: data.dueDate ? new Date(data.dueDate) : null }),
        ...(data.completedAt !== undefined && { completedAt: data.completedAt ? new Date(data.completedAt) : null }),
        ...(data.invoiceId !== undefined && { invoiceId: data.invoiceId }),
      },
    });
  }

  async deleteMilestone(milestoneId: string, projectId: string, businessId: string) {
    const milestone = await this.prisma.client.projectMilestone.findFirst({
      where: { id: milestoneId, project: { id: projectId, businessId } },
    });
    if (!milestone) throw new NotFoundException('Milestone not found');
    await this.prisma.client.projectMilestone.delete({ where: { id: milestoneId } });
    return { deleted: true };
  }

  async deleteTask(businessId: string, taskId: string) {
    const result = await this.prisma.client.projectTask.update({
      where: { id: taskId, businessId },
      data: { deletedAt: new Date() },
    });
    this.events.emit('project_task.deleted', { businessId, taskId });
    return result;
  }

  listTemplates(businessId: string) {
    return this.prisma.client.projectTemplate.findMany({
      where: { businessId },
      include: { product: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });
  }

  createTemplate(businessId: string, body: { name: string; taskTitles: string[]; productId?: string }) {
    return this.prisma.client.projectTemplate.create({
      data: {
        businessId,
        name: body.name,
        taskTitles: body.taskTitles,
        productId: body.productId || undefined,
      },
    });
  }

  deleteTemplate(businessId: string, templateId: string) {
    return this.prisma.client.projectTemplate.delete({
      where: { id: templateId, businessId },
    });
  }

  async createFromTemplate(businessId: string, templateId: string, body: { name?: string; contactId?: string; invoiceId?: string; bookingId?: string }) {
    const template = await this.prisma.client.projectTemplate.findFirst({
      where: { id: templateId, businessId },
    });
    if (!template) throw new NotFoundException('Template not found');

    const taskTitles = Array.isArray(template.taskTitles) ? (template.taskTitles as string[]) : [];

    const project = await this.prisma.client.project.create({
      data: {
        businessId,
        name: body.name || template.name,
        status: 'ACTIVE',
        priority: 'NORMAL',
        contactId: body.contactId,
        invoiceId: body.invoiceId,
        bookingId: body.bookingId,
        tasks: {
          create: taskTitles.map((title, i) => ({
            businessId,
            title,
            sortOrder: i + 1,
          })),
        },
      },
      include: { tasks: true },
    });
    this.events.emit('project.created', { project, businessId });
    return project;
  }

  async updatePlanEvent(
    businessId: string,
    planId: string,
    eventId: string,
    body: {
      title?: string;
      description?: string;
      executionContext?: 'IN_APP' | 'OUT_APP';
      autoExecute?: boolean;
      estimatedHours?: number;
      estimatedStart?: string;
      estimatedEnd?: string;
      dependsOn?: string[];
      requiredRoles?: string[];
      estimatedCost?: number;
    },
  ) {
    const event = await this.prisma.client.projectPlanEvent.findFirst({
      where: { id: eventId, planId, plan: { businessId } },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    const data: any = { ...body };
    if (body.estimatedStart !== undefined) {
      data.estimatedStart = body.estimatedStart ? new Date(body.estimatedStart) : null;
    }
    if (body.estimatedEnd !== undefined) {
      data.estimatedEnd = body.estimatedEnd ? new Date(body.estimatedEnd) : null;
    }

    return this.prisma.client.projectPlanEvent.update({
      where: { id: eventId },
      data,
    });
  }
}
