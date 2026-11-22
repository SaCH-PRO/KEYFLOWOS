/**
 * MEM-TEMPORAL-SCOPE (D-254, D-257): KEY's temporal-memory commands update_memory and tag_memory act only on a
 * memory of the caller's business, tag_memory tags the memory it names, and the unscoped
 * SemanticMemoryService.deleteForSource is gone (REAL database).
 *
 * At the base (main 2c4e4bf2):
 *   - TemporalFlowMemoryService.updateMemory(memoryId, patch) read and updated by id alone. The KEY connector's
 *     update_memory and tag_memory received the command's businessId and dropped it, so business A's KEY
 *     could rewrite business B's temporal memory by id.
 *   - tag_memory looked the row up by entityId = memoryId within A, then updated by id = memoryId. A memory
 *     named by its id was refused (no row has that entityId), and when A held a row whose entityId equalled
 *     B's memory id, B's memory was rewritten with A's row's tags and metadata.
 *   - SemanticMemoryService.deleteForSource deleted ai_memory_embeddings rows by source alone, in every
 *     business. It had no caller; it is removed rather than kept unscoped.
 *
 * Scope rule held here: every update and delete by id carries the tenant predicate in the query itself, and a
 * foreign id answers exactly as a missing id does (the refusal does not reveal that the memory exists).
 *
 * WHAT IS REAL: PrismaService and the database, TemporalFlowMemoryService, TemporalAdapterService and
 * KeyCortexConnectorService.execute (the KEY connector's command path). Stand-ins: the connector's other
 * adapters and its registry (not reached by module 'temporal'), SemanticMemoryService behind
 * TemporalFlowMemoryService (update and tag never reach it; a call is recorded and fails the case) and
 * TemporalFlowService (not reached). No tenant context is installed, so the Prisma tenant extension is inert
 * and the services' own predicates are the only control, as on KEY's background paths.
 *
 * Every seeded row carries the `v71t_` prefix and is hard-deleted with sqlLikePrefix() in beforeAll and
 * afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v71t_';
const ID = {
  userA: `${P}userA`,
  userB: `${P}userB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  memA: `${P}memA`,
  memA2: `${P}memA2`,
  memB: `${P}memB`,
  // A row of A's whose entityId is B's memory id (tag_memory's old lookup key).
  memAShadowsB: `${P}memA_shadowsB`,
  // A row of A's whose entityId is A's own memory id memA.
  memAShadowsA: `${P}memA_shadowsA`,
  missing: `${P}does_not_exist`,
};
const B_CONTENT = 'v71t-tenant-B-private';
const B_TAGS = ['b-tag'];

let db: any;
let connector: any;
let memoryService: any;
const semanticCalls: string[] = [];

async function cleanup() {
  for (const sql of [
    `DELETE FROM temporal_flow_memories WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    await db.$executeRawUnsafe(sql);
  }
}

async function seedMemories() {
  await db.$executeRawUnsafe(`DELETE FROM temporal_flow_memories WHERE id LIKE ${sqlLikePrefix(P)}`);
  // Rows store_memory creates get generated ids; they belong to the seeded businesses.
  await db.$executeRawUnsafe(`DELETE FROM temporal_flow_memories WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  const row = (id: string, businessId: string, entityId: string, content: string, tags: string[]) => ({
    id,
    businessId,
    entityType: 'business',
    entityId,
    type: 'insight',
    content,
    sourceModule: 'key_cortex',
    sourceEventIds: tags,
    metadata: { key: entityId, tags },
    confidence: 0.5,
  });
  await db.temporalFlowMemory.create({ data: row(ID.memB, ID.bizB, 'b-key', B_CONTENT, B_TAGS) });
  await db.temporalFlowMemory.create({ data: row(ID.memA, ID.bizA, 'a-key', 'a-content', ['a-tag']) });
  await db.temporalFlowMemory.create({ data: row(ID.memA2, ID.bizA, 'a-key-2', 'a-content-2', []) });
  await db.temporalFlowMemory.create({ data: row(ID.memAShadowsB, ID.bizA, ID.memB, 'a-shadow-b', ['shadow-b-tag']) });
  await db.temporalFlowMemory.create({ data: row(ID.memAShadowsA, ID.bizA, ID.memA, 'a-shadow-a', ['shadow-a-tag']) });
}

const read = (id: string) => db.temporalFlowMemory.findUnique({ where: { id } });

function cmd(businessId: string, action: string, parameters: Record<string, unknown>) {
  return {
    module: 'temporal',
    action,
    parameters,
    businessId,
    userId: businessId === ID.bizA ? ID.userA : ID.userB,
    source: 'key_cortex',
    timestamp: new Date(),
    correlationId: `${P}corr`,
  };
}

/** The connector result with its timing and echoed command removed, so two refusals compare whole. */
const answer = (r: any) => ({ success: r.success, data: r.data, error: r.error });

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { TemporalFlowMemoryService } = await import('../src/modules/temporal-flow/temporal-flow-memory.service');
  const { TemporalAdapterService } = await import('../src/modules/key-cortex/adapters/temporal-adapter.service');
  const { KeyCortexConnectorService } = await import('../src/modules/key-cortex/key-cortex-connector.service');

  const semantic = new Proxy({}, {
    get: (_t, prop) => (...args: unknown[]) => {
      semanticCalls.push(String(prop));
      throw new Error(`v71t: SemanticMemoryService.${String(prop)} reached with ${JSON.stringify(args).slice(0, 120)}`);
    },
  });
  const flow = new Proxy({}, { get: (_t, prop) => () => { throw new Error(`v71t: TemporalFlowService.${String(prop)} reached`); } });
  const memory = new TemporalFlowMemoryService(new PrismaService() as any, semantic as any);
  memoryService = memory;
  const temporal = new TemporalAdapterService(memory, flow as any);
  // Constructor order: registry, contextAssembly, crm, commerce, bookings, content, communications, flow,
  // autopilot, temporal, inbox, notifications, projects, activity, social, finance, analytics, intelligence,
  // settings, bridge. Only temporal is reached by module 'temporal'.
  const args: any[] = new Array(20).fill(undefined);
  args[9] = temporal;
  connector = new (KeyCortexConnectorService as any)(...args);

  await cleanup();
  await db.user.create({ data: { id: ID.userA, email: `${P}a@t.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.userB, email: `${P}b@t.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizA, name: 'A', ownerId: ID.userA } });
  await db.business.create({ data: { id: ID.bizB, name: 'B', ownerId: ID.userB } });
}, 60_000);

beforeEach(async () => {
  semanticCalls.length = 0;
  await seedMemories();
});

afterAll(async () => {
  if (db) await cleanup();
});

async function expectBUnchanged() {
  const b = await read(ID.memB);
  expect(b, "B's memory still exists").not.toBeNull();
  expect(b.businessId).toBe(ID.bizB);
  expect(b.content).toBe(B_CONTENT);
  expect(b.sourceEventIds).toEqual(B_TAGS);
  expect(b.metadata).toEqual({ key: 'b-key', tags: B_TAGS });
  expect(b.confidence).toBe(0.5);
}

describe('MEM-TEMPORAL-SCOPE: update_memory through the KEY connector', () => {
  it("business A cannot update business B's temporal memory by id: refused as not found, B's row unchanged", async () => {
    const r = await connector.execute(cmd(ID.bizA, 'update_memory', { memoryId: ID.memB, value: { hijacked: true }, importance: 'high' }));
    expect(r.success).toBe(false);
    await expectBUnchanged();
  });

  it('the refusal for a foreign id is the refusal for a missing id (existence is not revealed)', async () => {
    const foreign = await connector.execute(cmd(ID.bizA, 'update_memory', { memoryId: ID.memB, value: { x: 1 } }));
    const missing = await connector.execute(cmd(ID.bizA, 'update_memory', { memoryId: ID.missing, value: { x: 1 } }));
    expect(answer(foreign)).toEqual(answer(missing));
    expect(missing.success).toBe(false);
    expect(missing.error).toBe('Memory not found');
  });

  it("A's own update still works", async () => {
    const r = await connector.execute(cmd(ID.bizA, 'update_memory', { memoryId: ID.memA, value: { fresh: 1 }, importance: 'high' }));
    expect(r.success).toBe(true);
    expect(r.data?.id).toBe(ID.memA);
    const a = await read(ID.memA);
    expect(a.content).toBe(JSON.stringify({ fresh: 1 }));
    expect(a.confidence).toBe(0.9);
    expect(a.businessId).toBe(ID.bizA);
    await expectBUnchanged();
    expect(semanticCalls).toEqual([]);
  });

  it('B updating its own memory works and does not touch A', async () => {
    const r = await connector.execute(cmd(ID.bizB, 'update_memory', { memoryId: ID.memB, value: { mine: true } }));
    expect(r.success).toBe(true);
    expect((await read(ID.memB)).content).toBe(JSON.stringify({ mine: true }));
    expect((await read(ID.memA)).content).toBe('a-content');
  });
});

describe('MEM-TEMPORAL-SCOPE: tag_memory through the KEY connector', () => {
  it("business A cannot tag business B's memory by id: refused as not found, B's row unchanged", async () => {
    const r = await connector.execute(cmd(ID.bizA, 'tag_memory', { memoryId: ID.memB, tags: ['a-was-here'] }));
    expect(r.success).toBe(false);
    await expectBUnchanged();
    // A's row whose entityId is B's id is not the target either.
    const shadow = await read(ID.memAShadowsB);
    expect(shadow.sourceEventIds).toEqual(['shadow-b-tag']);
  });

  it('the tag refusal for a foreign id is the refusal for a missing id', async () => {
    const foreign = await connector.execute(cmd(ID.bizA, 'tag_memory', { memoryId: ID.memB, tags: ['t'] }));
    const missing = await connector.execute(cmd(ID.bizA, 'tag_memory', { memoryId: ID.missing, tags: ['t'] }));
    expect(answer(foreign)).toEqual(answer(missing));
    expect(missing.success).toBe(false);
    expect(missing.error).toBe('Memory not found');
  });

  it('tag_memory on a memory id tags that memory, not the rows whose entityId equals it', async () => {
    const r = await connector.execute(cmd(ID.bizA, 'tag_memory', { memoryId: ID.memA, tags: ['new-tag', 'a-tag'] }));
    expect(r.success).toBe(true);
    expect(r.data?.id).toBe(ID.memA);
    const a = await read(ID.memA);
    expect(a.sourceEventIds).toEqual(['a-tag', 'new-tag']);
    expect(a.metadata).toEqual({ key: 'a-key', tags: ['a-tag', 'new-tag'] });
    expect(a.content).toBe('a-content');
    const shadow = await read(ID.memAShadowsA);
    expect(shadow.sourceEventIds).toEqual(['shadow-a-tag']);
    expect(shadow.metadata).toEqual({ key: ID.memA, tags: ['shadow-a-tag'] });
  });

  it('tag_memory on a memory no row names by entityId still finds it by id', async () => {
    const r = await connector.execute(cmd(ID.bizA, 'tag_memory', { memoryId: ID.memA2, tags: ['only'] }));
    expect(r.success).toBe(true);
    expect((await read(ID.memA2)).sourceEventIds).toEqual(['only']);
  });
});

describe('MEM-TEMPORAL-SCOPE: delete_memory (already scoped; held here with the same rule)', () => {
  it("A cannot delete B's memory by id, and the answer is the answer for a missing id", async () => {
    const foreign = await connector.execute(cmd(ID.bizA, 'delete_memory', { memoryId: ID.memB }));
    const missing = await connector.execute(cmd(ID.bizA, 'delete_memory', { memoryId: ID.missing }));
    expect(foreign.success).toBe(true);
    expect(foreign.data).toEqual({ deleted: false, memoryId: ID.memB });
    expect(missing.data).toEqual({ deleted: false, memoryId: ID.missing });
    await expectBUnchanged();
  });

  it('A deletes its own memory', async () => {
    const r = await connector.execute(cmd(ID.bizA, 'delete_memory', { memoryId: ID.memA2 }));
    expect(r.data).toEqual({ deleted: true, memoryId: ID.memA2 });
    expect(await read(ID.memA2)).toBeNull();
  });
});

describe('MEM-TEMPORAL-SCOPE: SemanticMemoryService.deleteForSource', () => {
  it('the unscoped deleteForSource (no business predicate, no caller) is removed', async () => {
    const { SemanticMemoryService } = await import('../src/modules/ai/semantic-memory.service');
    expect('deleteForSource' in SemanticMemoryService.prototype).toBe(false);
  });
});

/** Every seeded row, as stored, so a case can show nothing at all was written or deleted. */
async function snapshot() {
  return db.temporalFlowMemory.findMany({ where: { businessId: { in: [ID.bizA, ID.bizB] } }, orderBy: { id: 'asc' } });
}

describe('MEM-TEMPORAL-SCOPE review repair: a command without a memoryId acts on no memory', () => {
  it('delete_memory with no memoryId deletes nothing (a where without the id must not become every row of the business)', async () => {
    const before = await snapshot();
    expect(before.length).toBe(5);
    const r = await connector.execute(cmd(ID.bizA, 'delete_memory', {}));
    expect(r).toMatchObject({ success: true, data: { deleted: false } });
    expect(await snapshot()).toEqual(before);
  });

  it('update_memory with no memoryId is refused as not found and writes nothing', async () => {
    const before = await snapshot();
    const r = await connector.execute(cmd(ID.bizA, 'update_memory', { value: { x: 1 }, importance: 'high' }));
    expect(r.success).toBe(false);
    expect(r.error).toBe('Memory not found');
    expect(await snapshot()).toEqual(before);
  });

  it('tag_memory with no memoryId is refused as not found and writes nothing', async () => {
    const before = await snapshot();
    const r = await connector.execute(cmd(ID.bizA, 'tag_memory', { tags: ['x'] }));
    expect(r.success).toBe(false);
    expect(r.error).toBe('Memory not found');
    expect(await snapshot()).toEqual(before);
  });

  it('findById with no id finds nothing (not an arbitrary memory of the business)', async () => {
    expect(await memoryService.findById(ID.bizA, undefined)).toBeNull();
    expect(await memoryService.findById(ID.bizA, '')).toBeNull();
  });
});

describe('MEM-TEMPORAL-SCOPE review round 2: no business means no memory, and tags are only strings', () => {
  it("an absent business reads, changes and deletes nothing (B's memory by id)", async () => {
    const before = await snapshot();
    expect(await memoryService.findById(undefined, ID.memB)).toBeNull();
    expect(await memoryService.deleteMemory(undefined, ID.memB)).toBe(false);
    await expect(memoryService.updateMemory(undefined, ID.memB, { content: 'x' })).rejects.toThrow('Memory not found');
    expect(await snapshot()).toEqual(before);
  });

  it('tag_memory keeps only string tags: a string is not spread into characters, a missing list adds none', async () => {
    const asString = await connector.execute(cmd(ID.bizA, 'tag_memory', { memoryId: ID.memA, tags: 'xy' }));
    expect(asString.success).toBe(true);
    expect((await read(ID.memA)).sourceEventIds).toEqual(['a-tag']);
    const mixed = await connector.execute(cmd(ID.bizA, 'tag_memory', { memoryId: ID.memA, tags: ['ok', 7, null, { a: 1 }] }));
    expect(mixed.success).toBe(true);
    expect((await read(ID.memA)).sourceEventIds).toEqual(['a-tag', 'ok']);
    const missing = await connector.execute(cmd(ID.bizA, 'tag_memory', { memoryId: ID.memA }));
    expect(missing.success).toBe(true);
    expect((await read(ID.memA)).sourceEventIds).toEqual(['a-tag', 'ok']);
  });
});

describe('MEM-TEMPORAL-SCOPE review round 3: an operator object as memoryId never widens a by-id where', () => {
  it.each([{ not: 'x' }, { in: [ID.memA, ID.memB] }, 42])('delete, update and tag with memoryId %o act on no memory', async (memoryId) => {
    const before = await snapshot();
    const del = await connector.execute(cmd(ID.bizA, 'delete_memory', { memoryId }));
    expect(del).toMatchObject({ success: true, data: { deleted: false } });
    const upd = await connector.execute(cmd(ID.bizA, 'update_memory', { memoryId, value: { x: 1 } }));
    expect(upd).toMatchObject({ success: false, error: 'Memory not found' });
    const tag = await connector.execute(cmd(ID.bizA, 'tag_memory', { memoryId, tags: ['t'] }));
    expect(tag).toMatchObject({ success: false, error: 'Memory not found' });
    expect(await snapshot()).toEqual(before);
  });
});

describe('MEM-TEMPORAL-SCOPE orchestrator review M1: store_memory and recall_memory take only a string key', () => {
  const KEY_ERROR = 'Memory key must be a non-empty string';

  it.each([{ not: 'x' }, { in: ['a-key', 'a-key-2'] }, ['a-key'], 42, ''])(
    'store_memory with key %o is refused before any query and overwrites no memory',
    async (key) => {
      const before = await snapshot();
      const r = await connector.execute(cmd(ID.bizA, 'store_memory', { key, value: { injected: true } }));
      expect(answer(r)).toEqual({ success: false, data: undefined, error: KEY_ERROR });
      expect(await snapshot()).toEqual(before);
    },
  );

  it.each([{ not: 'x' }, { in: ['a-key'] }, ['a-key'], 42, ''])(
    'recall_memory with key %o is refused and returns no memory',
    async (key) => {
      const r = await connector.execute(cmd(ID.bizA, 'recall_memory', { key }));
      expect(answer(r)).toEqual({ success: false, data: undefined, error: KEY_ERROR });
    },
  );

  it('store_memory and recall_memory with a string key still work', async () => {
    const stored = await connector.execute(cmd(ID.bizA, 'store_memory', { key: 'v71t-new-key', value: { v: 1 }, tags: ['t1'] }));
    expect(stored.success).toBe(true);
    expect(stored.data?.businessId).toBe(ID.bizA);
    const recalled = await connector.execute(cmd(ID.bizA, 'recall_memory', { key: 'v71t-new-key' }));
    expect(recalled.success).toBe(true);
    expect(recalled.data?.id).toBe(stored.data?.id);
    expect(recalled.data?.content).toBe(JSON.stringify({ v: 1 }));
    // Rewriting the same key updates that memory, not another.
    const again = await connector.execute(cmd(ID.bizA, 'store_memory', { key: 'v71t-new-key', value: { v: 2 } }));
    expect(again.data?.id).toBe(stored.data?.id);
    expect((await read(ID.memA)).content).toBe('a-content');
    await expectBUnchanged();
  });

  it('store_memory keeps only string tags', async () => {
    const asString = await connector.execute(cmd(ID.bizA, 'store_memory', { key: 'v71t-tags-1', value: { v: 1 }, tags: 'xy' }));
    expect(asString.success).toBe(true);
    expect(asString.data?.sourceEventIds).toEqual([]);
    const mixed = await connector.execute(cmd(ID.bizA, 'store_memory', { key: 'v71t-tags-2', value: { v: 1 }, tags: ['ok', 7, null, { a: 1 }] }));
    expect(mixed.success).toBe(true);
    expect(mixed.data?.sourceEventIds).toEqual(['ok']);
  });
});
