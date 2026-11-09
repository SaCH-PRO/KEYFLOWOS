import { Inject, Injectable, NotFoundException, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { isSystemActor } from '../../core/auth/system-actor';
import { LEVEL_RANK, defaultScopesForRole, rankOf } from '../../core/authority/module-vocabulary';
import { TimelineService } from '../timeline/timeline.service';
import { EvidenceService } from '../evidence/evidence.service';
import { TaskAssignmentService } from '../task-assignments/task-assignment.service';

/** ProjectTaskStatus in schema.prisma: the Kanban columns. DONE is the completed column. */
const PROJECT_TASK_STATUSES: readonly string[] = ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE', 'BLOCKED'];

function assertTaskStatus(status: unknown): asserts status is string {
  if (typeof status !== 'string' || !PROJECT_TASK_STATUSES.includes(status)) {
    throw new BadRequestException(`status must be one of ${PROJECT_TASK_STATUSES.join(', ')}`);
  }
}

function assertPosition(position: unknown): void {
  if (position !== undefined && !Number.isInteger(position)) {
    throw new BadRequestException('position must be an integer');
  }
}

/** What PATCH .../tasks/:taskId (and the status, reorder and plan-event doors through it) may change on a task. */
type TaskUpdateBody = {
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
  /** The Kanban column. When given it decides completion: DONE completes, any other reopens. */
  status?: string;
  position?: number;
};

/** Who besides a member holding projects:write approves or deletes a project plan (D-85). */
const PLAN_GOVERNOR_ROLES: ReadonlySet<string> = new Set(['OWNER', 'ADMIN']);

/** The plan states only the approve door writes (WPD-12): PATCH may not set them. */
const PLAN_STATUSES_SET_BY_APPROVAL: readonly string[] = ['approved', 'materialized'];

/** The Activity actor type of a write's actor: a member, KEY, or no one (an internal caller). */
function feedActorType(actorId: string | null | undefined): 'USER' | 'AI' | 'SYSTEM' {
  if (!actorId) return 'SYSTEM';
  return isSystemActor(actorId) ? 'AI' : 'USER';
}

/**
 * The goal a project names, only when it is `businessId`'s (V1-21c review ST-2). The goal include
 * is to-one, which Prisma cannot filter by business, and a goalId written before createProject and
 * updateProject looked the goal up may name another business's goal.
 */
function goalOfBusiness<G extends { businessId: string }>(businessId: string, goal: G | null): G | null {
  return goal && goal.businessId === businessId ? goal : null;
}

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(TimelineService) private readonly timeline: TimelineService,
    @Inject(EvidenceService) private readonly evidence: EvidenceService,
    @Inject(TaskAssignmentService) private readonly assignments: TaskAssignmentService,
  ) {}

  // V1-21c: a relation include does not filter by business, so each task include names this
  // business. A task another business filed on this project before TD9-1 (addTask, below) was
  // read back as one of this project's tasks. The goal include is to-one, which Prisma cannot
  // filter: goalOfBusiness drops a goal that is not this business's (review ST-2).
  async listProjects(businessId: string) {
    const projects = await this.prisma.client.project.findMany({
      where: { businessId, deletedAt: null },
      include: {
        tasks: { where: { businessId, deletedAt: null }, orderBy: { sortOrder: 'asc' } },
        goal: { select: { id: true, title: true, category: true, businessId: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return projects.map((project) => {
      const goal = goalOfBusiness(businessId, project.goal);
      return { ...project, goal: goal && { id: goal.id, title: goal.title, category: goal.category } };
    });
  }

  async getProject(businessId: string, projectId: string) {
    const project = await this.prisma.client.project.findFirst({
      where: { id: projectId, businessId, deletedAt: null },
      include: {
        tasks: { where: { businessId, deletedAt: null }, orderBy: { sortOrder: 'asc' } },
        milestones: { orderBy: { dueDate: 'asc' } },
        goal: true,
      },
    });
    return project && { ...project, goal: goalOfBusiness(businessId, project.goal) };
  }

  /**
   * A goal a project is linked to must be this business's (V1-21c review ST-2). goalId was written
   * as the body gave it (the controller's body is an inline type, which ValidationPipe does not
   * strip), and the project then read the goal back through its to-one include: another
   * business's goal, its title, category, target and actions. null unlinks; undefined leaves it.
   */
  private async assertGoalOfBusiness(businessId: string, goalId: string | null | undefined) {
    if (goalId === undefined || goalId === null) return;
    const goal = await this.prisma.client.businessGoal.findFirst({ where: { id: goalId, businessId }, select: { id: true } });
    if (!goal) throw new NotFoundException('Goal not found');
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
    await this.assertGoalOfBusiness(businessId, body.goalId);
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
    await this.assertGoalOfBusiness(businessId, body.goalId);
    const data: any = { ...body };
    if (body.dueDate !== undefined) {
      data.dueDate = body.dueDate ? new Date(body.dueDate) : null;
    }
    const project = await this.prisma.client.project.update({
      where: { id: projectId, businessId },
      data,
      include: { tasks: { where: { businessId, deletedAt: null }, orderBy: { sortOrder: 'asc' } } },
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

  /**
   * The TaskAssignment type of `assigneeId` when it may be assigned a task of `businessId`
   * (PR196-PROJECTS-SERVER, WPD-09, D-87): one of the business's booking staff (a StaffMember of
   * the business, not removed) or a member of the business (a Membership in it). Anything else is
   * 404 and the caller writes nothing. addTask and updateTask resolved the id with findUnique and no
   * business, defaulted an unknown id to 'User' and wrote it, so another business's staff member or
   * user, or any string, became the assignee.
   *
   * One exception keeps KEY's projects_create_task working (it files the task to itself,
   * KEY_SYSTEM_ACTOR_ID): KEY is accepted as the assignee only on a path no person drives (no
   * actor, or KEY as the actor). Over HTTP the actor is always the member, so a member naming
   * KEY is refused like any other id.
   */
  private async assignableTypeInBusiness(
    businessId: string,
    assigneeId: unknown,
    actorId: string | null | undefined,
  ): Promise<'StaffMember' | 'User' | 'KEY'> {
    if (typeof assigneeId !== 'string' || !assigneeId) {
      throw new BadRequestException('assigneeId must be a non-empty string');
    }
    if (isSystemActor(assigneeId) && (!actorId || isSystemActor(actorId))) return 'KEY';
    const [staff, member] = await Promise.all([
      this.prisma.client.staffMember.findFirst({ where: { id: assigneeId, businessId, deletedAt: null }, select: { id: true } }),
      this.prisma.client.membership.findUnique({
        where: { userId_businessId: { userId: assigneeId, businessId } },
        select: { userId: true },
      }),
    ]);
    if (staff) return 'StaffMember';
    if (member) return 'User';
    throw new NotFoundException('Assignee not found');
  }

  /**
   * The evidence gate on completing a task (Phase 2), and the evidence ids the completion names.
   * Review SEC-V88C-2 (PR196-PROJECTS-SERVER): any non-empty evidenceIds passed the gate unchecked,
   * so `evidenceIds: ['anything']` completed a task that requires evidence with none, and
   * project_task.completed carried the made-up ids; the stored-evidence check did not name the
   * business either. Now a task that requires evidence needs evidence filed on it in this business,
   * and every id a completion names must be one of those rows. Anything else is 400 before anything
   * is written. Returns the ids project_task.completed carries.
   */
  private async resolveCompletionEvidence(
    businessId: string,
    taskId: string,
    evidenceRequired: boolean,
    evidenceIds?: unknown,
  ): Promise<string[]> {
    if (evidenceIds !== undefined && evidenceIds !== null
      && (!Array.isArray(evidenceIds) || evidenceIds.some((id) => typeof id !== 'string'))) {
      throw new BadRequestException('evidenceIds must be an array of evidence ids');
    }
    const named = (evidenceIds ?? []) as string[];
    if (!evidenceRequired && named.length === 0) return [];
    const filed = new Set((await this.evidence.getForObject('ProjectTask', taskId, businessId)).map((e) => e.id));
    if (named.some((id) => !filed.has(id))) {
      throw new BadRequestException('evidenceIds must name evidence filed on this task');
    }
    if (evidenceRequired && filed.size === 0) {
      throw new BadRequestException(
        `This task requires evidence before completion. Please submit proof (photo, file, note, etc.) and try again.`
      );
    }
    return named;
  }

  async addTask(businessId: string, projectId: string, body: {
    title: string;
    description?: string;
    priority?: string;
    dueDate?: string;
    assigneeId?: string;
    estimatedHours?: number;
    trackedHours?: number;
  }, actorId?: string | null) {
    // V1-21b review 9 TD9-1: the task is the project's, so the project must be this business's.
    // The row was written as { businessId, projectId } with the project never looked up, and
    // relation includes do not filter by business, so another business saw the task in its
    // project and KEY's projects_list_tasks read that project's name back. On the staff bridge no
    // tenant context binds anything; over HTTP the tenant extension binds wheres, not a foreign key.
    const project = await this.prisma.client.project.findFirst({
      where: { id: projectId, businessId, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    // D-87: checked before anything is written.
    const assignableType = body.assigneeId ? await this.assignableTypeInBusiness(businessId, body.assigneeId, actorId) : null;

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

      // Phase 3: polymorphic task assignment (atomic), naming the member who made it (WPD-09)
      if (body.assigneeId && assignableType) {
        await tx.taskAssignment.create({
          data: {
            taskType: 'ProjectTask',
            taskId: created.id,
            assignableType,
            assignableId: body.assigneeId,
            assignedBy: actorId ?? 'system',
            reason: 'task_created',
          },
        });
      }

      return created;
    });

    this.events.emit('project_task.created', { task, businessId, actorId: actorId ?? undefined });
    return task;
  }

  async updateTask(businessId: string, taskId: string, body: TaskUpdateBody, actorId?: string | null) {
    // Review CR-2: a write of status or completion is conditional on the row it was decided from.
    // A request that loses that race (a double click, a second tab) decides again from the row as
    // the winner left it, so it neither completes the task a second time nor records a move that
    // did not happen.
    const task = (await this.applyTaskUpdate(businessId, taskId, body, actorId))
      ?? (await this.applyTaskUpdate(businessId, taskId, body, actorId));
    if (!task) throw new ConflictException('The task changed while it was being updated; try again');
    return task;
  }

  /**
   * One attempt of updateTask. Returns null, having written nothing, when the task's status or
   * completion changed between the read this attempt decided from and its write.
   */
  private async applyTaskUpdate(businessId: string, taskId: string, body: TaskUpdateBody, actorId?: string | null) {
    const existing = await this.prisma.client.projectTask.findFirst({
      where: { id: taskId, businessId },
    });
    if (!existing) throw new NotFoundException('Task not found');

    // PR196-PROJECTS-SERVER (WPD-08): a status change comes through this door, so completion by
    // column is gated, evented and attributed exactly like completion by the checkbox.
    let isCompleted = body.isCompleted;
    if (body.status !== undefined) {
      assertTaskStatus(body.status);
      isCompleted = body.status === 'DONE' ? true : existing.isCompleted ? false : undefined;
    }
    assertPosition(body.position);

    // WPD-09 / D-87: a new assignee is this business's member or booking staff, checked before
    // anything is written.
    const assigneeChanges = body.assigneeId !== undefined && body.assigneeId !== existing.assigneeId;
    const assignableType = assigneeChanges && body.assigneeId
      ? await this.assignableTypeInBusiness(businessId, body.assigneeId, actorId)
      : null;

    // Phase 2: the evidence gate before marking complete (SEC-V88C-2: the ids are resolved)
    const becameCompleted = isCompleted === true && !existing.isCompleted;
    const evidenceIds = becameCompleted
      ? await this.resolveCompletionEvidence(businessId, taskId, existing.evidenceRequired, body.evidenceIds)
      : [];

    // Named fields only. The controller's body is an inline type, which ValidationPipe does not
    // strip, and spreading it wrote any key it carried: {businessId} or {projectId} moved the task
    // to another business or project.
    const data: Record<string, unknown> = {
      ...(body.title !== undefined && { title: body.title }),
      ...(body.description !== undefined && { description: body.description }),
      ...(isCompleted !== undefined && { isCompleted }),
      ...(body.priority !== undefined && { priority: body.priority }),
      ...(body.dueDate !== undefined && { dueDate: body.dueDate ? new Date(body.dueDate) : null }),
      ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
      ...(body.assigneeId !== undefined && { assigneeId: body.assigneeId }),
      ...(body.estimatedHours !== undefined && { estimatedHours: body.estimatedHours }),
      ...(body.trackedHours !== undefined && { trackedHours: body.trackedHours }),
      ...(body.status !== undefined && { status: body.status }),
      ...(body.position !== undefined && { position: body.position }),
    };
    // CR-2: the status and completion this write decides from are the ones it writes over.
    const writesState = 'status' in data || 'isCompleted' in data;
    const task = await this.prisma.client.$transaction(async (tx) => {
      let updated;
      if (writesState) {
        const won = await tx.projectTask.updateMany({
          where: { id: taskId, businessId, status: existing.status, isCompleted: existing.isCompleted },
          data: data as Prisma.ProjectTaskUncheckedUpdateManyInput,
        });
        if (won.count !== 1) return null;
        updated = await tx.projectTask.findFirstOrThrow({ where: { id: taskId, businessId } });
      } else {
        updated = await tx.projectTask.update({
          where: { id: taskId, businessId },
          data: data as Prisma.ProjectTaskUncheckedUpdateInput,
        });
      }

      // Phase 3: update polymorphic assignment when assignee changes (atomic), naming the member
      // who made it (WPD-09)
      if (assigneeChanges) {
        if (body.assigneeId && assignableType) {
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
              assignedBy: actorId ?? 'system',
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
    if (!task) return null;

    const actor = actorId ?? undefined;
    this.events.emit('project_task.updated', { task, businessId, actorId: actor });
    const prevDue = existing.dueDate?.getTime() ?? null;
    const newDue = task.dueDate?.getTime() ?? null;
    if (body.dueDate !== undefined && prevDue !== newDue) {
      this.events.emit('project_task.rescheduled', { task, businessId, actorId: actor });
    }
    if (becameCompleted) {
      this.events.emit('project_task.completed', { task, businessId, evidenceIds, actorId: actor });
    }
    // WPD-08: the feed names who completed, reopened or moved the task.
    if (writesState && (task.status !== existing.status || task.isCompleted !== existing.isCompleted)) {
      await this.timeline.recordEvent({
        businessId,
        module: 'PROJECT',
        action: becameCompleted ? 'task_completed' : 'task_status_changed',
        entityType: 'project_task',
        entityId: task.id,
        title: becameCompleted ? `Task completed: ${task.title}` : `Task moved to ${task.status}: ${task.title}`,
        data: { projectId: task.projectId, from: existing.status, to: task.status, isCompleted: task.isCompleted },
        actorType: feedActorType(actorId),
        actorId: actor,
        occurredAt: new Date(),
      });
    }
    return task;
  }

  /**
   * PR196-PROJECTS-SERVER (WPD-08): the Kanban status route. It wrote status and isCompleted
   * directly, so a task was completed with no evidence gate, no project_task.completed (the
   * calendar projection and the default trigger listen for it) and no actor. It is now
   * updateTask's door with the column as the change.
   */
  async updateTaskStatus(businessId: string, taskId: string, status: string, position?: number, actorId?: string | null) {
    assertTaskStatus(status);
    return this.updateTask(businessId, taskId, { status, position }, actorId);
  }

  /**
   * The bulk Kanban move. A status change in the batch goes through updateTask's door (WPD-08); a
   * move within a column only repositions. The whole batch is checked first (ownership, statuses,
   * positions, the evidence gate of every task it would complete), so a refused batch writes none
   * of its moves.
   */
  async reorderTasks(
    businessId: string,
    projectId: string,
    updates: { taskId: string; status: string; position: number }[],
    actorId?: string | null,
  ) {
    if (!Array.isArray(updates)) throw new BadRequestException('updates must be an array');
    for (const update of updates) {
      assertTaskStatus(update?.status);
      assertPosition(update?.position);
    }
    const taskIds = updates.map(u => u.taskId);
    const tasks = await this.prisma.client.projectTask.findMany({
      where: { id: { in: taskIds }, projectId, businessId },
      select: { id: true, status: true, isCompleted: true, evidenceRequired: true },
    });
    if (tasks.length !== taskIds.length) {
      throw new BadRequestException('Some tasks do not belong to this project');
    }
    const byId = new Map(tasks.map((t) => [t.id, t]));

    for (const update of updates) {
      const task = byId.get(update.taskId)!;
      if (update.status === 'DONE' && !task.isCompleted && task.evidenceRequired) {
        await this.resolveCompletionEvidence(businessId, task.id, true);
      }
    }

    const results = [];
    for (const update of updates) {
      const task = byId.get(update.taskId)!;
      const statusChanges = update.status !== task.status || (update.status === 'DONE') !== task.isCompleted;
      const result = statusChanges
        ? await this.updateTask(businessId, update.taskId, { status: update.status, position: update.position }, actorId)
        : await this.prisma.client.projectTask.update({
          where: { id: update.taskId, businessId },
          data: { position: update.position },
        });
      results.push(result);
    }
    return results;
  }

  async getProjectBudget(projectId: string, businessId: string) {
    const project = await this.prisma.client.project.findFirst({
      where: { id: projectId, businessId },
      include: {
        tasks: { where: { businessId, deletedAt: null } },
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
          where: { businessId, deletedAt: null },
          orderBy: [{ status: 'asc' }, { position: 'asc' }],
        },
        milestones: { orderBy: { dueDate: 'asc' } },
      },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  /**
   * Deliverables — the promised outputs of a project.
   *
   * These lived entirely in React state: `useState<Deliverable[]>([])` in
   * project-detail.tsx, with no model, no routes and nothing persisted. Typing
   * one in and switching tabs lost it.
   *
   * Every method proves the PROJECT belongs to the business before touching a
   * deliverable, exactly as the milestone methods above do. That is the control
   * that matters: the deliverable id comes from the client, and a route guard
   * can only vouch for the caller, not the record.
   */
  async listDeliverables(projectId: string, businessId: string) {
    const project = await this.prisma.client.project.findFirst({
      where: { id: projectId, businessId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Project not found');

    return this.prisma.client.projectDeliverable.findMany({
      where: { projectId, businessId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createDeliverable(projectId: string, businessId: string, data: {
    title: string;
    description?: string;
    url?: string;
    kind?: string;
    dueDate?: string;
  }) {
    const project = await this.prisma.client.project.findFirst({
      where: { id: projectId, businessId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Project not found');

    return this.prisma.client.projectDeliverable.create({
      data: {
        projectId,
        businessId,
        title: data.title,
        description: data.description,
        url: data.url,
        kind: data.kind ?? 'document',
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
      },
    });
  }

  async updateDeliverable(deliverableId: string, projectId: string, businessId: string, data: {
    title?: string;
    description?: string;
    url?: string;
    kind?: string;
    status?: string;
    dueDate?: string | null;
  }) {
    const existing = await this.prisma.client.projectDeliverable.findFirst({
      where: { id: deliverableId, projectId, businessId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Deliverable not found');

    // completedAt tracks the status rather than being set independently, so the
    // two cannot disagree about whether the thing was delivered.
    const completedAt =
      data.status === undefined
        ? undefined
        : data.status === 'PENDING'
          ? null
          : new Date();

    return this.prisma.client.projectDeliverable.update({
      where: { id: deliverableId },
      data: {
        title: data.title,
        description: data.description,
        url: data.url,
        kind: data.kind,
        status: data.status,
        completedAt,
        dueDate: data.dueDate === undefined ? undefined : data.dueDate ? new Date(data.dueDate) : null,
      },
    });
  }

  async deleteDeliverable(deliverableId: string, projectId: string, businessId: string) {
    const existing = await this.prisma.client.projectDeliverable.findFirst({
      where: { id: deliverableId, projectId, businessId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Deliverable not found');

    await this.prisma.client.projectDeliverable.delete({ where: { id: deliverableId } });
    return { deleted: true };
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

    // Review SEC-V88C-4 (PR196-PROJECTS-SERVER): named fields only. UpdatePlanEventDto is an
    // interface, so ValidationPipe strips nothing, and spreading the body wrote any key it carried.
    // ProjectPlanEvent has no businessId for the tenant extension to scope, so {planId} moved the
    // event into another business's plan (which its approve then materialized), and {projectTaskId}
    // pointed the event at any task, which completing the event then marked DONE.
    const data: Prisma.ProjectPlanEventUncheckedUpdateInput = {
      ...(body.title !== undefined && { title: body.title }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.executionContext !== undefined && { executionContext: body.executionContext }),
      ...(body.autoExecute !== undefined && { autoExecute: body.autoExecute }),
      ...(body.estimatedHours !== undefined && { estimatedHours: body.estimatedHours }),
      ...(body.estimatedStart !== undefined && { estimatedStart: body.estimatedStart ? new Date(body.estimatedStart) : null }),
      ...(body.estimatedEnd !== undefined && { estimatedEnd: body.estimatedEnd ? new Date(body.estimatedEnd) : null }),
      ...(body.dependsOn !== undefined && { dependsOn: body.dependsOn }),
      ...(body.requiredRoles !== undefined && { requiredRoles: body.requiredRoles }),
      ...(body.estimatedCost !== undefined && { estimatedCost: body.estimatedCost }),
    };

    return this.prisma.client.projectPlanEvent.update({
      where: { id: eventId },
      data,
    });
  }

  /**
   * D-85 (PR196-PROJECTS-SERVER): approving or deleting a project plan needs the business OWNER,
   * an ADMIN, or a member holding projects:write (the membership's explicit scope map, else its
   * role defaults, as ModuleScopeGuard computes it). A membership is required, so a platform
   * SUPER_ADMIN who is not a member is refused (D-46; BusinessGuard admits them to every tenant).
   * 403 otherwise, before anything is read or written.
   */
  private async assertMayGovernPlans(businessId: string, actorId: string | null | undefined) {
    if (!actorId || isSystemActor(actorId)) throw new ForbiddenException('A member must approve or delete a project plan');
    const membership = await this.prisma.client.membership.findUnique({
      where: { userId_businessId: { userId: actorId, businessId } },
      select: { role: true, permissionScopes: true },
    });
    if (!membership) throw new ForbiddenException('Not a member of this business');
    if (PLAN_GOVERNOR_ROLES.has(membership.role)) return;
    const scopes: Record<string, string> =
      membership.permissionScopes && typeof membership.permissionScopes === 'object' && !Array.isArray(membership.permissionScopes)
        ? (membership.permissionScopes as Record<string, string>)
        : defaultScopesForRole(membership.role);
    const level = scopes.projects || 'none';
    if (rankOf(level) < LEVEL_RANK.write) {
      throw new ForbiddenException(
        `Insufficient permissions: approving or deleting a project plan needs the owner, an admin or projects write access (you have ${level})`,
      );
    }
  }

  /**
   * PATCH .../plans/:planId may not write the states only the approve door sets (WPD-12, D-85):
   * 'approved' without the approver's authority, and 'materialized' with no project.
   */
  assertPlanPatchStatus(status: unknown) {
    if (status === undefined) return;
    if (typeof status !== 'string') throw new BadRequestException('status must be a string');
    if (PLAN_STATUSES_SET_BY_APPROVAL.includes(status)) {
      throw new BadRequestException(`A plan becomes ${status} only through POST .../plans/:planId/approve`);
    }
  }

  /**
   * Review SEC-V88C-1 (PR196-PROJECTS-SERVER): the status write of PATCH .../plans/:planId and
   * POST .../reject. approvePlan holds a plan from its claim (status 'approved', no project yet)
   * until materializePlan links the Project. Those routes wrote the status unconditionally, so a
   * write landing in that window took the plan out of 'approved', a second approve claimed it again
   * from there, and the plan got two Projects. The write is now one conditional statement that
   * leaves a held plan alone (409); another business's plan is 404. Returns the plan row.
   */
  async changePlanStatus(businessId: string, planId: string, status: string) {
    const changed = await this.prisma.client.projectPlan.updateMany({
      where: { id: planId, businessId, NOT: { status: 'approved', projectId: null } },
      data: { status },
    });
    const plan = await this.prisma.client.projectPlan.findFirst({ where: { id: planId, businessId } });
    if (!plan) throw new NotFoundException('Plan not found');
    if (changed.count !== 1) {
      throw new ConflictException('This plan is being approved; its status cannot change until the approval finishes');
    }
    return plan;
  }

  /**
   * Review SEC-V88C-3 (PR196-PROJECTS-SERVER): POST .../plans/:planId/events/:eventId/complete.
   * ProjectPlanExecutorService.completeOutAppEvent writes { status: 'DONE', isCompleted: true } on
   * the event's materialized task directly: no evidence gate (materializePlan copies
   * manualEvidenceRequired into evidenceRequired), no project_task.completed, no actor. The task is
   * now completed through updateTask's door first, as the member; a refusal there (the evidence
   * gate, a task that is not this business's) writes nothing, the event included. `complete` (the
   * executor's event write) runs after, and its task write then changes nothing. The event must be
   * this plan's, in this business.
   */
  async completePlanEvent<T>(
    businessId: string,
    planId: string,
    eventId: string,
    actorId: string | null | undefined,
    complete: () => Promise<T>,
  ): Promise<T> {
    const event = await this.prisma.client.projectPlanEvent.findFirst({
      where: { id: eventId, planId, plan: { businessId } },
      select: { executionContext: true, projectTaskId: true },
    });
    if (!event) throw new NotFoundException('Event not found');
    if (event.executionContext === 'OUT_APP' && event.projectTaskId) {
      await this.updateTask(businessId, event.projectTaskId, { status: 'DONE' }, actorId);
    }
    return complete();
  }

  /**
   * PR196-PROJECTS-SERVER (WPD-12, D-85): approve a plan once. The approve route wrote status
   * 'approved' over any status and then materialized, so a double click, concurrent requests or a
   * re-approve each made another Project with its tasks and milestones. Now: the actor's authority
   * (assertMayGovernPlans), then a compare-and-set from the plan's current status to 'approved',
   * only while it is neither approved nor materialized and has no project. One request wins; any
   * other is 409 and materializes nothing. `materialize` (ProjectPlanExecutorService.materializePlan)
   * runs only for the winner; if it fails before the plan is linked to a project, the claim is
   * given back so the plan can be approved again. The feed names the approver.
   */
  async approvePlan<T extends { id: string }>(
    businessId: string,
    planId: string,
    actorId: string | null | undefined,
    materialize: () => Promise<T>,
  ): Promise<T> {
    await this.assertMayGovernPlans(businessId, actorId);
    const plan = await this.prisma.client.projectPlan.findFirst({
      where: { id: planId, businessId },
      select: { status: true, projectId: true },
    });
    if (!plan) throw new NotFoundException('Plan not found');

    const approvable = plan.projectId === null && !PLAN_STATUSES_SET_BY_APPROVAL.includes(plan.status);
    const claimed = approvable
      ? await this.prisma.client.projectPlan.updateMany({
        where: { id: planId, businessId, status: plan.status, projectId: null },
        data: { status: 'approved' },
      })
      : { count: 0 };
    if (claimed.count !== 1) {
      throw new ConflictException('This plan has already been approved; a plan is approved once');
    }

    let project: T;
    try {
      project = await materialize();
    } catch (err) {
      await this.prisma.client.projectPlan
        .updateMany({ where: { id: planId, businessId, status: 'approved', projectId: null }, data: { status: plan.status } })
        .catch(() => undefined);
      throw err;
    }

    await this.timeline.recordEvent({
      businessId,
      module: 'PROJECT',
      action: 'plan_approved',
      entityType: 'project_plan',
      entityId: planId,
      title: 'Project plan approved',
      data: { planId, projectId: project.id },
      actorType: feedActorType(actorId),
      actorId: actorId ?? undefined,
      occurredAt: new Date(),
    });
    return project;
  }

  /**
   * PR196-PROJECTS-SERVER (WPD-14, D-85): only a draft plan with no project is deleted, by an
   * actor assertMayGovernPlans admits. ProjectPlannerService.deletePlan hard-deleted any plan,
   * materialized ones too, which dropped the plan-to-project and event-to-task provenance. The
   * delete is one conditional statement, so it cannot race an approve; the plan's events go with
   * it (project_plan_events.plan_id ON DELETE CASCADE). Anything else is 409 and kept; another
   * business's plan is 404. The feed names the actor.
   */
  async deleteDraftPlan(businessId: string, planId: string, actorId: string | null | undefined) {
    await this.assertMayGovernPlans(businessId, actorId);
    const deleted = await this.prisma.client.projectPlan.deleteMany({
      where: { id: planId, businessId, status: 'draft', projectId: null },
    });
    if (deleted.count !== 1) {
      const plan = await this.prisma.client.projectPlan.findFirst({
        where: { id: planId, businessId },
        select: { status: true, projectId: true },
      });
      if (!plan) throw new NotFoundException('Plan not found');
      throw new ConflictException(
        plan.projectId
          ? 'This plan was materialized into a project and is not deleted'
          : `Only a draft plan can be deleted; this plan is ${plan.status}`,
      );
    }

    await this.timeline.recordEvent({
      businessId,
      module: 'PROJECT',
      action: 'plan_deleted',
      entityType: 'project_plan',
      entityId: planId,
      title: 'Project plan deleted',
      data: { planId },
      actorType: feedActorType(actorId),
      actorId: actorId ?? undefined,
      occurredAt: new Date(),
    });
    return { success: true };
  }
}
