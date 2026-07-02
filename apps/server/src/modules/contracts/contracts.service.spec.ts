import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { vi } from 'vitest';
import { ContractsService } from './contracts.service';
import { DocumentIntelligenceService } from '../ai/document-intelligence.service';
import { PrismaService } from '../../core/prisma/prisma.service';

const createMockPrisma = () => {
  const state = {
    contracts: [] as any[],
    contractParties: [] as any[],
    contractTerms: [] as any[],
    contractVersions: [] as any[],
    contractAlerts: [] as any[],
    contractTags: [] as any[],
    contractTagOnContracts: [] as any[],
    assets: [] as any[],
    documentInstances: [] as any[],
    driveIntakeFiles: [] as any[],
  };

  const mockClient = {
    contract: {
      findMany: vi.fn((q: any) => {
        let result = state.contracts.filter((c) => c.businessId === q.where?.businessId);
        if (q.where?.status) result = result.filter((c) => c.status === q.where.status);
        return Promise.resolve(result.map((c) => ({ ...c, parties: [], tags: [], _count: { alerts: 0, terms: 0, versions: 0 } })));
      }),
      findFirst: vi.fn((q: any) => {
        const c = state.contracts.find((x) => x.id === q.where?.id && x.businessId === q.where?.businessId);
        if (!c) return Promise.resolve(null);
        return Promise.resolve({
          ...c,
          parties: state.contractParties.filter((p) => p.contractId === c.id),
          terms: state.contractTerms.filter((t) => t.contractId === c.id),
          versions: state.contractVersions.filter((v) => v.contractId === c.id),
          alerts: state.contractAlerts.filter((a) => a.contractId === c.id),
          tags: state.contractTagOnContracts.filter((m) => m.contractId === c.id).map((m) => ({ tag: state.contractTags.find((t) => t.id === m.tagId) })),
        });
      }),
      create: vi.fn((args: any) => {
        const created = { id: `c_${state.contracts.length + 1}` };
        for (const [k, v] of Object.entries(args.data)) {
          if (k === 'parties' || k === 'tags') continue;
          (created as any)[k] = v;
        }
        state.contracts.push(created);

        if (args.data.parties?.create) {
          for (const p of args.data.parties.create) {
            state.contractParties.push({ id: `p_${state.contractParties.length + 1}`, contractId: created.id, ...p });
          }
        }
        if (args.data.tags?.create) {
          for (const m of args.data.tags.create) {
            state.contractTagOnContracts.push({ contractId: created.id, tagId: m.tag.connect.id });
          }
        }
        return Promise.resolve(created);
      }),
      update: vi.fn((args: any) => {
        const idx = state.contracts.findIndex((x) => x.id === args.where.id);
        state.contracts[idx] = { ...state.contracts[idx], ...args.data };
        return Promise.resolve(state.contracts[idx]);
      }),
      delete: vi.fn((args: any) => {
        state.contracts = state.contracts.filter((x) => x.id !== args.where.id);
        return Promise.resolve({});
      }),
      groupBy: vi.fn(() => Promise.resolve([])),
      count: vi.fn(() => Promise.resolve(0)),
    },
    contractParty: {
      createMany: vi.fn((args: any) => { state.contractParties.push(...(args.data ?? [])); return Promise.resolve({ count: args.data?.length ?? 0 }); }),
      deleteMany: vi.fn((args: any) => { state.contractParties = state.contractParties.filter((p) => p.contractId !== args.where.contractId); return Promise.resolve({ count: 0 }); }),
    },
    contractTerm: {
      createMany: vi.fn((args: any) => { state.contractTerms.push(...(args.data ?? [])); return Promise.resolve({ count: args.data?.length ?? 0 }); }),
      deleteMany: vi.fn((args: any) => { state.contractTerms = state.contractTerms.filter((t) => t.contractId !== args.where.contractId); return Promise.resolve({ count: 0 }); }),
    },
    contractVersion: {
      create: vi.fn((args: any) => { const v = { id: `v_${state.contractVersions.length + 1}`, ...args.data }; state.contractVersions.push(v); return Promise.resolve(v); }),
      findMany: vi.fn((args: any) => Promise.resolve(state.contractVersions.filter((v) => v.contractId === args.where?.contractId).sort((a, b) => b.versionNumber - a.versionNumber))),
    },
    contractAlert: {
      createMany: vi.fn((args: any) => { state.contractAlerts.push(...(args.data ?? [])); return Promise.resolve({ count: args.data?.length ?? 0 }); }),
      deleteMany: vi.fn((args: any) => { state.contractAlerts = state.contractAlerts.filter((a) => a.contractId !== args.where.contractId); return Promise.resolve({ count: 0 }); }),
      findFirst: vi.fn((q: any) => Promise.resolve(state.contractAlerts.find((a) => a.id === q.where?.id))),
      update: vi.fn((args: any) => { const a = state.contractAlerts.find((x) => x.id === args.where.id); Object.assign(a, args.data); return Promise.resolve(a); }),
      count: vi.fn(() => Promise.resolve(0)),
    },
    contractTag: {
      findMany: vi.fn(() => Promise.resolve(state.contractTags)),
      create: vi.fn((args: any) => { const t = { id: `tag_${state.contractTags.length + 1}`, ...args.data }; state.contractTags.push(t); return Promise.resolve(t); }),
      deleteMany: vi.fn((args: any) => { state.contractTags = state.contractTags.filter((t) => t.id !== args.where.id); return Promise.resolve({ count: 0 }); }),
    },
    contractTagOnContract: {
      createMany: vi.fn((args: any) => { state.contractTagOnContracts.push(...(args.data ?? [])); return Promise.resolve({ count: args.data?.length ?? 0 }); }),
      deleteMany: vi.fn((args: any) => { state.contractTagOnContracts = state.contractTagOnContracts.filter((m) => m.contractId !== args.where.contractId); return Promise.resolve({ count: 0 }); }),
    },
    asset: {
      findFirst: vi.fn((q: any) => Promise.resolve(state.assets.find((a) => a.id === q.where?.id))),
    },
    documentInstance: {
      findFirst: vi.fn((q: any) => Promise.resolve(state.documentInstances.find((d) => d.id === q.where?.id))),
    },
    driveIntakeFile: {
      findFirst: vi.fn((q: any) => Promise.resolve(state.driveIntakeFiles.find((f) => f.driveFileId === q.where?.driveFileId))),
    },
    $transaction: vi.fn(async (fn: any) => {
      const txClient = { ...mockClient };
      return fn(txClient);
    }),
  };

  return { mockClient, state };
};

describe('ContractsService', () => {
  let service: ContractsService;
  let prisma: ReturnType<typeof createMockPrisma>['mockClient'];

  beforeEach(async () => {
    const { mockClient } = createMockPrisma();
    prisma = mockClient;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractsService,
        { provide: PrismaService, useValue: { client: prisma } },
        { provide: DocumentIntelligenceService, useValue: { extractFromDocument: vi.fn() } },
        { provide: EventEmitter2, useValue: {} },
      ],
    }).compile();

    service = module.get<ContractsService>(ContractsService);
  });

  it('should create a contract with parties and version', async () => {
    const result = await service.createContract('biz_1', {
      title: 'Service Agreement',
      contractType: 'SERVICE_AGREEMENT',
      status: 'ACTIVE' as any,
      parties: [{ role: 'client', name: 'Acme Corp', email: 'legal@acme.com' }],
    });

    expect(result.title).toBe('Service Agreement');
    expect(result.parties.length).toBe(1);
  });

  it('should regenerate expiry alerts', async () => {
    const created = await service.createContract('biz_1', {
      title: 'Lease',
      status: 'ACTIVE' as any,
      expiryDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    });

    const contract = await service.getContract('biz_1', created.id);
    expect(contract.alerts.some((a: any) => a.alertType === 'EXPIRY_7')).toBe(true);
  });

  it('should apply extraction result and update terms', async () => {
    const created = await service.createContract('biz_1', { title: 'NDA', status: 'DRAFT' as any });

    await service.applyExtractionResult('biz_1', created.id, {
      documentType: 'contract',
      confidence: 0.9,
      contractData: {
        contractType: 'NDA',
        effectiveDate: '2025-01-01',
        expiryDate: '2026-01-01',
        renewalType: 'manual',
        contractValue: 1000,
        currency: 'TTD',
        parties: [{ role: 'client', name: 'Acme' }],
        keyClauses: ['Confidentiality'],
        rawText: '...',
        confidence: 0.9,
      },
      rawText: '...',
      suggestedActions: [],
    });

    const contract = await service.getContract('biz_1', created.id);
    expect(contract.terms.some((t: any) => t.termKey === 'key_clauses')).toBe(true);
    expect(contract.contractType).toBe('NDA');
  });
});
