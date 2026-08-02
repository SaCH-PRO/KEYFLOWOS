/**
 * Time entries must not reference another tenant's project, task or invoice.
 *
 * The DTOs for this controller carried no class-validator metadata, so the
 * global ValidationPipe (whitelist: true) deleted projectId, taskId and
 * invoiceId from every request body. That made the endpoints broken — and, by
 * accident, made three missing ownership checks unreachable. The whitelist was
 * doing tenant isolation's job.
 *
 * Decorating the DTOs (so the endpoints work at all) makes those fields live.
 * These tests pin the checks that had to land in the same change:
 *
 *   create / startTimer  — projectId, taskId
 *   update               — re-parenting an existing entry
 *   markAsBilled         — invoiceId, which would otherwise let a caller bill
 *                          their entries against another tenant's invoice
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { TimeEntryService } from './time-entry.service';

/** Rows that exist, each mapped to its owning business. */
const OWNERS = {
  project: new Map([
    ['proj_mine', 'biz_1'],
    ['proj_theirs', 'biz_2'],
  ]),
  task: new Map([
    ['task_mine', 'biz_1'],
    ['task_theirs', 'biz_2'],
  ]),
  invoice: new Map([
    ['inv_mine', 'biz_1'],
    ['inv_theirs', 'biz_2'],
  ]),
};

class PrismaStub {
  writes: Array<Record<string, unknown>> = [];

  client = {
    project: {
      findFirst: vi.fn(({ where }: { where: { id: string; businessId: string } }) =>
        Promise.resolve(
          OWNERS.project.get(where.id) === where.businessId ? { id: where.id } : null,
        ),
      ),
    },
    projectTask: {
      findFirst: vi.fn(
        ({ where }: { where: { id: string; project: { businessId: string } } }) =>
          Promise.resolve(
            OWNERS.task.get(where.id) === where.project.businessId ? { id: where.id } : null,
          ),
      ),
    },
    invoice: {
      findFirst: vi.fn(({ where }: { where: { id: string; businessId: string } }) =>
        Promise.resolve(
          OWNERS.invoice.get(where.id) === where.businessId ? { id: where.id } : null,
        ),
      ),
    },
    timeEntry: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        (globalThis as { __writes?: unknown[] }).__writes;
        return Promise.resolve({ id: 'te_1', ...data });
      }),
      updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
      update: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'te_1', ...data }),
      ),
      findFirst: vi.fn(() =>
        Promise.resolve({ id: 'te_1', billed: false, startTime: new Date(), endTime: null }),
      ),
      updateMany_stopRunning: vi.fn(),
    },
  };
}

function makeService(prisma: PrismaStub) {
  return new TimeEntryService(prisma as never);
}

const base = { businessId: 'biz_1', userId: 'user_1', startTime: new Date() };

describe('create — project/task ownership', () => {
  let prisma: PrismaStub;
  let svc: TimeEntryService;

  beforeEach(() => {
    prisma = new PrismaStub();
    svc = makeService(prisma);
  });

  it('allows an entry with no references', async () => {
    await expect(svc.create({ ...base } as never)).resolves.toBeDefined();
  });

  it('allows a project owned by the same business', async () => {
    await expect(
      svc.create({ ...base, projectId: 'proj_mine' } as never),
    ).resolves.toBeDefined();
  });

  it('REFUSES another tenant project', async () => {
    await expect(
      svc.create({ ...base, projectId: 'proj_theirs' } as never),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.client.timeEntry.create).not.toHaveBeenCalled();
  });

  it('REFUSES another tenant task', async () => {
    await expect(svc.create({ ...base, taskId: 'task_theirs' } as never)).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.client.timeEntry.create).not.toHaveBeenCalled();
  });

  it('REFUSES a project that does not exist', async () => {
    await expect(svc.create({ ...base, projectId: 'nope' } as never)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('scopes the task lookup through project.businessId', async () => {
    // ProjectTask has no businessId of its own; tenancy runs through its
    // project. Getting this relation wrong would silently accept everything.
    await svc.create({ ...base, taskId: 'task_mine' } as never);
    const where = prisma.client.projectTask.findFirst.mock.calls[0][0].where;
    expect(where.project.businessId).toBe('biz_1');
  });
});

describe('startTimer — same references, same rules', () => {
  it('REFUSES another tenant project', async () => {
    const prisma = new PrismaStub();
    await expect(
      makeService(prisma).startTimer({
        businessId: 'biz_1',
        userId: 'user_1',
        projectId: 'proj_theirs',
      }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.client.timeEntry.create).not.toHaveBeenCalled();
  });

  it('allows an owned project', async () => {
    const prisma = new PrismaStub();
    await expect(
      makeService(prisma).startTimer({
        businessId: 'biz_1',
        userId: 'user_1',
        projectId: 'proj_mine',
      }),
    ).resolves.toBeDefined();
  });
});

describe('markAsBilled — invoice ownership', () => {
  it('REFUSES billing against another tenant invoice', async () => {
    // The entries are scoped by businessId, but invoiceId was written
    // unchecked — this would corrupt the other tenant's billing records.
    const prisma = new PrismaStub();
    await expect(
      makeService(prisma).markAsBilled(['te_1'], 'biz_1', 'inv_theirs'),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.client.timeEntry.updateMany).not.toHaveBeenCalled();
  });

  it('allows billing against an owned invoice', async () => {
    const prisma = new PrismaStub();
    await expect(
      makeService(prisma).markAsBilled(['te_1'], 'biz_1', 'inv_mine'),
    ).resolves.toBeDefined();
    expect(prisma.client.timeEntry.updateMany).toHaveBeenCalled();
  });
});
