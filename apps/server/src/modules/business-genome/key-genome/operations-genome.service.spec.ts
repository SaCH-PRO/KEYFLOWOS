import { describe, expect, it, vi } from 'vitest';
import { OperationsGenomeService } from './operations-genome.service';
import type {
  GenomeDeliveryCapabilityData,
  GenomeOperationalProcessData,
} from './key-genome.types';

function makeService() {
  const storedSnapshots: any[] = [];
  const storedMemory: any[] = [];
  let nextSnapshotId = 1;
  let nextSignalId = 1;
  let nextRecId = 1;

  const prisma = {
    client: {
      genomeOperationsSnapshot: {
        create: vi.fn(async ({ data }: { data: any }) => {
          const row = { id: `opsnap_${nextSnapshotId++}`, ...data };
          storedSnapshots.push(row);
          return row;
        }),
        findFirst: vi.fn(async ({ where }: { where: any }) => {
          const matches = storedSnapshots.filter(
            (r) => r.businessId === where.businessId && (where.period === undefined || r.period === where.period),
          );
          matches.sort((a: any, b: any) => new Date(b.computedAt).getTime() - new Date(a.computedAt).getTime());
          return matches[0] ?? null;
        }),
        findMany: vi.fn(async ({ where, take }: { where: any; take?: number }) => {
          let results = storedSnapshots.filter((r) => r.businessId === where.businessId);
          if (where.period !== undefined) results = results.filter((r) => r.period === where.period);
          if (where.overallRisk) results = results.filter((r) => r.overallRisk === where.overallRisk);
          results.sort((a: any, b: any) => new Date(b.computedAt).getTime() - new Date(a.computedAt).getTime());
          return results.slice(0, take);
        }),
      },
    },
  } as any;

  const processes = {
    listProcesses: vi.fn().mockResolvedValue([]),
    upsertProcess: vi.fn().mockResolvedValue({}),
    deleteProcess: vi.fn().mockResolvedValue({ deleted: true }),
  };

  const capabilities = {
    listCapabilities: vi.fn().mockResolvedValue([]),
    upsertCapability: vi.fn().mockResolvedValue({}),
    deleteCapability: vi.fn().mockResolvedValue({ deleted: true }),
  };

  const financeGenome = {
    getLatestFinanceSnapshot: vi.fn().mockResolvedValue(null),
  };

  const customerSalesGenome = {
    getLatestCustomerSalesSnapshot: vi.fn().mockResolvedValue(null),
  };

  const signals = {
    createSignals: vi.fn().mockImplementation(async (inputs: any[]) => {
      return inputs.map((input) => ({
        id: `sig_${nextSignalId++}`,
        businessId: input.businessId,
        signalType: input.signalType,
        section: input.section,
        domain: input.domain,
        field: input.field,
        reason: input.reason,
        confidence: input.confidence,
        status: 'NEW',
        evidence: [],
        createdAt: new Date().toISOString(),
        reviewedAt: null,
      }));
    }),
  };

  const recommendations = {
    createRecommendation: vi.fn().mockImplementation(async (input: any) => ({
      id: `rec_${nextRecId++}`,
      ...input,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      reviewedAt: null,
      outcomeTrackedAt: null,
    })),
  };

  const memory = {
    createMemoryEvent: vi.fn().mockImplementation(async (input: any) => {
      const row = { id: `mem_${storedMemory.length + 1}`, ...input, createdAt: new Date() };
      storedMemory.push(row);
      return row;
    }),
  };

  const departmentReadiness = {
    computeOneDepartment: vi.fn().mockResolvedValue({ code: 'COO_OPERATIONS' }),
  };

  const service = new OperationsGenomeService(
    prisma,
    processes as any,
    capabilities as any,
    financeGenome as any,
    customerSalesGenome as any,
    signals as any,
    recommendations as any,
    memory as any,
    departmentReadiness as any,
  );

  return {
    service,
    prisma,
    processes,
    capabilities,
    financeGenome,
    customerSalesGenome,
    signals,
    recommendations,
    memory,
    departmentReadiness,
    storedSnapshots,
    storedMemory,
  };
}

function makeProcess(overrides: Partial<GenomeOperationalProcessData> = {}): GenomeOperationalProcessData {
  return {
    id: 'proc_1',
    businessId: 'biz_1',
    name: 'Order Fulfillment',
    processType: 'FULFILLMENT',
    description: null,
    ownerRole: null,
    frequency: null,
    documented: true,
    hasSop: true,
    averageCycleTimeHours: null,
    failureRate: 0.02,
    reworkRate: 0.01,
    handoffCount: 2,
    automationCandidate: false,
    autonomySensitive: false,
    maturityScore: 80,
    riskLevel: 'LOW',
    confidence: 0.85,
    bottlenecks: [],
    missingInputs: [],
    recommendations: [],
    sourceModule: null,
    sourceEntityType: null,
    sourceEntityId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeCapability(overrides: Partial<GenomeDeliveryCapabilityData> = {}): GenomeDeliveryCapabilityData {
  return {
    id: 'cap_1',
    businessId: 'biz_1',
    name: 'Implementation',
    capabilityType: 'SERVICE',
    description: null,
    currentCapacity: 100,
    maxCapacity: 120,
    capacityUnit: 'hours',
    utilizationRate: 0.7,
    backlogVolume: 5,
    averageLeadTimeDays: 7,
    qualityScore: 85,
    reliabilityScore: 90,
    riskLevel: 'LOW',
    confidence: 0.85,
    constraints: [],
    dependencies: [],
    recommendations: [],
    sourceModule: null,
    sourceEntityType: null,
    sourceEntityId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('OperationsGenomeService', () => {
  it('computes snapshot with complete data', async () => {
    const { service, processes, capabilities, financeGenome, customerSalesGenome } = makeService();
    processes.listProcesses.mockResolvedValue([makeProcess()]);
    capabilities.listCapabilities.mockResolvedValue([makeCapability()]);
    financeGenome.getLatestFinanceSnapshot.mockResolvedValue({ id: 'fin_1', overallRisk: 'LOW' });
    customerSalesGenome.getLatestCustomerSalesSnapshot.mockResolvedValue({ id: 'cs_1', overallRisk: 'LOW' });

    const snapshot = await service.computeOperationsSnapshot('biz_1');

    expect(snapshot.processCount).toBe(1);
    expect(snapshot.sopCoverageRate).toBe(1);
    expect(snapshot.overallRisk).toBe('LOW');
    expect(snapshot.deliveryReadinessScore).toBeGreaterThan(0);
    expect(snapshot.missingInputs.length).toBe(0);
  });

  it('detects low SOP coverage', async () => {
    const { service, processes } = makeService();
    processes.listProcesses.mockResolvedValue([
      makeProcess({ hasSop: false, documented: false, processType: 'DELIVERY' }),
      makeProcess({ hasSop: false, documented: false, processType: 'SUPPORT' }),
    ]);

    const snapshot = await service.computeOperationsSnapshot('biz_1');

    expect(snapshot.sopCoverageRate).toBe(0);
    expect(snapshot.sopRisk).toBe('HIGH');
    expect(snapshot.warnings.some((w) => w.code === 'LOW_SOP_COVERAGE')).toBe(true);
  });

  it('detects critical capacity risk', async () => {
    const { service, capabilities } = makeService();
    capabilities.listCapabilities.mockResolvedValue([makeCapability({ utilizationRate: 1.2 })]);

    const snapshot = await service.computeOperationsSnapshot('biz_1');

    expect(snapshot.capacityRisk).toBe('CRITICAL');
    expect(snapshot.overallRisk).toBe('CRITICAL');
    expect(snapshot.overloadedCapabilityCount).toBe(1);
    expect(snapshot.warnings.some((w) => w.code === 'CAPACITY_RISK')).toBe(true);
  });

  it('detects high quality risk', async () => {
    const { service, processes } = makeService();
    processes.listProcesses.mockResolvedValue([makeProcess({ failureRate: 0.2, riskLevel: 'HIGH' })]);

    const snapshot = await service.computeOperationsSnapshot('biz_1');

    expect(snapshot.qualityRisk).toBe('HIGH');
    expect(snapshot.highRiskProcessCount).toBe(1);
    expect(snapshot.warnings.some((w) => w.code === 'QUALITY_RISK')).toBe(true);
  });

  it('identifies missing operations inputs', async () => {
    const { service } = makeService();

    const snapshot = await service.computeOperationsSnapshot('biz_1');

    expect(snapshot.missingInputs.length).toBeGreaterThan(0);
    expect(snapshot.missingInputs).toContain('operational_processes');
    expect(snapshot.missingInputs).toContain('delivery_capabilities');
  });

  it('writes memory event on snapshot compute', async () => {
    const { service, memory } = makeService();

    await service.computeOperationsSnapshot('biz_1');

    expect(memory.createMemoryEvent).toHaveBeenCalled();
    const call = memory.createMemoryEvent.mock.calls[0][0];
    expect(call.eventType).toBe('OPERATIONS_SNAPSHOT_COMPUTED');
  });

  it('recomputes relevant departments after snapshot', async () => {
    const { service, departmentReadiness } = makeService();

    await service.computeOperationsSnapshot('biz_1');

    expect(departmentReadiness.computeOneDepartment).toHaveBeenCalledWith('biz_1', 'COO_OPERATIONS');
    expect(departmentReadiness.computeOneDepartment).toHaveBeenCalledWith('biz_1', 'PRODUCT_SERVICE');
    expect(departmentReadiness.computeOneDepartment).toHaveBeenCalledWith('biz_1', 'CUSTOMER_SUCCESS');
  });

  it('recomputes CEO_STRATEGY when overall risk is critical', async () => {
    const { service, departmentReadiness, capabilities } = makeService();
    capabilities.listCapabilities.mockResolvedValue([makeCapability({ utilizationRate: 1.3 })]);

    await service.computeOperationsSnapshot('biz_1');

    expect(departmentReadiness.computeOneDepartment).toHaveBeenCalledWith('biz_1', 'CEO_STRATEGY');
  });

  it('generates operations signals from snapshot', async () => {
    const { service, processes, signals } = makeService();
    processes.listProcesses.mockResolvedValue([makeProcess({ failureRate: 0.2, riskLevel: 'HIGH' })]);

    await service.computeOperationsSnapshot('biz_1');
    const generated = await service.generateOperationsSignals('biz_1');

    expect(signals.createSignals).toHaveBeenCalled();
    expect(generated.length).toBeGreaterThan(0);
    expect(generated[0].businessId).toBe('biz_1');
  });

  it('generates operations recommendations from snapshot', async () => {
    const { service, processes, recommendations } = makeService();
    processes.listProcesses.mockResolvedValue([makeProcess({ hasSop: false, processType: 'DELIVERY' })]);

    await service.computeOperationsSnapshot('biz_1');
    const generated = await service.generateOperationsRecommendations('biz_1');

    expect(recommendations.createRecommendation).toHaveBeenCalled();
    expect(generated.length).toBeGreaterThan(0);
  });

  it('lists operations snapshots', async () => {
    const { service, processes } = makeService();
    processes.listProcesses.mockResolvedValue([makeProcess()]);

    await service.computeOperationsSnapshot('biz_1');
    await service.computeOperationsSnapshot('biz_1');
    const list = await service.listOperationsSnapshots('biz_1');

    expect(list.length).toBe(2);
  });
});
