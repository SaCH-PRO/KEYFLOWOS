import { Injectable, Inject, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { BusinessEventService } from '../business-events/business-event.service';

export const TASK_TYPES = ['ContactTask', 'ProjectTask', 'AutopilotTask'] as const;
export const ASSIGNABLE_TYPES = ['User', 'StaffMember', 'Contractor', 'KeyflowStaff', 'KEY'] as const;
export type TaskType = (typeof TASK_TYPES)[number];
export type AssignableType = (typeof ASSIGNABLE_TYPES)[number];

export interface AssignTaskInput {
  taskType: TaskType;
  taskId: string;
  assignableType: AssignableType;
  assignableId: string;
  assignedBy: string;
  reason?: string;
  /**
   * Tenant scope of the request. When provided (always by the guarded HTTP
   * controller), the task and assignable must belong to this business or the
   * operation fails closed. Omitted by trusted internal callers that already
   * pre-scope their task ids.
   */
  businessId?: string;
}

export interface UnassignTaskInput {
  taskType: TaskType;
  taskId: string;
  assignableType: AssignableType;
  assignableId: string;
  reason?: string;
  /** Tenant scope — see AssignTaskInput.businessId. */
  businessId?: string;
}

@Injectable()
export class TaskAssignmentService {
  private readonly logger = new Logger(TaskAssignmentService.name);
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessEventService) private readonly events: BusinessEventService,
    @Inject(EventEmitter2) private readonly emitter: EventEmitter2,
  ) {}

  /**
   * Assign a task to an entity. If the entity is already assigned, idempotent.
   * Unassigns any previous active assignment for the same task (single-assignment mode).
   */
  async assign(input: AssignTaskInput & { autoInferType?: boolean }) {
    let assignableType = input.assignableType;
    if (input.autoInferType || assignableType === 'User') {
      const inferred = await this.inferAssignableType(input.assignableId);
      if (inferred) assignableType = inferred;
    }
    await this.validateAssignable(assignableType, input.assignableId);
    await this.validateTask(input.taskType, input.taskId);
    // Tenant enforcement (no-op when businessId omitted by internal callers).
    await this.assertTaskInBusiness(input.taskType, input.taskId, input.businessId);
    await this.assertAssignableInBusiness(assignableType, input.assignableId, input.businessId);

    const existing = await this.prisma.client.taskAssignment.findFirst({
      where: {
        taskType: input.taskType,
        taskId: input.taskId,
        assignableType,
        assignableId: input.assignableId,
        unassignedAt: null,
      },
    });

    if (existing) {
      return existing; // idempotent
    }

    // Unassign previous active assignment for this task (single-assignee mode)
    await this.prisma.client.taskAssignment.updateMany({
      where: {
        taskType: input.taskType,
        taskId: input.taskId,
        unassignedAt: null,
      },
      data: {
        unassignedAt: new Date(),
        reason: input.reason ?? 'reassigned',
      },
    });

    const assignment = await this.prisma.client.taskAssignment.create({
      data: {
        taskType: input.taskType,
        taskId: input.taskId,
        assignableType,
        assignableId: input.assignableId,
        assignedBy: input.assignedBy,
        reason: input.reason,
      },
    });

    const businessId = await this.getBusinessIdForTask(input.taskType, input.taskId);
    await this.emitEvent('task.assigned', { ...input, assignableType }, assignment.id);
    if (businessId) {
      this.emitter.emit('task.assigned', {
        businessId,
        taskType: input.taskType,
        taskId: input.taskId,
        assignableType,
        assignableId: input.assignableId,
      });
    }
    return assignment;
  }

  /**
   * Soft-unassign a task from an entity.
   */
  async unassign(input: UnassignTaskInput) {
    await this.assertTaskInBusiness(input.taskType, input.taskId, input.businessId);
    const assignment = await this.prisma.client.taskAssignment.findFirst({
      where: {
        taskType: input.taskType,
        taskId: input.taskId,
        assignableType: input.assignableType,
        assignableId: input.assignableId,
        unassignedAt: null,
      },
    });

    if (!assignment) {
      throw new NotFoundException('Active assignment not found');
    }

    const updated = await this.prisma.client.taskAssignment.update({
      where: { id: assignment.id },
      data: {
        unassignedAt: new Date(),
        reason: input.reason ?? assignment.reason,
      },
    });

    const businessId = await this.getBusinessIdForTask(input.taskType, input.taskId);
    await this.emitEvent('task.unassigned', input, assignment.id);
    if (businessId) {
      this.emitter.emit('task.unassigned', {
        businessId,
        taskType: input.taskType,
        taskId: input.taskId,
        assignableType: input.assignableType,
        assignableId: input.assignableId,
      });
    }
    return updated;
  }

  /**
   * Get active assignments for a task.
   */
  async getAssignmentsForTask(taskType: TaskType, taskId: string, businessId?: string) {
    await this.assertTaskInBusiness(taskType, taskId, businessId);
    return this.prisma.client.taskAssignment.findMany({
      where: { taskType, taskId, unassignedAt: null },
      orderBy: { assignedAt: 'desc' },
    });
  }

  /**
   * Get active tasks assigned to an entity.
   */
  async getTasksForAssignee(
    assignableType: AssignableType,
    assignableId: string,
    options?: {
      taskType?: TaskType;
      limit?: number;
      offset?: number;
      businessId?: string;
    },
  ) {
    await this.assertAssignableInBusiness(assignableType, assignableId, options?.businessId);
    const where: any = {
      assignableType,
      assignableId,
      unassignedAt: null,
    };
    if (options?.taskType) where.taskType = options.taskType;

    const [items, total] = await Promise.all([
      this.prisma.client.taskAssignment.findMany({
        where,
        orderBy: { assignedAt: 'desc' },
        skip: options?.offset ?? 0,
        take: options?.limit ?? 50,
      }),
      this.prisma.client.taskAssignment.count({ where }),
    ]);

    return { items, total, offset: options?.offset ?? 0, limit: options?.limit ?? 50 };
  }

  /**
   * Transfer all active assignments from one entity to another.
   */
  async transferAssignments(
    fromType: AssignableType,
    fromId: string,
    toType: AssignableType,
    toId: string,
    transferredBy: string,
    businessId?: string,
  ) {
    await this.validateAssignable(toType, toId);
    // Both endpoints of the transfer must belong to the tenant (when scoped).
    await this.assertAssignableInBusiness(fromType, fromId, businessId);
    await this.assertAssignableInBusiness(toType, toId, businessId);

    let assignments = await this.prisma.client.taskAssignment.findMany({
      where: {
        assignableType: fromType,
        assignableId: fromId,
        unassignedAt: null,
      },
    });

    // Never move assignments whose parent task belongs to another tenant
    // (a shared user may hold assignments across businesses).
    if (businessId) {
      const owned = [] as typeof assignments;
      for (const a of assignments) {
        const owner = await this.getBusinessIdForTask(a.taskType as TaskType, a.taskId);
        if (owner === businessId) owned.push(a);
      }
      assignments = owned;
    }

    const results = [];
    for (const a of assignments) {
      await this.prisma.client.taskAssignment.update({
        where: { id: a.id },
        data: { unassignedAt: new Date(), reason: 'transferred' },
      });
      const created = await this.prisma.client.taskAssignment.create({
        data: {
          taskType: a.taskType as TaskType,
          taskId: a.taskId,
          assignableType: toType,
          assignableId: toId,
          assignedBy: transferredBy,
          reason: `transferred from ${fromType}:${fromId}`,
        },
      });
      results.push(created);
    }

    // Emit transfer event using businessId from first assignment
    const firstBusinessId = assignments[0]
      ? await this.getBusinessIdForTask(assignments[0].taskType as TaskType, assignments[0].taskId)
      : null;
    if (firstBusinessId) {
      this.emitter.emit('task.transferred', {
        businessId: firstBusinessId,
        fromType,
        fromId,
        toType,
        toId,
        count: results.length,
      });
    }

    return { transferred: results.length, assignments: results };
  }

  /**
   * Get a flat list of assignable options for a business (users + staff).
   */
  async getAssignableOptions(businessId: string) {
    const [users, staff] = await Promise.all([
      this.prisma.client.user.findMany({
        where: { businesses: { some: { businessId } } },
        select: { id: true, name: true, email: true },
        take: 200,
      }),
      this.prisma.client.staffMember.findMany({
        where: { businessId },
        select: { id: true, name: true },
        take: 200,
      }),
    ]);

    return [
      ...users.map((u) => ({ type: 'User' as AssignableType, id: u.id, name: u.name ?? u.email ?? u.id })),
      ...staff.map((s) => ({ type: 'StaffMember' as AssignableType, id: s.id, name: s.name })),
      { type: 'KEY' as AssignableType, id: 'key_ai', name: 'KEY AI Assistant' },
    ];
  }

  /**
   * Bulk-assign multiple tasks to an entity.
   */
  async bulkAssign(
    taskIds: { taskType: TaskType; taskId: string }[],
    assignableType: AssignableType,
    assignableId: string,
    assignedBy: string,
    businessId?: string,
  ) {
    const results = [];
    for (const t of taskIds) {
      try {
        const r = await this.assign({
          taskType: t.taskType,
          taskId: t.taskId,
          assignableType,
          assignableId,
          assignedBy,
          businessId,
        });
        results.push({ success: true, taskId: t.taskId, assignmentId: r.id });
      } catch (err: any) {
        results.push({ success: false, taskId: t.taskId, error: (err as Error).message });
      }
    }
    return results;
  }

  private async inferAssignableType(id: string): Promise<AssignableType | null> {
    const [user, staff] = await Promise.all([
      this.prisma.client.user.findUnique({ where: { id }, select: { id: true } }),
      this.prisma.client.staffMember.findUnique({ where: { id }, select: { id: true } }),
    ]);
    if (staff) return 'StaffMember';
    if (user) return 'User';
    return null;
  }

  private async validateAssignable(type: AssignableType, id: string) {
    if (type === 'KEY') {
      if (id !== 'key_ai') {
        throw new BadRequestException('KEY assignableId must be "key_ai"');
      }
      return;
    }

    let exists = false;
    if (type === 'User') {
      exists = !!(await this.prisma.client.user.findUnique({ where: { id }, select: { id: true } }));
    } else if (type === 'StaffMember') {
      exists = !!(await this.prisma.client.staffMember.findUnique({ where: { id }, select: { id: true } }));
    } else if (type === 'Contractor' || type === 'KeyflowStaff') {
      // No dedicated tables yet; accept as-is with a warning
      exists = true;
    }

    if (!exists) {
      throw new BadRequestException(`${type} with id "${id}" not found`);
    }
  }

  private async validateTask(taskType: TaskType, taskId: string) {
    let exists = false;
    if (taskType === 'ContactTask') {
      exists = !!(await this.prisma.client.contactTask.findUnique({ where: { id: taskId }, select: { id: true } }));
    } else if (taskType === 'ProjectTask') {
      exists = !!(await this.prisma.client.projectTask.findUnique({ where: { id: taskId }, select: { id: true } }));
    } else if (taskType === 'AutopilotTask') {
      exists = true; // No table yet
    }

    if (!exists) {
      throw new BadRequestException(`${taskType} with id "${taskId}" not found`);
    }
  }

  /**
   * Enforce that a task belongs to the given business. No-op when businessId is
   * omitted (trusted internal callers). Fails closed for task types whose owning
   * business cannot be resolved (e.g. AutopilotTask, which has no table yet).
   */
  private async assertTaskInBusiness(taskType: TaskType, taskId: string, businessId?: string): Promise<void> {
    if (!businessId) return;
    const owner = await this.getBusinessIdForTask(taskType, taskId);
    if (owner !== businessId) {
      throw new NotFoundException(`${taskType} with id "${taskId}" not found`);
    }
  }

  /**
   * Enforce that an assignable entity belongs to the given business. No-op when
   * businessId is omitted. KEY is a global assistant; Contractor/KeyflowStaff
   * have no backing table to scope (documented residual).
   */
  private async assertAssignableInBusiness(type: AssignableType, id: string, businessId?: string): Promise<void> {
    if (!businessId) return;
    if (type === 'KEY') return;
    if (type === 'StaffMember') {
      const staff = await this.prisma.client.staffMember.findFirst({ where: { id, businessId }, select: { id: true } });
      if (!staff) throw new NotFoundException(`StaffMember with id "${id}" not found`);
      return;
    }
    if (type === 'User') {
      const member = await this.prisma.client.membership.findUnique({
        where: { userId_businessId: { userId: id, businessId } },
        select: { userId: true },
      });
      if (!member) throw new NotFoundException(`User with id "${id}" not found`);
      return;
    }
    // Contractor / KeyflowStaff: no dedicated table; cannot tenant-scope here.
  }

  private async getBusinessIdForTask(taskType: TaskType, taskId: string): Promise<string | null> {
    try {
      if (taskType === 'ContactTask') {
        const task = await this.prisma.client.contactTask.findUnique({ where: { id: taskId }, select: { businessId: true } });
        return task?.businessId ?? null;
      }
      if (taskType === 'ProjectTask') {
        const task = await this.prisma.client.projectTask.findUnique({ where: { id: taskId }, select: { businessId: true } });
        return task?.businessId ?? null;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async emitEvent(
    eventType: string,
    input: { taskType: string; taskId: string; assignableType: string; assignableId: string },
    subjectId: string,
  ) {
    try {
      await this.events.emit({
        businessId: '', // Will be filled by interceptor or caller
        eventType,
        subjectType: 'task_assignment',
        subjectId,
        actorType: 'human',
        actorId: 'system',
        action: eventType.split('.')[1] ?? 'assign',
        source: 'web',
        metadata: {
          taskType: input.taskType,
          taskId: input.taskId,
          assignableType: input.assignableType,
          assignableId: input.assignableId,
        },
      });
    } catch (err: any) {
        this.logger.warn(`Best-effort: ${err instanceof Error ? err.message : err}`);
      }
  }
}
