import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnifiedMemoryRetrievalService } from '../unified-memory-retrieval.service';

/**
 * Retrieval-quality evals for the unified memory layer.
 *
 * These tests exercise ranking, source-type filtering, and episodic inclusion
 * without requiring a real database.
 */

function makePrisma(overrides?: Partial<any>) {
  const defaults = {
    aiMemory: { findMany: vi.fn().mockResolvedValue([]) },
    genomeMemoryEvent: { findMany: vi.fn().mockResolvedValue([]) },
    temporalFlowMemory: { findMany: vi.fn().mockResolvedValue([]) },
    cognitionMemory: { findMany: vi.fn().mockResolvedValue([]) },
    cognitiveEvent: { findMany: vi.fn().mockResolvedValue([]) },
    businessEvent: { findMany: vi.fn().mockResolvedValue([]) },
    aiExecutionLog: { findMany: vi.fn().mockResolvedValue([]) },
    cortexActionLog: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return {
    client: { ...defaults, ...overrides },
  };
}

function makeSemanticMemory(overrides?: Partial<any>) {
  return {
    search: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('KeyCortexMemoryRetrieval evals', () => {
  let service: UnifiedMemoryRetrievalService;

  beforeEach(() => {
    service = new UnifiedMemoryRetrievalService(makePrisma() as any, makeSemanticMemory() as any);
  });

  it('includes episodic sources', async () => {
    const now = new Date();
    const prisma = makePrisma({
      businessEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'be_1',
            eventType: 'invoice_paid',
            subjectType: 'invoice',
            subjectId: 'inv_1',
            actorType: 'system',
            actorId: 'key',
            action: 'update',
            before: null,
            after: { status: 'paid' },
            metadata: {},
            createdAt: now,
          },
        ]),
      },
      aiExecutionLog: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'aex_1',
            action: 'send_email',
            toolName: 'email_sender',
            module: 'communications',
            success: true,
            rationale: 'User requested update',
            inputSummary: {},
            outputSummary: {},
            errorMessage: null,
            metadata: {},
            createdAt: now,
          },
        ]),
      },
      cortexActionLog: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'cal_1',
            actionType: 'CREATE_TASK',
            status: 'success',
            description: 'Follow up with client',
            result: 'Task created',
            error: null,
            requiresApproval: false,
            estimatedImpact: 'medium',
            createdAt: now,
          },
        ]),
      },
    });

    service = new UnifiedMemoryRetrievalService(prisma as any, makeSemanticMemory() as any);
    const fragments = await service.retrieveContext('biz_1', {});

    expect(fragments.map((f) => f.sourceType).sort()).toEqual([
      'ai_execution_log',
      'business_event',
      'cortex_action_log',
    ]);
  });

  it('ranks recent + high-confidence fragments higher', async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 80 * 24 * 60 * 60 * 1000);
    const prisma = makePrisma({
      aiMemory: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'am_recent',
            category: 'preference',
            key: 'timezone',
            value: 'America/Port_of_Spain',
            confidence: 0.99,
            createdAt: now,
          },
          {
            id: 'am_old_low_conf',
            category: 'preference',
            key: 'currency',
            value: 'TTD',
            confidence: 0.5,
            createdAt: old,
          },
        ]),
      },
    });

    service = new UnifiedMemoryRetrievalService(prisma as any, makeSemanticMemory() as any);
    const fragments = await service.retrieveContext('biz_1', { limit: 2 });

    expect(fragments[0].id).toBe('am_recent');
    expect(fragments[1].id).toBe('am_old_low_conf');
    expect(fragments[0].rankScore).toBeGreaterThan(fragments[1].rankScore);
  });

  it('supports source-type filtering', async () => {
    const now = new Date();
    const prisma = makePrisma({
      aiMemory: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'am_1', category: 'pref', key: 'k1', value: 'v1', confidence: 1, createdAt: now },
        ]),
      },
      cortexActionLog: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'cal_1',
            actionType: 'CREATE_TASK',
            status: 'success',
            description: 'Follow up',
            result: null,
            error: null,
            requiresApproval: false,
            estimatedImpact: null,
            createdAt: now,
          },
        ]),
      },
    });

    service = new UnifiedMemoryRetrievalService(prisma as any, makeSemanticMemory() as any);
    const fragments = await service.retrieveContext('biz_1', {
      sourceTypes: ['cortex_action_log'],
    });

    expect(fragments).toHaveLength(1);
    expect(fragments[0].sourceType).toBe('cortex_action_log');
  });
});
