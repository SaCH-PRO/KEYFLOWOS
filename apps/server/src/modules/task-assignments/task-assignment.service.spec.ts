import { describe, expect, it, vi } from 'vitest';
import { TaskAssignmentService } from './task-assignment.service';

function createMockPrisma() {
  const store = {
    taskAssignments: new Map<string, any>(),
    users: new Map<string, any>(),
    staffMembers: new Map<string, any>(),
    contactTasks: new Map<string, any>(),
    projectTasks: new Map<string, any>(),
  };
  let idCounter = 0;

  return {
    client: {
      taskAssignment: {
        create: vi.fn(async (args: any) => {
          const id = `ta_${++idCounter}`;
          const record = { id, ...args.data, assignedAt: new Date(), unassignedAt: null };
          store.taskAssignments.set(id, record);
          return record;
        }),
        findUnique: vi.fn(async (args: any) => store.taskAssignments.get(args.where.id) ?? null),
        findFirst: vi.fn(async (args: any) => {
          for (const item of store.taskAssignments.values()) {
            let match = true;
            if (args.where?.taskType && item.taskType !== args.where.taskType) match = false;
            if (args.where?.taskId && item.taskId !== args.where.taskId) match = false;
            if (args.where?.assignableType && item.assignableType !== args.where.assignableType) match = false;
            if (args.where?.assignableId && item.assignableId !== args.where.assignableId) match = false;
            if (args.where?.unassignedAt === null && item.unassignedAt !== null) match = false;
            if (match) return item;
          }
          return null;
        }),
        findMany: vi.fn(async (args: any) => {
          const items = Array.from(store.taskAssignments.values()).filter((item) => {
            let match = true;
            if (args.where?.taskType && item.taskType !== args.where.taskType) match = false;
            if (args.where?.taskId && item.taskId !== args.where.taskId) match = false;
            if (args.where?.assignableType && item.assignableType !== args.where.assignableType) match = false;
            if (args.where?.assignableId && item.assignableId !== args.where.assignableId) match = false;
            if (args.where?.unassignedAt === null && item.unassignedAt !== null) match = false;
            return match;
          });
          return items.sort((a, b) => b.assignedAt - a.assignedAt);
        }),
        update: vi.fn(async (args: any) => {
          const existing = store.taskAssignments.get(args.where.id);
          if (!existing) return null;
          const updated = { ...existing, ...args.data };
          store.taskAssignments.set(args.where.id, updated);
          return updated;
        }),
        updateMany: vi.fn(async (args: any) => {
          let count = 0;
          for (const [id, item] of store.taskAssignments) {
            let match = true;
            if (args.where?.taskType && item.taskType !== args.where.taskType) match = false;
            if (args.where?.taskId && item.taskId !== args.where.taskId) match = false;
            if (args.where?.unassignedAt === null && item.unassignedAt !== null) match = false;
            if (match) {
              store.taskAssignments.set(id, { ...item, ...args.data });
              count++;
            }
          }
          return { count };
        }),
        count: vi.fn(async (args: any) => {
          const items = Array.from(store.taskAssignments.values()).filter((item) => {
            let match = true;
            if (args.where?.assignableType && item.assignableType !== args.where.assignableType) match = false;
            if (args.where?.assignableId && item.assignableId !== args.where.assignableId) match = false;
            if (args.where?.unassignedAt === null && item.unassignedAt !== null) match = false;
            return match;
          });
          return items.length;
        }),
      },
      user: {
        findUnique: vi.fn(async (args: any) => store.users.get(args.where.id) ?? null),
      },
      staffMember: {
        findUnique: vi.fn(async (args: any) => store.staffMembers.get(args.where.id) ?? null),
      },
      contactTask: {
        findUnique: vi.fn(async (args: any) => store.contactTasks.get(args.where.id) ?? null),
      },
      projectTask: {
        findUnique: vi.fn(async (args: any) => store.projectTasks.get(args.where.id) ?? null),
      },
    },
    store,
  };
}

function createMockEventService() {
  return { emit: vi.fn(async () => ({ id: 'evt_1' })) };
}

function createMockEmitter() {
  return { emit: vi.fn() };
}

describe('TaskAssignmentService', () => {
  it('assigns a task and returns the assignment', async () => {
    const prisma = createMockPrisma();
    prisma.store.contactTasks.set('task_1', { id: 'task_1', businessId: 'biz_1' });
    prisma.store.users.set('user_1', { id: 'user_1', name: 'Alice' });
    const events = createMockEventService();
    const emitter = createMockEmitter();
    const svc = new TaskAssignmentService(prisma as any, events as any, emitter as any);

    const result = await svc.assign({
      taskType: 'ContactTask',
      taskId: 'task_1',
      assignableType: 'User',
      assignableId: 'user_1',
      assignedBy: 'admin_1',
    });

    expect(result.taskId).toBe('task_1');
    expect(result.assignableId).toBe('user_1');
    expect(emitter.emit).toHaveBeenCalledWith('task.assigned', expect.any(Object));
  });

  it('is idempotent for duplicate assignments', async () => {
    const prisma = createMockPrisma();
    prisma.store.contactTasks.set('task_1', { id: 'task_1', businessId: 'biz_1' });
    prisma.store.users.set('user_1', { id: 'user_1' });
    const events = createMockEventService();
    const emitter = createMockEmitter();
    const svc = new TaskAssignmentService(prisma as any, events as any, emitter as any);

    const first = await svc.assign({ taskType: 'ContactTask', taskId: 'task_1', assignableType: 'User', assignableId: 'user_1', assignedBy: 'admin' });
    const second = await svc.assign({ taskType: 'ContactTask', taskId: 'task_1', assignableType: 'User', assignableId: 'user_1', assignedBy: 'admin' });

    expect(first.id).toBe(second.id);
  });

  it('unassigns a task', async () => {
    const prisma = createMockPrisma();
    prisma.store.contactTasks.set('task_1', { id: 'task_1', businessId: 'biz_1' });
    prisma.store.users.set('user_1', { id: 'user_1' });
    const events = createMockEventService();
    const emitter = createMockEmitter();
    const svc = new TaskAssignmentService(prisma as any, events as any, emitter as any);

    await svc.assign({ taskType: 'ContactTask', taskId: 'task_1', assignableType: 'User', assignableId: 'user_1', assignedBy: 'admin' });
    const unassigned = await svc.unassign({ taskType: 'ContactTask', taskId: 'task_1', assignableType: 'User', assignableId: 'user_1' });

    expect(unassigned.unassignedAt).toBeInstanceOf(Date);
    expect(emitter.emit).toHaveBeenCalledWith('task.unassigned', expect.any(Object));
  });

  it('transfers assignments between entities', async () => {
    const prisma = createMockPrisma();
    prisma.store.contactTasks.set('task_1', { id: 'task_1', businessId: 'biz_1' });
    prisma.store.users.set('user_1', { id: 'user_1' });
    prisma.store.users.set('user_2', { id: 'user_2' });
    const events = createMockEventService();
    const emitter = createMockEmitter();
    const svc = new TaskAssignmentService(prisma as any, events as any, emitter as any);

    await svc.assign({ taskType: 'ContactTask', taskId: 'task_1', assignableType: 'User', assignableId: 'user_1', assignedBy: 'admin' });
    const transfer = await svc.transferAssignments('User', 'user_1', 'User', 'user_2', 'admin');

    expect(transfer.transferred).toBe(1);
    expect(emitter.emit).toHaveBeenCalledWith('task.transferred', expect.any(Object));
  });

  it('infers assignable type from staff member lookup', async () => {
    const prisma = createMockPrisma();
    prisma.store.contactTasks.set('task_1', { id: 'task_1', businessId: 'biz_1' });
    prisma.store.staffMembers.set('staff_1', { id: 'staff_1', name: 'Bob' });
    const events = createMockEventService();
    const emitter = createMockEmitter();
    const svc = new TaskAssignmentService(prisma as any, events as any, emitter as any);

    const result = await svc.assign({
      taskType: 'ContactTask',
      taskId: 'task_1',
      assignableType: 'User',
      assignableId: 'staff_1',
      assignedBy: 'admin',
      autoInferType: true,
    });

    expect(result.assignableType).toBe('StaffMember');
  });

  it('bulk assigns multiple tasks', async () => {
    const prisma = createMockPrisma();
    prisma.store.contactTasks.set('task_1', { id: 'task_1', businessId: 'biz_1' });
    prisma.store.projectTasks.set('task_2', { id: 'task_2', businessId: 'biz_1' });
    prisma.store.users.set('user_1', { id: 'user_1' });
    const events = createMockEventService();
    const emitter = createMockEmitter();
    const svc = new TaskAssignmentService(prisma as any, events as any, emitter as any);

    const results = await svc.bulkAssign(
      [{ taskType: 'ContactTask', taskId: 'task_1' }, { taskType: 'ProjectTask', taskId: 'task_2' }],
      'User',
      'user_1',
      'admin',
    );

    expect(results.filter((r: any) => r.success)).toHaveLength(2);
  });
});
