/**
 * MEM-TEMPORAL-MEMORY-ROUTES-SIGHT (P0; owner rulings D-257 (KEY's memory design, its scope fixes), D-234 (money data
 * needs revenue read; provenance decides; ambiguity fails closed), D-100; journey K).
 *
 * Found by the MEM-SEMANTIC-SIGHT reviews: the temporal-flow memory routes and KEY's temporal tools served a temporal
 * memory summary (an inbox thread about an overdue invoice, a contact's payment history) to a member who may not read
 * revenue:
 *   - GET temporal-flow/businesses/:id/memory, memory/search and memory/by-entity, and POST .../analyze's memory insights
 *     (its listed summaries and its 'overdue invoice' semantic recall): FU-TEMPORAL-FLOW-INBOX-SCOPE's readerMemoryFilter
 *     withholds a summary by its source module and by the source events withheld from the reader, but not by what the
 *     summary itself says (an inbox thread naming an invoice amount is an operations event; design 8.2 taint), and the
 *     search kept a copy by its source row alone, whatever the copy says;
 *   - KEY's temporal tools (KeyCortexConnectorService module 'temporal': recall_memory, search_memories,
 *     get_recent_memories, get_timeline, and the rows tag_memory / update_memory hand back) took no reader at all.
 *
 * GREEN: every path applies MEM-SEMANTIC-SIGHT's projection for the reader (the request's member; on KEY's tools the
 * command's actor): a structured row passes readerMemoryFilter in its query and semanticHitsVisibleTo (its source's
 * rule: temporalMemoryModulesOf) before the limit is cut; a semantic copy passes readerSearchOptions' visibleTo and
 * readerMemoryFilter before the limit; KEY's timeline applies readerFilter. A memory the actor may not see answers on
 * tag_memory / update_memory exactly as a missing (or foreign) one does. The owner is unchanged.
 *
 * Every write goes through its real writer on the real database (TemporalFlowService.emit, TemporalFlowMemoryService
 * .summarizeThread / summarizeContact over the real SemanticMemoryService, KEY's store_memory through the connector).
 * Every read goes through the real TemporalFlowController behind its real guards, or the real
 * KeyCortexConnectorService.execute over the real TemporalAdapterService.
 *
 * Stand-ins: identity attachment (a middleware reads `x-v75r-user`), the embedding provider (a fixed vector per marker:
 * the queries and every money-derived text are e0, the n-th ordinary summary has similarity 0.95 - 0.01n), the queue
 * and the genome bridge (not reached). globalThis.fetch refuses and records every outbound request: none is made.
 *
 * Fixture prefix v75r_ (MEM-TEMPORAL-MEMORY-ROUTES-SIGHT), cleaned with sqlLikePrefix().
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v75r_';
const HEADER = 'x-v75r-user';

const ID = {
  owner: `${P}owner`,
  /** STAFF: every module read (bookings write: reaches the analysis). */
  full: `${P}full`,
  /** STAFF: operations, crm, bookings and ai read (bookings write); revenue and expenses none. */
  opsNoRev: `${P}opsnorev`,
  /** STAFF: bookings write and ai read; every other module none (the definition of done's reader). */
  bookingsOnly: `${P}bookings`,
  /** A platform SUPER_ADMIN with no membership. */
  root: `${P}root`,
  /** The owner of the other business, no membership of this one. */
  outsider: `${P}outsider`,
  biz: `${P}biz`,
  other: `${P}other`,
};
const NONE = {
  crm: 'none', revenue: 'none', expenses: 'none', bookings: 'none', projects: 'none', content: 'none', automations: 'none',
  storefront: 'none', analytics: 'none', operations: 'none', ai: 'none', team: 'none', settings: 'none', connect: 'none',
};
const SCOPES: Record<string, Record<string, string>> = {
  full: Object.fromEntries(Object.keys(NONE).map((k) => [k, k === 'bookings' ? 'write' : 'read'])),
  opsNoRev: { ...NONE, operations: 'read', crm: 'read', bookings: 'write', ai: 'read' },
  bookingsOnly: { ...NONE, bookings: 'write', ai: 'read' },
};

type Reader = 'owner' | 'full' | 'opsNoRev' | 'bookingsOnly' | 'root' | 'outsider';
const SEEING: Reader[] = ['owner', 'full'];
const BLIND: Reader[] = ['opsNoRev', 'bookingsOnly'];

const QUERY = 'V75R-Q what happened with this customer';
const INSIGHT_QUERY = 'overdue invoice complaint urgent follow-up';
const REV = 'v75r-rev';
const OTHER = 'v75r-other';
const AMOUNT = '4812.37';
const KEY_NOTE = 'v75r-key-note';
const okMarker = (n: number) => `V75R-OK-${n}`;
const MONEY_THREAD = `${P}th_rev`;

const saved = { fetch: globalThis.fetch };
const outbound: string[] = [];

let db: any;
let app: any;
let connector: any;
let semantic: any;
let temporal: any;
let temporalMemory: any;

const DIM = 1536;
const unit = (i: number) => Array.from({ length: DIM }, (_, k) => (k === i ? 1 : 0));
function embed(text: string): number[] {
  const t = text.toLowerCase();
  if (t.includes('v75r-q') || t.includes(INSIGHT_QUERY) || t.includes(REV) || t.includes(OTHER)) return unit(0);
  const ok = /v75r-ok-(\d+)/.exec(t);
  if (ok) {
    const n = Number(ok[1]);
    const cos = 0.95 - 0.01 * n;
    const v = unit(1 + n).map((x) => x * Math.sqrt(1 - cos * cos));
    v[0] = cos;
    return v;
  }
  return unit(DIM - 1);
}

async function cleanup() {
  const byBiz = (table: string) => `DELETE FROM ${table} WHERE business_id LIKE ${sqlLikePrefix(P)}`;
  for (const sql of [
    byBiz('ai_memory_embeddings'),
    byBiz('temporal_flow_memories'),
    byBiz('temporal_flow_events'),
    byBiz('memberships'),
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort */
    }
  }
}

async function clearMemory() {
  for (const table of ['ai_memory_embeddings', 'temporal_flow_memories', 'temporal_flow_events']) {
    await db.$executeRawUnsafe(`DELETE FROM ${table} WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  }
}

async function inboxThread(businessId: string, threadId: string, title: string) {
  for (let i = 0; i < 3; i++) {
    await temporal.emit({
      businessId, source: 'key_inbox', type: 'key_inbox.message_received', module: 'key_inbox', title, threadId,
      importance: 'CRITICAL', genomeImpactPotential: true,
    });
  }
  return temporalMemory.summarizeThread(businessId, threadId);
}

/** Three ordinary inbox thread summaries (operations), then the money memories, newest. */
async function seed() {
  for (let n = 1; n <= 3; n++) await inboxThread(ID.biz, `${P}th_ok_${n}`, `${okMarker(n)} customer asked about opening hours`);
  // An inbox thread about an overdue invoice: an operations event whose text states money (design 8.2 taint).
  await inboxThread(ID.biz, MONEY_THREAD, `${REV} Invoice INV-1 for TTD ${AMOUNT} is overdue`);
  // A contact's payment history: money by its source events.
  const contactId = `${P}ct_rev`;
  for (let k = 0; k < 3; k++) {
    await temporal.emit({
      businessId: ID.biz, source: `${REV}_gw`, type: 'payment.received', module: 'payments', title: `${REV} settled TTD ${AMOUNT}`,
      contactId, importance: 'CRITICAL', genomeImpactPotential: true,
    });
  }
  await temporalMemory.summarizeContact(ID.biz, contactId);
  // A money event on the timeline.
  await temporal.emit({
    businessId: ID.biz, source: 'stripe', type: 'invoice.overdue', module: 'payments', title: `${REV} invoice TTD ${AMOUNT} overdue`,
    importance: 'HIGH',
  });
  // What KEY stored for the owner: a note naming money (no recorded provenance).
  const stored = await connector.execute(cmd('owner', 'store_memory', { key: KEY_NOTE, value: { note: `${REV} payroll is TTD ${AMOUNT}` } }));
  expect(stored.success, JSON.stringify(stored.error)).toBe(true);
  // The other business's money summary.
  await inboxThread(ID.other, `${P}th_other`, `${OTHER} Invoice INV-X for TTD ${AMOUNT} is overdue`);

  const copies = await db.aiMemoryEmbedding.findMany({ where: { businessId: ID.biz, sourceType: 'temporal_memory' }, select: { content: true } });
  expect(copies.filter((c: any) => c.content.toLowerCase().includes(REV)).length, 'premise: the money summaries were embedded').toBeGreaterThanOrEqual(2);
  const rows = await db.temporalFlowMemory.findMany({ where: { businessId: ID.biz }, select: { content: true, sourceModule: true } });
  expect(rows.filter((r: any) => r.content.toLowerCase().includes(REV)).length, 'premise: three money memories').toBe(3);
}

function cmd(reader: Reader | null, action: string, parameters: Record<string, unknown>, businessId = ID.biz) {
  return {
    module: 'temporal', action, parameters, businessId, ...(reader ? { userId: ID[reader] } : {}),
    source: 'key_cortex', timestamp: new Date(), correlationId: `${P}corr`,
  };
}

const agent = () => request(app.getHttpServer());

async function get(reader: Reader, url: string) {
  const res = await agent().get(`/temporal-flow/businesses/${ID.biz}${url}`).set(HEADER, ID[reader]);
  return res;
}

/** Every route and tool answer for `reader`, as text. */
async function everythingFor(reader: Reader): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const route = async (name: string, res: any) => {
    out[name] = res.status === 200 || res.status === 201 ? JSON.stringify(res.body) : `status ${res.status}`;
  };
  await route('GET memory', await get(reader, '/memory'));
  await route('GET memory/search', await get(reader, `/memory/search?q=${encodeURIComponent(QUERY)}`));
  await route('GET memory/by-entity', await get(reader, `/memory/by-entity/thread/${MONEY_THREAD}`));
  const analyzed = await agent().post(`/temporal-flow/businesses/${ID.biz}/analyze`).set(HEADER, ID[reader]);
  out['POST analyze memoryInsights'] = analyzed.status === 201 ? JSON.stringify(analyzed.body.memoryInsights ?? []) : `status ${analyzed.status}`;
  for (const [action, params] of [
    ['recall_memory', { key: KEY_NOTE }],
    ['search_memories', { query: QUERY }],
    ['get_recent_memories', { limit: 50 }],
    ['get_timeline', { limit: 50 }],
  ] as const) {
    const r = await connector.execute(cmd(reader, action, params as any));
    out[`KEY ${action}`] = JSON.stringify(r.success ? r.data : { error: r.error });
  }
  return out;
}

beforeAll(async () => {
  globalThis.fetch = (async (input: unknown) => {
    outbound.push(String(input));
    throw new Error('v75r: no outbound traffic in this suite');
  }) as typeof fetch;

  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe, Logger } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { TemporalFlowController } = await import('../src/modules/temporal-flow/temporal-flow.controller');
  const { TemporalFlowService } = await import('../src/modules/temporal-flow/temporal-flow.service');
  const { TemporalFlowMemoryService } = await import('../src/modules/temporal-flow/temporal-flow-memory.service');
  const { TemporalFlowMemoryQueueService } = await import('../src/modules/temporal-flow/temporal-flow-memory.queue.service');
  const { TemporalFlowGenomeBridgeService } = await import('../src/modules/temporal-flow/temporal-flow-genome-bridge.service');
  const { SemanticMemoryService } = await import('../src/modules/ai/semantic-memory.service');
  const { TemporalAdapterService } = await import('../src/modules/key-cortex/adapters/temporal-adapter.service');
  const { KeyCortexConnectorService } = await import('../src/modules/key-cortex/key-cortex-connector.service');

  Logger.overrideLogger(false);
  const prisma = new PrismaService();
  semantic = new SemanticMemoryService(prisma, new EventEmitter2(), {
    trackEmbedding: async (_b: string, _u: unknown, _o: string, texts: string[]) => texts.map(embed),
  } as any);

  const moduleRef = await Test.createTestingModule({
    controllers: [TemporalFlowController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      TemporalFlowService,
      TemporalFlowMemoryService,
      { provide: SemanticMemoryService, useValue: semantic },
      { provide: TemporalFlowMemoryQueueService, useValue: { enqueue: async () => ({ queued: true }) } },
      { provide: TemporalFlowGenomeBridgeService, useValue: {} },
    ],
  }).compile();
  temporal = moduleRef.get(TemporalFlowService);
  temporalMemory = moduleRef.get(TemporalFlowMemoryService);

  // KEY's connector: its temporal adapter over the same real services (constructor position 9; the others not reached).
  const adapter = new TemporalAdapterService(temporalMemory, temporal);
  const args: any[] = new Array(20).fill(undefined);
  args[9] = adapter;
  connector = new (KeyCortexConnectorService as any)(...args);

  app = moduleRef.createNestApplication();
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
    if (typeof header === 'string' && header.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id: header }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup();
  for (const who of ['owner', 'full', 'opsNoRev', 'bookingsOnly', 'root', 'outsider'] as Reader[]) {
    await db.user.create({ data: { id: ID[who], email: `${ID[who]}@${P}test.local`, role: who === 'root' ? 'SUPER_ADMIN' : 'USER' } });
  }
  await db.business.create({ data: { id: ID.biz, name: 'V75R Biz', slug: `${P}biz`, ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.other, name: 'V75R Other', slug: `${P}other`, ownerId: ID.outsider } });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.biz, role: 'OWNER', maxApprovalTier: 4 } });
  await db.membership.create({ data: { id: `${P}m_outsider`, userId: ID.outsider, businessId: ID.other, role: 'OWNER', maxApprovalTier: 4 } });
  for (const who of ['full', 'opsNoRev', 'bookingsOnly'] as const) {
    await db.membership.create({ data: { id: `${P}m_${who}`, userId: ID[who], businessId: ID.biz, role: 'STAFF', permissionScopes: SCOPES[who], maxApprovalTier: 0 } });
  }
}, 180_000);

afterAll(async () => {
  globalThis.fetch = saved.fetch;
  if (app) await app.close();
  if (db) await cleanup();
});

const lower = (x: string) => x.toLowerCase();

describe('MEM-TEMPORAL-MEMORY-ROUTES-SIGHT (D-257, D-234, D-100): the temporal memory routes and KEY tools apply the reader projection', () => {
  it('V75R-01 RED: a money summary (an inbox thread naming an invoice amount, a payment history, KEY\'s money note) and a money timeline event reach the owner and a full reader on every route and KEY tool, and neither a member without revenue read (operations read) nor a bookings-only member on any of them', async () => {
    await clearMemory();
    try {
      await seed();
      // Every (reader, surface) that answers wrongly, so a RED run names each leaking path.
      const wrong: string[] = [];
      for (const reader of [...BLIND, ...SEEING]) {
        const seen = await everythingFor(reader);
        for (const [surface, text] of Object.entries(seen)) {
          if (SEEING.includes(reader)) {
            if (!lower(text).includes(REV)) wrong.push(`${reader} ${surface}: money withheld from a reader who may see it`);
          } else if (lower(text).includes(REV) || text.includes(AMOUNT)) {
            wrong.push(`${reader} ${surface}: money served`);
          }
          if (lower(text).includes(OTHER)) wrong.push(`${reader} ${surface}: the other business's memory served`);
        }
      }
      expect(wrong).toEqual([]);
      // The member without revenue read still reads the ordinary inbox summaries (operations) on the routes and tools.
      const ops = await everythingFor('opsNoRev');
      for (const surface of ['GET memory', 'GET memory/search', 'KEY search_memories', 'KEY get_recent_memories']) {
        expect(ops[surface], `opsNoRev ${surface}: ordinary summary`).toContain(okMarker(1));
      }
      expect(outbound).toEqual([]);
    } finally {
      await clearMemory();
    }
  }, 300_000);

  it('V75R-02 filtered before the limit: with the money summaries the newest and the most similar, GET memory?limit=3 and memory/search?limit=3 and KEY search_memories (limit 3) hand the member without revenue read three ordinary summaries', async () => {
    await clearMemory();
    try {
      await seed();
      const list = await get('opsNoRev', '/memory?limit=3');
      expect(list.status).toBe(200);
      expect(list.body.map((m: any) => m.content).filter((c: string) => c.includes('V75R-OK-'))).toHaveLength(3);
      const search = await get('opsNoRev', `/memory/search?q=${encodeURIComponent(QUERY)}&limit=3`);
      expect(search.status).toBe(200);
      expect(search.body.map((h: any) => h.content).filter((c: string) => c.includes('V75R-OK-'))).toHaveLength(3);
      const tool = await connector.execute(cmd('opsNoRev', 'search_memories', { query: QUERY, limit: 3 }));
      expect(tool.data.map((h: any) => h.content).filter((c: string) => c.includes('V75R-OK-'))).toHaveLength(3);
    } finally {
      await clearMemory();
    }
  }, 300_000);

  it('V75R-03 owner unchanged: the owner\'s GET memory, memory/by-entity and memory/search answer what the memory service itself answers, and KEY recall_memory hands the owner their note', async () => {
    await clearMemory();
    try {
      await seed();
      const ids = (rows: any[]) => rows.map((r) => r.id);
      expect(ids((await get('owner', '/memory')).body)).toEqual(ids(await temporalMemory.findMany(ID.biz, {})));
      expect(ids((await get('owner', `/memory/by-entity/thread/${MONEY_THREAD}`)).body)).toEqual(ids(await temporalMemory.findByEntity(ID.biz, 'thread', MONEY_THREAD)));
      expect(ids((await get('owner', `/memory/search?q=${encodeURIComponent(QUERY)}`)).body)).toEqual(ids(await temporalMemory.searchMemory(ID.biz, QUERY, 10)));
      const recall = await connector.execute(cmd('owner', 'recall_memory', { key: KEY_NOTE }));
      expect(lower(JSON.stringify(recall.data))).toContain(REV);
    } finally {
      await clearMemory();
    }
  }, 300_000);

  it('V75R-04 KEY tag_memory and update_memory: a memory the actor may not see answers exactly as a missing one and as another business\'s, and is not changed; the owner tags it', async () => {
    await clearMemory();
    try {
      await seed();
      const money = await db.temporalFlowMemory.findFirst({ where: { businessId: ID.biz, entityId: MONEY_THREAD } });
      const foreign = await db.temporalFlowMemory.findFirst({ where: { businessId: ID.other } });
      const answer = (r: any) => ({ success: r.success, data: r.data, error: r.error });
      for (const action of ['tag_memory', 'update_memory'] as const) {
        const params = (memoryId: string) => (action === 'tag_memory' ? { memoryId, tags: ['x'] } : { memoryId, importance: 'high' });
        const hidden = answer(await connector.execute(cmd('opsNoRev', action, params(money.id))));
        const missing = answer(await connector.execute(cmd('opsNoRev', action, params(`${P}missing`))));
        const other = answer(await connector.execute(cmd('opsNoRev', action, params(foreign.id))));
        expect(hidden, `${action}: hidden`).toEqual(missing);
        expect(other, `${action}: foreign`).toEqual(missing);
        expect(JSON.stringify(hidden)).not.toContain(AMOUNT);
      }
      const after = await db.temporalFlowMemory.findUnique({ where: { id: money.id } });
      expect(after.confidence).toBe(money.confidence);
      expect(after.sourceEventIds).toEqual(money.sourceEventIds);
      const owner = await connector.execute(cmd('owner', 'tag_memory', { memoryId: money.id, tags: ['owner-tag'] }));
      expect(owner.success).toBe(true);
    } finally {
      await clearMemory();
    }
  }, 300_000);

  it('V75R-05 cross-tenant and memberless: the other business\'s owner reads nothing of this business through KEY\'s tools and is refused its routes; a command with no actor reads no memory and no timeline', async () => {
    await clearMemory();
    try {
      await seed();
      const outsider = await everythingFor('outsider');
      for (const surface of ['GET memory', 'GET memory/search', 'GET memory/by-entity', 'POST analyze memoryInsights']) {
        expect(outsider[surface], surface).toBe('status 403');
      }
      for (const surface of ['KEY recall_memory', 'KEY search_memories', 'KEY get_recent_memories', 'KEY get_timeline']) {
        expect(lower(outsider[surface]), surface).not.toContain(REV);
        expect(lower(outsider[surface]), surface).not.toContain(lower(okMarker(1)));
      }
      for (const [action, params] of [
        ['recall_memory', { key: KEY_NOTE }],
        ['search_memories', { query: QUERY }],
        ['get_recent_memories', { limit: 50 }],
        ['get_timeline', { limit: 50 }],
      ] as const) {
        const r = await connector.execute(cmd(null, action, params as any));
        expect(lower(JSON.stringify(r.data ?? null)), `no actor ${action}`).not.toContain(REV);
      }
    } finally {
      await clearMemory();
    }
  }, 300_000);
});
