import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CrmSequenceSchedulerService } from '../src/modules/crm/crm-sequence-scheduler.service';
import type { SequenceGraph } from '../src/modules/crm/crm-sequence-graph.util';

type Enrollment = {
  id: string;
  status: 'active' | 'completed' | 'failed' | 'unenrolled';
  contactId: string;
  sequenceId: string;
  currentNodeId: string | null;
  nextStepAt: Date | null;
  startedAt: Date;
  completedAt: Date | null;
  metadata: Record<string, any>;
  sequence: {
    id: string;
    businessId: string;
    name: string;
    graph: SequenceGraph;
    steps: any;
  };
  contact: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    relationshipHealth: string | null;
    bestChannel: string | null;
  };
};

function makePrisma(enrollments: Enrollment[]) {
  return {
    client: {
      crmSequenceEnrollment: {
        findMany: vi.fn(async ({ where }: any) => {
          // basic filter for status + nextStepAt
          let result = enrollments.slice();
          if (where?.status) result = result.filter((e) => e.status === where.status);
          if (where?.nextStepAt?.lte) {
            const lte = where.nextStepAt.lte as Date;
            result = result.filter((e) => e.nextStepAt && e.nextStepAt.getTime() <= lte.getTime());
          }
          return result;
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const e = enrollments.find((x) => x.id === where.id);
          if (!e) throw new Error(`Enrollment ${where.id} not found`);
          Object.assign(e, data);
          return e;
        }),
      },
      outboundDelivery: { findUnique: vi.fn() },
    },
  };
}

function makeTimeline() {
  return { logEvent: vi.fn(async () => undefined) };
}

function makeEvents() {
  return { emit: vi.fn() };
}

function build(prisma: any, timeline: any = makeTimeline(), events: any = makeEvents()) {
  return new CrmSequenceSchedulerService(prisma as any, events as any, timeline as any);
}

function baseEnrollment(graph: SequenceGraph, overrides: Partial<Enrollment> = {}): Enrollment {
  return {
    id: 'enr-1',
    status: 'active',
    contactId: 'c-1',
    sequenceId: 'seq-1',
    currentNodeId: graph.nodes[0]?.id ?? null,
    nextStepAt: new Date(Date.now() - 1000),
    startedAt: new Date(Date.now() - 60_000),
    completedAt: null,
    metadata: {},
    sequence: {
      id: 'seq-1',
      businessId: 'biz-1',
      name: 'Test Sequence',
      graph,
      steps: [],
    },
    contact: {
      id: 'c-1',
      firstName: 'A',
      lastName: 'B',
      email: 'a@b.test',
      relationshipHealth: null,
      bestChannel: null,
    },
    ...overrides,
  };
}

describe('CrmSequenceSchedulerService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('variant stickiness across runs', () => {
    it('honors a pre-existing variantAssignments entry over the node\'s promotedVariantId', async () => {
      const graph: SequenceGraph = {
        nodes: [
          {
            id: 'send',
            type: 'email',
            data: {
              subject: 'fallback',
              body: 'fallback',
              promotedVariantId: 'v2',
              variants: [
                { id: 'v1', weight: 1, subject: 'A subj', body: 'A body' },
                { id: 'v2', weight: 1, subject: 'B subj', body: 'B body' },
              ],
            },
          },
          { id: 'end', type: 'end', data: {} },
        ],
        edges: [{ id: 'e', source: 'send', target: 'end', branch: 'default' }],
        startNodeId: 'send',
        version: 1,
      };
      const enr = baseEnrollment(graph, {
        metadata: { variantAssignments: { send: 'v1' } },
      });
      const prisma = makePrisma([enr]);
      const events = makeEvents();
      const svc = build(prisma, makeTimeline(), events);

      await svc.processDueEnrollments();

      expect(enr.metadata.variantAssignments.send).toBe('v1');
      expect(enr.metadata.stepEvents.send.variantId).toBe('v1');
      const emitted = events.emit.mock.calls.find((c) => c[0] === 'sequence.step_due');
      expect(emitted?.[1]?.variantId).toBe('v1');
    });

    it('picks a variant when none is assigned and persists the assignment for next time', async () => {
      const graph: SequenceGraph = {
        nodes: [
          {
            id: 'send',
            type: 'email',
            data: {
              variants: [{ id: 'only', weight: 1, subject: 's', body: 'b' }],
            },
          },
          { id: 'end', type: 'end', data: {} },
        ],
        edges: [{ id: 'e', source: 'send', target: 'end', branch: 'default' }],
        startNodeId: 'send',
        version: 1,
      };
      const enr = baseEnrollment(graph);
      const prisma = makePrisma([enr]);
      const svc = build(prisma);

      await svc.processDueEnrollments();
      expect(enr.metadata.variantAssignments.send).toBe('only');
      expect(enr.metadata.stepEvents.send.variantId).toBe('only');
    });
  });

  describe('branch wait-window pending behavior', () => {
    it('reschedules with pending status while inside the wait window, then resolves once it elapses', async () => {
      const graph: SequenceGraph = {
        nodes: [
          {
            id: 'br',
            type: 'branch',
            data: { condition: 'no_reply', waitForDays: 2 },
          },
          { id: 'yes', type: 'end', data: {} },
          { id: 'no', type: 'end', data: {} },
        ],
        edges: [
          { id: 'e-y', source: 'br', target: 'yes', branch: 'yes' },
          { id: 'e-n', source: 'br', target: 'no', branch: 'no' },
        ],
        startNodeId: 'br',
        version: 1,
      };
      const enr = baseEnrollment(graph, { currentNodeId: 'br' });
      const prisma = makePrisma([enr]);
      const svc = build(prisma);

      // First run: branch hasn't been entered yet → records branchEnteredAt and reschedules.
      await svc.processDueEnrollments();
      expect(enr.metadata.branchEnteredAt?.br).toBeDefined();
      expect(enr.status).toBe('active');
      expect(enr.currentNodeId).toBe('br');
      // Rescheduled ~1 hour out
      const delta = (enr.nextStepAt!.getTime() - Date.now()) / 1000;
      expect(delta).toBeGreaterThan(60 * 30); // > 30 min
      expect(delta).toBeLessThan(60 * 90); // < 90 min

      // Simulate the wait window having elapsed by backdating branchEnteredAt.
      enr.metadata.branchEnteredAt.br = new Date(Date.now() - 3 * 86400_000).toISOString();
      enr.nextStepAt = new Date(Date.now() - 1000);

      await svc.processDueEnrollments();
      // no_reply with no recorded reply → 'yes' branch
      expect(enr.currentNodeId).toBe('yes');
      // 'yes' is an end node, so processEnrollment's advanceTo completes the enrollment
      expect(enr.status).toBe('completed');
    });
  });

  describe('baseline health capture', () => {
    it('captures baselineHealth on first visit and crowns yes once health changes to target', async () => {
      const graph: SequenceGraph = {
        nodes: [
          {
            id: 'br',
            type: 'branch',
            data: {
              condition: 'relationship_health_changed_to',
              targetHealth: 'HOT',
              waitForDays: 30,
            },
          },
          { id: 'yes', type: 'end', data: {} },
          { id: 'no', type: 'end', data: {} },
        ],
        edges: [
          { id: 'e-y', source: 'br', target: 'yes', branch: 'yes' },
          { id: 'e-n', source: 'br', target: 'no', branch: 'no' },
        ],
        startNodeId: 'br',
        version: 1,
      };
      const enr = baseEnrollment(graph, {
        currentNodeId: 'br',
        contact: {
          id: 'c-1',
          firstName: 'A',
          lastName: 'B',
          email: 'a@b.test',
          relationshipHealth: 'WARM',
          bestChannel: null,
        },
      });
      const prisma = makePrisma([enr]);
      const svc = build(prisma);

      // First run: still at WARM (≠ target HOT) → pending, baseline captured.
      await svc.processDueEnrollments();
      expect(enr.metadata.baselineHealth).toBe('WARM');
      expect(enr.status).toBe('active');
      expect(enr.currentNodeId).toBe('br');

      // Health flips to target → next pass should branch yes.
      enr.contact.relationshipHealth = 'HOT';
      enr.nextStepAt = new Date(Date.now() - 1000);

      await svc.processDueEnrollments();
      expect(enr.currentNodeId).toBe('yes');
      expect(enr.status).toBe('completed');
    });

    it('does not crown yes when current already equals baseline (no real change)', async () => {
      const graph: SequenceGraph = {
        nodes: [
          {
            id: 'br',
            type: 'branch',
            data: {
              condition: 'relationship_health_changed_to',
              targetHealth: 'HOT',
              waitForDays: 1,
            },
          },
          { id: 'yes', type: 'end', data: {} },
          { id: 'no', type: 'end', data: {} },
        ],
        edges: [
          { id: 'e-y', source: 'br', target: 'yes', branch: 'yes' },
          { id: 'e-n', source: 'br', target: 'no', branch: 'no' },
        ],
        startNodeId: 'br',
        version: 1,
      };
      const enr = baseEnrollment(graph, {
        currentNodeId: 'br',
        contact: {
          id: 'c-1',
          firstName: 'A',
          lastName: 'B',
          email: 'a@b.test',
          // Already at the target before entering the branch.
          relationshipHealth: 'HOT',
          bestChannel: null,
        },
      });
      const prisma = makePrisma([enr]);
      const svc = build(prisma);

      await svc.processDueEnrollments();
      // Baseline gets captured as HOT; current === target === baseline → not a "change", so pending.
      expect(enr.metadata.baselineHealth).toBe('HOT');
      expect(enr.status).toBe('active');
      expect(enr.currentNodeId).toBe('br');

      // Force the wait window to elapse without a real change.
      enr.metadata.branchEnteredAt.br = new Date(Date.now() - 2 * 86400_000).toISOString();
      enr.nextStepAt = new Date(Date.now() - 1000);

      await svc.processDueEnrollments();
      expect(enr.currentNodeId).toBe('no');
      expect(enr.status).toBe('completed');
    });
  });
});
