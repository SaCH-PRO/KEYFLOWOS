/**
 * Phase 2 Increment 1 — TaskAssignment correctness & cross-tenant safety (REAL database).
 *
 * Proves two defects and their fixes:
 *  (A) Latent: TaskAssignment listed in BUSINESS_ID_MODELS despite having no
 *      businessId column → the tenant extension throws under tenant context.
 *  (B) Active: the service resolved parent tasks by GLOBAL id, so a member of
 *      Business A could read/create/delete assignments on Business B's tasks by
 *      supplying B's taskId. The service now enforces task ownership when a
 *      businessId is provided (as the guarded HTTP controller always does).
 *
 * Nothing on the isolation boundary is mocked. Only unrelated deps
 * (BusinessEventService, EventEmitter2) are stubbed.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 't2i1_';
const ID = {
  userA: `${P}userA`,
  userB: `${P}userB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  contactA: `${P}contactA`,
  contactB: `${P}contactB`,
  taskA: `${P}taskA`, // ContactTask owned by Business A
  taskB: `${P}taskB`, // ContactTask owned by Business B
};

let db: any;
let svc: any;
let setTenantContextProvider: (p: { getCurrentBusinessId: () => string | undefined }) => void;

async function cleanup() {
  for (const sql of [
    `DELETE FROM task_assignments WHERE task_id LIKE '${P}%'`,
    `DELETE FROM contact_tasks WHERE id LIKE '${P}%'`,
    `DELETE FROM contacts WHERE id LIKE '${P}%'`,
    `DELETE FROM memberships WHERE id LIKE '${P}%'`,
    `DELETE FROM businesses WHERE id LIKE '${P}%'`,
    `DELETE FROM users WHERE id LIKE '${P}%'`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  setTenantContextProvider = dbMod.setTenantContextProvider;
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { TaskAssignmentService } = await import('../src/modules/task-assignments/task-assignment.service');
  const prisma = new PrismaService();
  const noopEvents = { emit: async () => undefined } as any;
  const noopEmitter = { emit: () => undefined } as any;
  svc = new TaskAssignmentService(prisma as any, noopEvents, noopEmitter);

  await cleanup();
  await db.user.create({ data: { id: ID.userA, email: `${P}a@t.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.userB, email: `${P}b@t.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizA, name: 'A', ownerId: ID.userA } });
  await db.business.create({ data: { id: ID.bizB, name: 'B', ownerId: ID.userB } });
  await db.contact.create({ data: { id: ID.contactA, businessId: ID.bizA } });
  await db.contact.create({ data: { id: ID.contactB, businessId: ID.bizB } });
  await db.contactTask.create({ data: { id: ID.taskA, businessId: ID.bizA, contactId: ID.contactA, title: 'A task' } });
  await db.contactTask.create({ data: { id: ID.taskB, businessId: ID.bizB, contactId: ID.contactB, title: 'B task' } });
}, 60_000);

afterAll(async () => {
  if (setTenantContextProvider) setTenantContextProvider({ getCurrentBusinessId: () => undefined });
  if (db) await cleanup();
});

describe('Finding 2 — tenant extension no longer breaks TaskAssignment', () => {
  it('taskAssignment.findMany works under an active tenant context (post-fix: not in BUSINESS_ID_MODELS)', async () => {
    setTenantContextProvider({ getCurrentBusinessId: () => ID.bizA });
    try {
      await expect(db.taskAssignment.findMany({ take: 1 })).resolves.toBeDefined();
    } finally {
      setTenantContextProvider({ getCurrentBusinessId: () => undefined });
    }
  });
});

describe('Cross-tenant attacks on TaskAssignment (businessId enforcement)', () => {
  it('READ: Business A cannot list assignments for a Business B task', async () => {
    await expect(svc.getAssignmentsForTask('ContactTask', ID.taskB, ID.bizA)).rejects.toThrow();
  });

  it('CREATE: Business A cannot assign against a Business B task', async () => {
    await expect(
      svc.assign({ taskType: 'ContactTask', taskId: ID.taskB, assignableType: 'KEY', assignableId: 'key_ai', assignedBy: ID.userA, businessId: ID.bizA }),
    ).rejects.toThrow();
    // No assignment should have been created against B's task.
    const rows = await db.taskAssignment.findMany({ where: { taskId: ID.taskB } });
    expect(rows.length).toBe(0);
  });

  it('DELETE: Business A cannot unassign a Business B task assignment', async () => {
    // Seed a legitimate assignment on B's task (as B would).
    await svc.assign({ taskType: 'ContactTask', taskId: ID.taskB, assignableType: 'KEY', assignableId: 'key_ai', assignedBy: ID.userB, businessId: ID.bizB });
    await expect(
      svc.unassign({ taskType: 'ContactTask', taskId: ID.taskB, assignableType: 'KEY', assignableId: 'key_ai', businessId: ID.bizA }),
    ).rejects.toThrow();
    // B's assignment remains active (unassignedAt still null).
    const active = await db.taskAssignment.findFirst({ where: { taskId: ID.taskB, unassignedAt: null } });
    expect(active).not.toBeNull();
  });

  it('positive control: Business A CAN operate on its own task', async () => {
    const created = await svc.assign({ taskType: 'ContactTask', taskId: ID.taskA, assignableType: 'KEY', assignableId: 'key_ai', assignedBy: ID.userA, businessId: ID.bizA });
    expect(created.taskId).toBe(ID.taskA);
    const list = await svc.getAssignmentsForTask('ContactTask', ID.taskA, ID.bizA);
    expect(list.map((a: any) => a.id)).toContain(created.id);
  });

  it('internal callers without a businessId keep working (no enforcement when omitted)', async () => {
    // Backwards-compatible path used by internal services that pre-scope taskIds.
    const list = await svc.getAssignmentsForTask('ContactTask', ID.taskA);
    expect(Array.isArray(list)).toBe(true);
  });
});
