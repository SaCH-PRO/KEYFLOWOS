/**
 * Change orders and retainers must not reference another tenant's rows.
 *
 * Both modules had undecorated @Body() DTOs, so the global ValidationPipe
 * (whitelist: true) deleted their foreign keys before the service saw them.
 * The endpoints were broken, and the missing ownership checks underneath were
 * unreachable as a side effect.
 *
 * ChangeOrder is the sharper case: the model has NO businessId column at all
 * (schema.prisma). Tenancy exists only through `project.businessId`, which is
 * how every read in the service scopes itself — but create() ignored it
 * entirely. The controller bound the route param to `_businessId` and never
 * used it.
 *
 * RetainerAgreement.contactId is a bare String with no Prisma relation, so
 * there is not even database-level FK enforcement behind it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ChangeOrderService } from './change-order.service';
import { RetainerService } from '../retainers/retainer.service';

const PROJECTS = new Map([
  ['proj_mine', 'biz_1'],
  ['proj_theirs', 'biz_2'],
]);
const CONTACTS = new Map([
  ['contact_mine', 'biz_1'],
  ['contact_theirs', 'biz_2'],
]);

function prismaStub() {
  return {
    client: {
      project: {
        findFirst: vi.fn(({ where }: { where: { id: string; businessId: string } }) =>
          Promise.resolve(PROJECTS.get(where.id) === where.businessId ? { id: where.id } : null),
        ),
      },
      contact: {
        findFirst: vi.fn(({ where }: { where: { id: string; businessId: string } }) =>
          Promise.resolve(CONTACTS.get(where.id) === where.businessId ? { id: where.id } : null),
        ),
      },
      changeOrder: {
        create: vi.fn(({ data }: { data: unknown }) => Promise.resolve({ id: 'co_1', ...(data as object) })),
      },
      retainerAgreement: {
        create: vi.fn(({ data }: { data: unknown }) => Promise.resolve({ id: 'ra_1', ...(data as object) })),
      },
    },
  };
}

describe('ChangeOrderService.create — project ownership', () => {
  let prisma: ReturnType<typeof prismaStub>;
  let svc: ChangeOrderService;

  beforeEach(() => {
    prisma = prismaStub();
    svc = new ChangeOrderService(prisma as never);
  });

  const input = { projectId: 'proj_mine', title: 'Extra work' };

  it('creates against a project the business owns', async () => {
    await expect(svc.create(input as never, 'biz_1')).resolves.toBeDefined();
    expect(prisma.client.changeOrder.create).toHaveBeenCalled();
  });

  it('REFUSES a project belonging to another business', async () => {
    // Without this the change order would be attached to another tenant's
    // project and readable back through listByProject.
    await expect(
      svc.create({ ...input, projectId: 'proj_theirs' } as never, 'biz_1'),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.client.changeOrder.create).not.toHaveBeenCalled();
  });

  it('REFUSES a project that does not exist', async () => {
    await expect(
      svc.create({ ...input, projectId: 'ghost' } as never, 'biz_1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('scopes the lookup by the caller businessId, not by project id alone', async () => {
    await svc.create(input as never, 'biz_1');
    const where = prisma.client.project.findFirst.mock.calls[0][0].where;
    expect(where).toEqual({ id: 'proj_mine', businessId: 'biz_1' });
  });
});

describe('RetainerService.create — contact ownership', () => {
  let prisma: ReturnType<typeof prismaStub>;
  let svc: RetainerService;

  beforeEach(() => {
    prisma = prismaStub();
    svc = new RetainerService(prisma as never);
  });

  const input = {
    businessId: 'biz_1',
    contactId: 'contact_mine',
    name: 'Monthly retainer',
    monthlyAmount: 1000,
    startDate: new Date('2026-01-01'),
  };

  it('creates against a contact the business owns', async () => {
    await expect(svc.create(input as never)).resolves.toBeDefined();
    expect(prisma.client.retainerAgreement.create).toHaveBeenCalled();
  });

  it('REFUSES a contact belonging to another business', async () => {
    await expect(
      svc.create({ ...input, contactId: 'contact_theirs' } as never),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.client.retainerAgreement.create).not.toHaveBeenCalled();
  });

  it('REFUSES a contact id that does not exist', async () => {
    // contactId has no Prisma relation, so nothing downstream would have
    // caught this — the row would simply carry a dangling reference.
    await expect(svc.create({ ...input, contactId: 'ghost' } as never)).rejects.toThrow(
      NotFoundException,
    );
  });
});
