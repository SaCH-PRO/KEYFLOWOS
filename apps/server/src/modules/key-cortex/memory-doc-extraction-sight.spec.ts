/**
 * MEM-DOC-EXTRACTION-SIGHT (D-234 fail closed, D-257): a document extraction (an AiMemory row of category
 * document_extraction, whose provenance is unknown) and every semantic copy of one renders in a prompt's memory only for
 * a reader with revenue read (readersOwnPromptMemory); a prompt's memory read takes the rows only when asked
 * (MemoryRetrievalOptions.documentExtractions), so for any other reader they are not read at all.
 *
 * Real-DB proof over the routes: test/memory-doc-extraction-sight.integration.test.ts. This spec covers what that suite's
 * stand-in semantic store cannot: the copies the semantic store serves (the backfill's entry form and the writer's
 * value form), and the read's own where clause.
 */
import { describe, it, expect, vi } from 'vitest';
import { readersModuleSight, readersOwnPromptMemory } from './key-cortex-prompt-context.service';
import { UnifiedMemoryRetrievalService } from './unified-memory-retrieval.service';

const MEMBERSHIPS: Record<string, { role: string; permissionScopes: unknown }> = {
  blind: { role: 'STAFF', permissionScopes: { crm: 'read', operations: 'read', expenses: 'none', revenue: 'none' } },
  revenue: { role: 'STAFF', permissionScopes: { crm: 'read', revenue: 'read', expenses: 'none' } },
  owner: { role: 'OWNER', permissionScopes: null },
};

const prisma = {
  client: {
    membership: {
      findUnique: vi.fn(async ({ where }: { where: { userId_businessId: { userId: string; businessId: string } } }) =>
        where.userId_businessId.businessId === 'biz_1' ? MEMBERSHIPS[where.userId_businessId.userId] ?? null : null,
      ),
    },
    cognitionMemory: { findMany: vi.fn(async () => []) },
    keyActionProposal: { findMany: vi.fn(async () => []) },
  },
};

const EXTRACTION = '{"documentId":"doc_1","data":{"total":4812.37,"number":"INV-0042"}}';
const fragments = [
  { id: 'fact', sourceType: 'ai_memory', title: 'fact', content: 'fact.hours: we open at nine' },
  { id: 'row', sourceType: 'ai_memory', title: 'document_extraction', content: `document_extraction.doc_1: ${EXTRACTION}` },
  // The backfill's entry form (SemanticMemoryService.backfillFromAiMemory): the row's category in its metadata.
  {
    id: 'copy_entry',
    sourceType: 'ai_memory_embedding',
    title: 'Memory fragment',
    content: `document_extraction: doc_1 = ${EXTRACTION}`,
    metadata: { category: 'document_extraction', key: 'doc_1', confidence: 1 },
  },
  // The entry form with its metadata lost: its content still names the category.
  { id: 'copy_entry_bare', sourceType: 'ai_memory_embedding', title: 'Memory fragment', content: `document_extraction: doc_1 = ${EXTRACTION}` },
  // UnifiedMemoryWriterService's value form (indexSemantic): the value alone, the category as the metadata's type.
  {
    id: 'copy_value',
    sourceType: 'ai_memory_embedding',
    title: 'Memory fragment',
    content: EXTRACTION,
    metadata: { type: 'document_extraction', key: 'doc_1', source: 'key_document_service' },
  },
  // Control: a copy of another row stays.
  {
    id: 'copy_fact',
    sourceType: 'ai_memory_embedding',
    title: 'Memory fragment',
    content: 'fact: hours = we open at nine',
    metadata: { category: 'fact', key: 'hours', confidence: 1 },
  },
];
const EXTRACTION_IDS = ['row', 'copy_entry', 'copy_entry_bare', 'copy_value'];

describe('MEM-DOC-EXTRACTION-SIGHT: readersOwnPromptMemory', () => {
  it.each([
    ['blind', false],
    ['revenue', true],
    ['owner', true],
  ] as const)('reader %s: the extraction and its copies render only with revenue read (%s); the fact and its copy always do', async (reader, readsRevenue) => {
    const kept = (await readersOwnPromptMemory(prisma as any, 'biz_1', reader, fragments, 50)).map((f) => f.id);
    expect(kept).toEqual(expect.arrayContaining(['fact', 'copy_fact']));
    for (const id of EXTRACTION_IDS) expect(kept.includes(id), `${reader}: ${id}`).toBe(readsRevenue);
  });

  it('a turn with no member reader (and a reader who is no member) sees no extraction nor any copy of one', async () => {
    for (const reader of [null, 'stranger']) {
      const kept = (await readersOwnPromptMemory(prisma as any, 'biz_1', reader, fragments, 50)).map((f) => f.id);
      expect(kept, String(reader)).toEqual(['fact', 'copy_fact']);
    }
  });

  it("a staff position's sight decides as the reader's would: with revenue, kept; without, withheld", async () => {
    const withRevenue = await readersOwnPromptMemory(prisma as any, 'biz_1', 'blind', fragments, 50, undefined, undefined, (m) => m === 'revenue');
    expect(withRevenue.map((f) => f.id)).toEqual(expect.arrayContaining(EXTRACTION_IDS));
    const without = await readersOwnPromptMemory(prisma as any, 'biz_1', 'revenue', fragments, 50, undefined, undefined, (m) => m === 'crm');
    expect(without.map((f) => f.id)).toEqual(['fact', 'copy_fact']);
  });

  it('a memberless turn sees none even when its sight holds revenue (a contact-only position: no member reader)', async () => {
    const kept = await readersOwnPromptMemory(prisma as any, 'biz_1', null, fragments, 50, undefined, undefined, () => true);
    expect(kept.map((f) => f.id)).toEqual(['fact', 'copy_fact']);
  });
});

describe('MEM-DOC-EXTRACTION-SIGHT: the memory read takes document extractions only when asked', () => {
  const readWhere = async (documentExtractions?: boolean) => {
    const aiMemory = { findMany: vi.fn(async () => []) };
    const empty = { findMany: vi.fn(async () => []) };
    const db = {
      client: new Proxy({ aiMemory } as Record<string, unknown>, { get: (target, prop) => (prop in target ? target[prop as string] : empty) }),
    };
    const service = new UnifiedMemoryRetrievalService(db as any, { search: async () => [] } as any);
    await service.retrieveContext('biz_1', documentExtractions === undefined ? {} : { documentExtractions });
    return (aiMemory.findMany.mock.calls[0] as any)[0].where.category.notIn as string[];
  };

  it('by default, and when false, the AiMemory read excludes document_extraction (and the settings rows)', async () => {
    for (const flag of [undefined, false]) {
      const notIn = await readWhere(flag);
      expect(notIn, String(flag)).toEqual(expect.arrayContaining(['settings', 'document_extraction']));
    }
  });

  it('when true, it reads them (still never the settings rows)', async () => {
    const notIn = await readWhere(true);
    expect(notIn).toContain('settings');
    expect(notIn).not.toContain('document_extraction');
  });

  // Review finding (semantic copies crowd the read): the semantic search leaves out the copies of document extractions
  // unless the read asks for them, so they take no place in its limit either.
  const searchParams = async (documentExtractions?: boolean) => {
    const search = vi.fn(async () => []);
    const db = { client: new Proxy({}, { get: () => ({ findMany: vi.fn(async () => []) }) }) };
    const service = new UnifiedMemoryRetrievalService(db as any, { search } as any);
    // MEM-UNIFIED-SEMANTIC-SIGHT: a semantic read needs a reader's sight (none: no search, fail closed); this one's reader
    // may see the copies, so the read's own documentExtractions flag is what decides.
    const semanticSight = { includeDocumentExtractionCopies: true, visibleTo: async (hits: unknown[]) => hits.map(() => true) };
    await service.retrieveContext('biz_1', { query: 'q', semanticSight, ...(documentExtractions === undefined ? {} : { documentExtractions }) });
    return (search.mock.calls[0] as any)[0];
  };

  it('the semantic search includes the copies of document extractions only when the read asks for extractions (COR-MDX-1: exclusion is the search default)', async () => {
    expect((await searchParams()).includeDocumentExtractionCopies).not.toBe(true);
    expect((await searchParams(false)).includeDocumentExtractionCopies).not.toBe(true);
    expect((await searchParams(true)).includeDocumentExtractionCopies).toBe(true);
  });
});

describe("MEM-DOC-EXTRACTION-SIGHT: the owners' digest keeps the extractions (review finding: owner behaviour unchanged)", () => {
  it('KeyCortexDigestService asks its memory read for document extractions (the digest goes to the business owners)', async () => {
    const { KeyCortexDigestService } = await import('./key-cortex-digest.service');
    const retrieveContext = vi.fn(async () => []);
    const service = new KeyCortexDigestService(
      { getMentalModel: vi.fn(async () => null) } as any,
      { generateBusinessReport: vi.fn(async () => null) } as any,
      { retrieveContext } as any,
      {} as any,
    );
    await service.generateDailyDigest('biz_1');
    expect(retrieveContext).toHaveBeenCalledWith('biz_1', expect.objectContaining({ documentExtractions: true }));
  });
});

describe('MEM-DOC-EXTRACTION-SIGHT (COR-MDX-2): no database client is no sight, and says so', () => {
  it('readersModuleSight with no client answers no module and warns loudly for a reader', async () => {
    const logger = { warn: vi.fn() };
    const sight = await readersModuleSight(undefined, 'biz_1', 'owner', logger);
    expect(sight('revenue')).toBe(false);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(String(logger.warn.mock.calls[0][0])).toMatch(/no database client/i);
  });
});
