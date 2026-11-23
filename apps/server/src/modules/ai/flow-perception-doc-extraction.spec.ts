/**
 * MEM-DOC-EXTRACTION-SIGHT (D-234 fail closed; review finding on the staff-position branch): the /ai flow chat's
 * perception block asks its memory read for document extractions (MemoryRetrievalOptions.documentExtractions) exactly
 * when the turn's sight reads revenue: a member by their membership; a staff position's turn by the modules its policy
 * resolved; a contact-only position, a position whose named reader is no longer a member, and a caller who is no
 * member never.
 *
 * Real-DB proof for members: test/memory-doc-extraction-sight.integration.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { FlowOrchestratorService } from './flow-orchestrator.service';

const MEMBERSHIPS: Record<string, { role: string; permissionScopes: unknown }> = {
  owner: { role: 'OWNER', permissionScopes: null },
  blind: { role: 'STAFF', permissionScopes: { crm: 'read', revenue: 'none', expenses: 'none' } },
  staff: { role: 'STAFF', permissionScopes: null },
};
const prisma = {
  client: {
    membership: {
      findUnique: vi.fn(async ({ where }: { where: { userId_businessId: { userId: string; businessId: string } } }) =>
        where.userId_businessId.businessId === 'biz_1' ? MEMBERSHIPS[where.userId_businessId.userId] ?? null : null,
      ),
    },
    business: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; members: { some: { userId: string } } } }) =>
        where.id === 'biz_1' && MEMBERSHIPS[where.members.some.userId] ? { id: where.id } : null,
      ),
    },
    cognitionMemory: { findMany: vi.fn(async () => []) },
    keyActionProposal: { findMany: vi.fn(async () => []) },
  },
};

type Perception = { readerUserId: string | null; modules: readonly string[] };
const ISSUED = new Map<unknown, Perception>();
const positionTurn = (perception: Perception) => {
  const envelope = Object.freeze({ jobRoleName: 'Staff', approvedTools: [], blockedTools: [], maxRiskTier: 1 });
  ISSUED.set(envelope, perception);
  return { jobRoleEnvelope: envelope, positionHolderUserId: perception.readerUserId };
};

/** The documentExtractions flag the perception block's memory read asks with, for one turn. */
async function flagFor(userId: string | undefined, server?: ReturnType<typeof positionTurn>): Promise<unknown> {
  const retrieveContext = vi.fn(async () => []);
  const memory = { retrieveContext };
  const impl = (FlowOrchestratorService.prototype as any).buildPerceptionSection;
  const instance = {
    moduleRef: { get: () => memory },
    logger: { warn: vi.fn() },
    getUnifiedMemory: () => memory,
    prisma,
    getJobRolePolicy: () => ({
      isIssued: (envelope: unknown) => ISSUED.has(envelope),
      perceptionOf: (envelope: unknown) => ISSUED.get(envelope) ?? null,
    }),
  };
  await impl.call(instance, 'biz_1', 'how are we doing', 'standard', userId, server);
  expect(retrieveContext).toHaveBeenCalledTimes(1);
  return (retrieveContext.mock.calls[0] as any)[1].documentExtractions;
}

describe('MEM-DOC-EXTRACTION-SIGHT: the perception read asks for document extractions only with revenue sight', () => {
  it.each([
    ['the owner', 'owner', true],
    ['a STAFF member on role defaults (revenue read)', 'staff', true],
    ['a STAFF member whose revenue scope is none', 'blind', false],
    ['a caller who is no member', 'stranger', false],
  ] as const)('%s: %s', async (_label, userId, expected) => {
    expect(await flagFor(userId)).toBe(expected);
  });

  it("a staff position's turn: true when its resolved modules hold revenue, false when they do not", async () => {
    expect(await flagFor(undefined, positionTurn({ readerUserId: 'staff', modules: ['crm', 'revenue'] }))).toBe(true);
    expect(await flagFor(undefined, positionTurn({ readerUserId: 'staff', modules: ['crm'] }))).toBe(false);
  });

  it('a contact-only position (no reader), and a position whose named reader is no member any more, never', async () => {
    expect(await flagFor(undefined, positionTurn({ readerUserId: null, modules: ['revenue'] }))).toBe(false);
    expect(await flagFor(undefined, positionTurn({ readerUserId: 'removed', modules: ['revenue'] }))).toBe(false);
  });
});

/** The include flag the flow chat's semantic memory section searches with, for one turn (COR-MDX-1). */
async function semanticIncludeFor(userId: string | undefined, server?: ReturnType<typeof positionTurn>): Promise<unknown> {
  const search = vi.fn(async () => []);
  const impl = (FlowOrchestratorService.prototype as any).buildSemanticMemorySection;
  const instance = {
    logger: { warn: vi.fn() },
    prisma,
    semanticMemory: { search },
    getJobRolePolicy: () => ({
      isIssued: (envelope: unknown) => ISSUED.has(envelope),
      perceptionOf: (envelope: unknown) => ISSUED.get(envelope) ?? null,
    }),
  };
  // The turn's reader and sight, as the perception block resolves them.
  Object.setPrototypeOf(instance, FlowOrchestratorService.prototype);
  await impl.call(instance, 'biz_1', 'how are we doing', userId, server);
  expect(search).toHaveBeenCalledTimes(1);
  return (search.mock.calls[0] as any)[0].includeDocumentExtractionCopies;
}

describe('MEM-DOC-EXTRACTION-SIGHT (COR-MDX-1): the flow chat semantic section includes copies of extractions only with revenue sight', () => {
  it.each([
    ['the owner', 'owner', true],
    ['a STAFF member on role defaults', 'staff', true],
    ['a STAFF member whose revenue scope is none', 'blind', false],
    ['a caller who is no member', 'stranger', false],
  ] as const)('%s', async (_label, userId, expected) => {
    expect((await semanticIncludeFor(userId)) === true).toBe(expected);
  });

  it('a staff position with revenue: included; without, a contact-only position, a removed reader, and the support desk (no member, no position): never', async () => {
    expect(await semanticIncludeFor(undefined, positionTurn({ readerUserId: 'staff', modules: ['revenue'] }))).toBe(true);
    expect((await semanticIncludeFor(undefined, positionTurn({ readerUserId: 'staff', modules: ['crm'] }))) === true).toBe(false);
    expect((await semanticIncludeFor(undefined, positionTurn({ readerUserId: null, modules: ['revenue'] }))) === true).toBe(false);
    expect((await semanticIncludeFor(undefined, positionTurn({ readerUserId: 'removed', modules: ['revenue'] }))) === true).toBe(false);
    expect((await semanticIncludeFor(undefined, undefined)) === true).toBe(false);
  });
});
