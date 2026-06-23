import { describe, expect, it, vi } from 'vitest';
import { GenomeDepartmentService } from './genome-department.service';
import { KEY_GENOME_DEPARTMENTS } from './key-genome-departments';
import type { GenomeDepartmentData } from './key-genome.types';

function makePrisma() {
  const stored: any[] = [];
  let nextId = 1;

  const prisma = {
    client: {
      genomeDepartment: {
        findUnique: vi.fn().mockImplementation(({ where }: { where: any }) => {
          if (where.id) {
            return Promise.resolve(stored.find((r) => r.id === where.id) ?? null);
          }
          if (where.businessId_code) {
            return Promise.resolve(
              stored.find(
                (r) =>
                  r.businessId === where.businessId_code.businessId &&
                  r.code === where.businessId_code.code,
              ) ?? null,
            );
          }
          return Promise.resolve(null);
        }),
        findMany: vi.fn().mockImplementation(({ where }: { where?: any }) => {
          let results = [...stored];
          if (where?.businessId) {
            results = results.filter((r) => r.businessId === where.businessId);
          }
          if (where?.riskLevel) {
            results = results.filter((r) => r.riskLevel === where.riskLevel);
          }
          if (where?.automationAllowed !== undefined) {
            results = results.filter((r) => r.automationAllowed === where.automationAllowed);
          }
          if (where?.readinessScore?.gte !== undefined) {
            results = results.filter((r) => r.readinessScore >= where.readinessScore.gte);
          }
          return Promise.resolve(results);
        }),
        create: vi.fn().mockImplementation(({ data }: { data: any }) => {
          const row = {
            id: `dept_${nextId++}`,
            ...data,
            businessId: data.business?.connect?.id ?? data.businessId,
            description: data.description ?? null,
            maturityScore: data.maturityScore ?? 0,
            readinessScore: data.readinessScore ?? 0,
            confidenceScore: data.confidenceScore ?? 0,
            riskLevel: data.riskLevel ?? 'MEDIUM',
            automationAllowed: data.automationAllowed ?? false,
            gapSummary: data.gapSummary ?? [],
            recommendedActions: data.recommendedActions ?? [],
            lastComputedAt: data.lastComputedAt ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          stored.push(row);
          return Promise.resolve(row);
        }),
        update: vi.fn().mockImplementation(({ where, data }: { where: { id: string }; data: any }) => {
          const idx = stored.findIndex((r) => r.id === where.id);
          if (idx === -1) throw new Error('Not found');
          stored[idx] = { ...stored[idx], ...data, updatedAt: new Date() };
          return Promise.resolve(stored[idx]);
        }),
      },
    },
  } as any;

  return { prisma, stored };
}

function makeService() {
  const { prisma, stored } = makePrisma();
  const service = new GenomeDepartmentService(prisma);
  return { service, prisma, stored };
}

describe('GenomeDepartmentService', () => {
  it('seeds default departments', async () => {
    const { service } = makeService();
    const departments = await service.seedDepartments('biz_1');
    expect(departments).toHaveLength(KEY_GENOME_DEPARTMENTS.length);
    expect(departments.map((d) => d.code)).toEqual(KEY_GENOME_DEPARTMENTS.map((d) => d.code));
    expect(departments.every((d) => d.businessId === 'biz_1')).toBe(true);
  });

  it('seed is idempotent and updates metadata without duplicate rows', async () => {
    const { service, stored } = makeService();
    await service.seedDepartments('biz_1');
    const firstCount = stored.length;

    const updated = await service.seedDepartments('biz_1');
    expect(stored.length).toBe(firstCount);
    expect(updated).toHaveLength(KEY_GENOME_DEPARTMENTS.length);
  });

  it('lists departments', async () => {
    const { service } = makeService();
    await service.seedDepartments('biz_1');
    const departments = await service.listDepartments('biz_1');
    expect(departments.length).toBe(KEY_GENOME_DEPARTMENTS.length);
  });

  it('filters departments by risk level', async () => {
    const { service } = makeService();
    await service.seedDepartments('biz_1');

    const highRisk = await service.listDepartments('biz_1', { riskLevel: 'HIGH' });
    expect(highRisk.length).toBe(0);

    await service.upsertDepartmentSnapshot('biz_1', {
      code: 'CFO_FINANCE',
      riskLevel: 'HIGH',
    } as Partial<GenomeDepartmentData> & { code: string });

    const after = await service.listDepartments('biz_1', { riskLevel: 'HIGH' });
    expect(after.length).toBe(1);
    expect(after[0].code).toBe('CFO_FINANCE');
  });

  it('filters departments by automationAllowed', async () => {
    const { service } = makeService();
    await service.seedDepartments('biz_1');

    await service.upsertDepartmentSnapshot('biz_1', {
      code: 'CMO_MARKETING',
      automationAllowed: true,
    } as Partial<GenomeDepartmentData> & { code: string });

    const ready = await service.listDepartments('biz_1', { automationAllowed: true });
    expect(ready.length).toBe(1);
    expect(ready[0].code).toBe('CMO_MARKETING');
  });

  it('filters departments by minReadinessScore', async () => {
    const { service } = makeService();
    await service.seedDepartments('biz_1');

    await service.upsertDepartmentSnapshot('biz_1', {
      code: 'SALES',
      readinessScore: 82,
    } as Partial<GenomeDepartmentData> & { code: string });

    const filtered = await service.listDepartments('biz_1', { minReadinessScore: 80 });
    expect(filtered.length).toBe(1);
    expect(filtered[0].code).toBe('SALES');
  });

  it('gets department by code', async () => {
    const { service } = makeService();
    await service.seedDepartments('biz_1');
    const department = await service.getDepartment('biz_1', 'CEO_STRATEGY');
    expect(department.code).toBe('CEO_STRATEGY');
    expect(department.name).toBe('CEO / Strategy');
  });

  it('throws when getting unknown department', async () => {
    const { service } = makeService();
    await expect(service.getDepartment('biz_1', 'UNKNOWN')).rejects.toThrow('not found');
  });

  it('upserts computed department snapshots', async () => {
    const { service } = makeService();
    await service.seedDepartments('biz_1');

    const updated = await service.upsertDepartmentSnapshot('biz_1', {
      code: 'CFO_FINANCE',
      maturityScore: 72,
      readinessScore: 68,
      confidenceScore: 55,
      riskLevel: 'MEDIUM',
      automationAllowed: false,
      gapSummary: [
        { type: 'MISSING_FACT', domain: 'finance', field: 'cost_structure', reason: 'Missing cost structure', impact: 'DEGRADED' },
      ],
      recommendedActions: [{ label: 'Add cost structure', reason: 'Required for finance readiness', priority: 'HIGH' }],
    } as Partial<GenomeDepartmentData> & { code: string });

    expect(updated.maturityScore).toBe(72);
    expect(updated.readinessScore).toBe(68);
    expect(updated.confidenceScore).toBe(55);
    expect(updated.riskLevel).toBe('MEDIUM');
    expect(updated.automationAllowed).toBe(false);
    expect(updated.gapSummary).toHaveLength(1);
    expect(updated.recommendedActions).toHaveLength(1);
    expect(updated.lastComputedAt).toBeTruthy();
  });

  it('builds summary with strongest/weakest/blocked/ready departments', async () => {
    const { service } = makeService();
    await service.seedDepartments('biz_1');

    // Push several departments high so CFO (0) is guaranteed in the bottom 5.
    const highMaturityCodes = [
      'CEO_STRATEGY',
      'COO_OPERATIONS',
      'CMO_MARKETING',
      'SALES',
      'CUSTOMER_SUCCESS',
      'PRODUCT_SERVICE',
      'HR_STAFFING',
      'LEGAL_COMPLIANCE',
    ];
    for (const code of highMaturityCodes) {
      await service.upsertDepartmentSnapshot('biz_1', {
        code,
        maturityScore: code === 'CMO_MARKETING' ? 100 : 95,
        readinessScore: 90,
        riskLevel: 'LOW',
        automationAllowed: true,
      } as Partial<GenomeDepartmentData> & { code: string });
    }

    await service.upsertDepartmentSnapshot('biz_1', {
      code: 'CFO_FINANCE',
      maturityScore: 0,
      readinessScore: 25,
      riskLevel: 'CRITICAL',
      automationAllowed: false,
    } as Partial<GenomeDepartmentData> & { code: string });

    await service.upsertDepartmentSnapshot('biz_1', {
      code: 'TECH_DATA',
      maturityScore: 90,
      readinessScore: 88,
      riskLevel: 'LOW',
      automationAllowed: true,
    } as Partial<GenomeDepartmentData> & { code: string });

    const summary = await service.summary('biz_1');
    expect(summary.businessId).toBe('biz_1');
    expect(summary.departments).toHaveLength(KEY_GENOME_DEPARTMENTS.length);

    const cfoInSummary = summary.departments.find((d) => d.code === 'CFO_FINANCE');
    expect(cfoInSummary?.maturityScore).toBe(0);
    expect(cfoInSummary?.readinessScore).toBe(25);

    expect(summary.strongestDepartments[0].code).toBe('CMO_MARKETING');
    expect(summary.weakestDepartments.some((d) => d.code === 'CFO_FINANCE')).toBe(true);
    expect(summary.blockedDepartments.some((d) => d.code === 'CFO_FINANCE')).toBe(true);
    expect(summary.automationReadyDepartments.some((d) => d.code === 'CMO_MARKETING')).toBe(true);
    expect(typeof summary.overallDepartmentMaturity).toBe('number');
    expect(typeof summary.overallDepartmentReadiness).toBe('number');
  });
});
