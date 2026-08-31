/**
 * Project deliverables are persisted, and scoped to their tenant.
 *
 * They lived entirely in React state — `useState<Deliverable[]>([])` in
 * project-detail.tsx — with no model, no routes, nothing stored. Typing one in
 * and switching tabs lost it.
 *
 * TWO THINGS THIS PINS, and the second is the one that will rot first.
 *
 * The deliverable id comes from the client on update and delete. A route guard
 * proves the CALLER belongs to the business; it cannot prove the RECORD does,
 * because the record id is a different parameter. That distinction has already
 * produced two live cross-tenant writes in this codebase, so every method
 * re-proves the project's ownership before touching anything.
 *
 * And ProjectDeliverable carries businessId DIRECTLY, unlike its sibling
 * ProjectMilestone, so the Prisma tenant extension can scope it. A model
 * arriving without that column arrives as debt on the unscoped ledger.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NotFoundException } from '@nestjs/common';
import { ProjectsService } from './projects.service';

const BIZ = 'biz_a';
const OTHER = 'biz_b';
const PROJECT = 'project_1';
const DELIVERABLE = 'deliverable_1';

function harness() {
  const projects = [{ id: PROJECT, businessId: BIZ }];
  const deliverables = [{ id: DELIVERABLE, projectId: PROJECT, businessId: BIZ }];
  const match = (rows: Array<Record<string, unknown>>, where: Record<string, unknown>) =>
    rows.filter((r) => Object.entries(where).every(([k, v]) => v === undefined || r[k] === v));

  const prisma = {
    client: {
      project: {
        findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
          match(projects, where)[0] ?? null,
        ),
      },
      projectDeliverable: {
        findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
          match(deliverables, where)[0] ?? null,
        ),
        findMany: vi.fn(async () => deliverables),
        create: vi.fn(async ({ data }: { data: unknown }) => data),
        update: vi.fn(async ({ data }: { data: unknown }) => data),
        delete: vi.fn(async () => ({})),
      },
    },
  };

  const svc = Object.create(ProjectsService.prototype) as ProjectsService;
  (svc as unknown as { prisma: unknown }).prisma = prisma;
  return { svc, prisma };
}

describe('deliverables belong to their project, and the project to its business', () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });

  it('lists them for the owner', async () => {
    await expect(h.svc.listDeliverables(PROJECT, BIZ)).resolves.toHaveLength(1);
  });

  it('refuses to list another business project', async () => {
    await expect(h.svc.listDeliverables(PROJECT, OTHER)).rejects.toThrow(NotFoundException);
  });

  it('refuses to create against another business project', async () => {
    await expect(
      h.svc.createDeliverable(PROJECT, OTHER, { title: 'Logo pack' }),
    ).rejects.toThrow(NotFoundException);
    expect(h.prisma.client.projectDeliverable.create).not.toHaveBeenCalled();
  });

  it('stamps the tenant on create rather than trusting the caller', async () => {
    await h.svc.createDeliverable(PROJECT, BIZ, { title: 'Logo pack' });
    expect(h.prisma.client.projectDeliverable.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ businessId: BIZ, projectId: PROJECT }) }),
    );
  });

  it('refuses to update a deliverable from another business', async () => {
    // The id is client-supplied. This is the shape that produced two live
    // cross-tenant writes elsewhere in this codebase.
    await expect(
      h.svc.updateDeliverable(DELIVERABLE, PROJECT, OTHER, { title: 'hijacked' }),
    ).rejects.toThrow(NotFoundException);
    expect(h.prisma.client.projectDeliverable.update).not.toHaveBeenCalled();
  });

  it('refuses to delete one from another business', async () => {
    await expect(
      h.svc.deleteDeliverable(DELIVERABLE, PROJECT, OTHER),
    ).rejects.toThrow(NotFoundException);
    expect(h.prisma.client.projectDeliverable.delete).not.toHaveBeenCalled();
  });

  it('lets the owner do both', async () => {
    await expect(h.svc.updateDeliverable(DELIVERABLE, PROJECT, BIZ, { title: 'ok' })).resolves.toBeTruthy();
    await expect(h.svc.deleteDeliverable(DELIVERABLE, PROJECT, BIZ)).resolves.toEqual({ deleted: true });
  });

  it('completedAt follows status, so the two cannot disagree', async () => {
    await h.svc.updateDeliverable(DELIVERABLE, PROJECT, BIZ, { status: 'DELIVERED' });
    const delivered = h.prisma.client.projectDeliverable.update.mock.calls[0][0].data;
    expect(delivered.completedAt).toBeInstanceOf(Date);

    await h.svc.updateDeliverable(DELIVERABLE, PROJECT, BIZ, { status: 'PENDING' });
    const pending = h.prisma.client.projectDeliverable.update.mock.calls[1][0].data;
    expect(pending.completedAt, 'moving back to PENDING must clear it').toBeNull();
  });
});

describe('the model was not added as unscoped debt', () => {
  const schema = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', '..', 'packages', 'db', 'prisma', 'schema.prisma'),
    'utf8',
  );
  const client = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', '..', 'packages', 'db', 'src', 'client.ts'),
    'utf8',
  );

  it('reads both files — this gate is not vacuous', () => {
    expect(schema).toContain('model ProjectDeliverable');
    expect(client).toContain('BUSINESS_ID_MODELS');
  });

  it('carries businessId directly, so the extension can scope it', () => {
    const block = schema.slice(
      schema.indexOf('model ProjectDeliverable'),
      schema.indexOf('}', schema.indexOf('@@map("project_deliverables")')),
    );
    expect(block).toContain('businessId String');
  });

  it('is in the scoped set from the day it was added', () => {
    const set = client.slice(
      client.indexOf('const BUSINESS_ID_MODELS = new Set(['),
      client.indexOf(']);', client.indexOf('const BUSINESS_ID_MODELS = new Set([')),
    );
    expect(set).toContain("'ProjectDeliverable'");
  });
});
