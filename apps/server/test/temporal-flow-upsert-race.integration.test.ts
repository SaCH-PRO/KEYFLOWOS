/**
 * FU-TEMPORAL-FLOW-INBOX-SCOPE, Codex P1 on PR #226 (REAL database): a timeline write by external id must authorize
 * and write in one step. The SEC N-3 repair checked visibility (find the existing row, then find it again under the
 * writer's filter, else 403) and then upserted, as separate statements. A protected event with the same
 * (businessId, source, externalId) inserted by a connector after the check and before the upsert was then updated in
 * place by a member who may not read it: a KEY Inbox, calendar or money event overwritten, and its kept fields
 * (the sender handle) answered back.
 *
 * The race is made deterministic: TemporalFlowService is given a PrismaService whose temporalFlowEvent delegate inserts
 * the protected row immediately before the first write statement of the emit (create, upsert, update, updateMany),
 * whatever reads came before it. That is the latest moment a concurrent insert can land before the member's write.
 * Every statement is real (the delegate forwards to the real client); nothing else is mocked.
 *
 * Requires DATABASE_URL. Every seeded row carries the `v71z_` prefix and is hard-deleted by raw SQL in beforeAll and
 * afterAll. No $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 60_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v71z_';
const ID = {
  owner: `${P}owner`, // OWNER of biz, role defaults: reads every event-owning module (no filter)
  bookingsWriter: `${P}bwriter`, // STAFF of biz, { bookings: write }: no operations, revenue or storefront read
  biz: `${P}biz`,
};
const SENDER_HANDLE = `${P}sender_handle_secret`;
const WRITES = new Set(['create', 'createMany', 'upsert', 'update', 'updateMany']);

let db: any;
let prismaService: any;
let TemporalFlowService: any;
let counter = 0;

async function cleanup() {
  for (const sql of [
    `DELETE FROM temporal_flow_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

/** The KEY Inbox event a connector writes under `externalId` (operations-owned; its summary is a sender handle). */
const protectedRow = (externalId: string) => ({
  id: `${P}ev_${externalId.slice(P.length)}`,
  businessId: ID.biz,
  source: 'MANUAL',
  type: 'key_inbox.message_received',
  module: 'key_inbox',
  title: `${P}inbox message`,
  summary: SENDER_HANDLE,
  occurredAt: new Date(),
  visibility: 'USER',
  payload: { senderHandle: SENDER_HANDLE },
  externalId,
});

/**
 * A TemporalFlowService over the real client, except that its event delegate inserts `row` (through the real client)
 * immediately before the first write statement it is asked to make.
 */
function racedService(row: Record<string, unknown>) {
  const real = prismaService.client;
  let inserted = false;
  const delegate = new Proxy(real.temporalFlowEvent, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      return async (...args: unknown[]) => {
        if (!inserted && WRITES.has(String(prop))) {
          inserted = true;
          await db.temporalFlowEvent.create({ data: row });
        }
        return value.apply(target, args);
      };
    },
  });
  const client = new Proxy(real, {
    get(target, prop, receiver) {
      return prop === 'temporalFlowEvent' ? delegate : Reflect.get(target, prop, receiver);
    },
  });
  return new TemporalFlowService({ client } as any);
}

const memberInput = (externalId: string) => ({
  businessId: ID.biz,
  source: 'MANUAL',
  type: 'manual.note',
  title: `${P}member overwrite`,
  externalId,
});

const nextExternalId = () => `${P}ext_${++counter}`;
const rowOf = (externalId: string) =>
  db.temporalFlowEvent.findFirst({
    where: { businessId: ID.biz, source: 'MANUAL', externalId },
    select: { type: true, module: true, title: true, summary: true },
  });

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  ({ TemporalFlowService } = await import('../src/modules/temporal-flow/temporal-flow.service'));
  prismaService = new PrismaService();
  await cleanup();
  for (const id of [ID.owner, ID.bookingsWriter]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.biz, name: 'V71Z Biz', ownerId: ID.owner } });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });
  await db.membership.create({
    data: { id: `${P}m_bwriter`, userId: ID.bookingsWriter, businessId: ID.biz, role: 'STAFF', permissionScopes: { bookings: 'write' } },
  });
}, 120_000);

afterAll(async () => {
  if (db) await cleanup();
});

beforeEach(() => {
  counter += 10;
});

describe('Codex P1 #226: a timeline write by external id authorizes and writes in one step', () => {
  it('RED-BEFORE: a protected event inserted between the check and the write is not overwritten by a writer who cannot read it (403, row unchanged)', async () => {
    const externalId = nextExternalId();
    const svc = racedService(protectedRow(externalId));
    const filter = await svc.readerFilter(ID.biz, { id: ID.bookingsWriter, role: 'USER' });
    expect(filter).toBeDefined();
    let error: any;
    let result: any;
    try {
      result = await svc.emit(memberInput(externalId), filter);
    } catch (err) {
      error = err;
    }
    expect(JSON.stringify(result ?? null)).not.toContain(SENDER_HANDLE);
    expect(error?.status, `answered ${JSON.stringify(result ?? null)}`).toBe(403);
    expect(await rowOf(externalId)).toEqual({ type: 'key_inbox.message_received', module: 'key_inbox', title: `${P}inbox message`, summary: SENDER_HANDLE });
  });

  it('a protected event already there (no race): the same 403, row unchanged', async () => {
    const externalId = nextExternalId();
    await db.temporalFlowEvent.create({ data: protectedRow(externalId) });
    const svc = new TemporalFlowService(prismaService);
    const filter = await svc.readerFilter(ID.biz, { id: ID.bookingsWriter, role: 'USER' });
    await expect(svc.emit(memberInput(externalId), filter)).rejects.toMatchObject({ status: 403 });
    expect((await rowOf(externalId))?.summary).toBe(SENDER_HANDLE);
  });

  it('a filtered writer creates a new event, and upserts their own visible event in place (same id, new fields)', async () => {
    const externalId = nextExternalId();
    const svc = new TemporalFlowService(prismaService);
    const filter = await svc.readerFilter(ID.biz, { id: ID.bookingsWriter, role: 'USER' });
    const first = await svc.emit({ ...memberInput(externalId), title: `${P}own 1` }, filter);
    const again = await svc.emit({ ...memberInput(externalId), title: `${P}own 2` }, filter);
    expect(again.id).toBe(first.id);
    expect(again.title).toBe(`${P}own 2`);
    expect(again.type).toBe('manual.note');
  });

  it('a filtered writer whose own visible event is raced by nothing else updates it (control for the conflict path)', async () => {
    const externalId = nextExternalId();
    await db.temporalFlowEvent.create({ data: { ...protectedRow(externalId), type: 'manual.event', module: null, summary: null, payload: {} } });
    const svc = new TemporalFlowService(prismaService);
    const filter = await svc.readerFilter(ID.biz, { id: ID.bookingsWriter, role: 'USER' });
    const updated = await svc.emit(memberInput(externalId), filter);
    expect(updated.title).toBe(`${P}member overwrite`);
    expect(updated.id).toBe(`${P}ev_${externalId.slice(P.length)}`);
  });

  it('control: a writer with full sight (no filter) upserts exactly as before, the raced protected row included', async () => {
    const externalId = nextExternalId();
    const svc = racedService(protectedRow(externalId));
    expect(await svc.readerFilter(ID.biz, { id: ID.owner, role: 'USER' })).toBeUndefined();
    const result = await svc.emit(memberInput(externalId));
    expect(result.title).toBe(`${P}member overwrite`);
    expect(result.type).toBe('manual.note');
    // As the upsert always did: fields the input leaves undefined are kept.
    expect(result.summary).toBe(SENDER_HANDLE);
  });
});
