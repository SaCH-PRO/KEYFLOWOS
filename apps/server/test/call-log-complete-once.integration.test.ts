/**
 * V1-54-CT-ROUTE-ORDER-CALLER review repairs ST-1 and ST-3 (REAL database).
 *
 * ST-1: CallLogService.completeCall read completedAt and then ran
 * update({ where: { id } }) with no completedAt guard, so two members completing
 * the same call both succeeded. Each emitted call_log.completed with its own
 * outcome and completedBy while the row kept one, and the 'callback_requested'
 * default trigger (autoExecute) could fire for an outcome the row does not hold.
 * updateCallLog and deleteCallLog had the same read-then-write on completedAt.
 * Every one of those writes now carries `completedAt: null` in its where
 * (updateMany / deleteMany), so under Postgres' row lock the second writer
 * re-checks the row the first one changed and finds nothing to write.
 *
 * ST-3: createFromContactNextAction looked the contact up by a bare
 * findUnique({ id }) and wrote the call log under contact.businessId. Outside an
 * HTTP request (the staff bridge, a direct service call) no ambient tenant binds
 * that lookup, so a call log was written into another business for this
 * business's member. It now takes the business and looks the contact up within it.
 *
 * The service runs over the real PrismaService against DATABASE_URL with no
 * ambient tenant (as on the staff bridge). The races are real: each round fires
 * its writers together over the client's connection pool. The event emitter is
 * a recorder; it is not on the write path.
 *
 * Fixtures: prefix `v54a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with sqlLikePrefix() in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v54a_';
const ID = {
  owner: `${P}owner`, // OWNER of bizA
  staff: `${P}staff`, // STAFF of bizA
  ownerB: `${P}ownerB`, // OWNER of bizB
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  contactA: `${P}contactA`, // bizA, next action: call
  contactB: `${P}contactB`, // bizB, next action: call
};
const ROUNDS = 12;

let db: any;
let svc: any;
const emitted: Array<[string, any]> = [];
const emitter = { emit: (name: string, payload: any) => { emitted.push([name, payload]); return true; } };

async function cleanup() {
  for (const sql of [
    `DELETE FROM call_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

async function openCall(round: number, tag: string) {
  return db.callLog.create({
    data: {
      id: `${P}${tag}_${round}`,
      businessId: ID.bizA,
      contactId: ID.contactA,
      callerId: ID.owner,
      notes: 'before',
      evidenceIds: [],
    },
  });
}

const completedEventsFor = (callLogId: string) =>
  emitted.filter(([name, p]) => name === 'call_log.completed' && p.callLogId === callLogId).map(([, p]) => p);

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { CallLogService } = await import('../src/modules/call-tasks/call-log.service');
  svc = new CallLogService(new PrismaService() as any, emitter as any);

  await cleanup(); // in case a prior run aborted

  for (const id of [ID.owner, ID.staff, ID.ownerB]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V54A Biz A', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: 'V54A Biz B', ownerId: ID.ownerB } });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_staff`, userId: ID.staff, businessId: ID.bizA, role: 'STAFF', permissionScopes: { crm: 'write' } } });
  await db.membership.create({ data: { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });
  const due = new Date(Date.now() + 60 * 60 * 1000);
  await db.contact.create({ data: { id: ID.contactA, businessId: ID.bizA, firstName: 'V54A', lastName: 'Alpha', nextActionType: 'call', nextActionAt: due } });
  await db.contact.create({ data: { id: ID.contactB, businessId: ID.bizB, firstName: 'V54A', lastName: 'Bravo', nextActionType: 'call', nextActionAt: due } });
}, 120_000);

afterAll(async () => {
  if (db) await cleanup();
});

beforeEach(() => {
  emitted.length = 0;
});

describe('a call log is completed once under concurrent writers (review ST-1)', () => {
  it('three members completing the same call at once: exactly one succeeds, one event, and it names the stored outcome and its completer', async () => {
    const writers = [
      { by: ID.owner, outcome: 'reached' },
      { by: ID.staff, outcome: 'callback_requested' },
      { by: ID.staff, outcome: 'no_answer' },
    ];
    for (let round = 0; round < ROUNDS; round++) {
      const call = await openCall(round, 'cc');
      const results = await Promise.allSettled(
        writers.map((w) => svc.completeCall(ID.bizA, call.id, { outcome: w.outcome }, w.by)),
      );
      const won = results.flatMap((r, i) => (r.status === 'fulfilled' ? [{ i, value: r.value }] : []));
      const lost = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      expect(won, `round ${round}: completions that succeeded`).toHaveLength(1);
      for (const r of lost) expect(r.reason.message).toBe('Call is already completed');

      const row = await db.callLog.findUnique({ where: { id: call.id } });
      const winner = writers[won[0].i];
      expect(row.outcome).toBe(winner.outcome);
      expect(row.completedAt).toBeInstanceOf(Date);
      expect(won[0].value).toMatchObject({ id: call.id, outcome: winner.outcome });

      const events = completedEventsFor(call.id);
      expect(events, `round ${round}: call_log.completed events`).toHaveLength(1);
      expect(events[0]).toMatchObject({ businessId: ID.bizA, callLogId: call.id, outcome: row.outcome, completedBy: winner.by });
    }
  }, 60_000);

  it('an edit racing a completion is refused once the call is completed and never overwrites the completed notes', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const call = await openCall(round, 'cu');
      const [completed, updated] = await Promise.allSettled([
        svc.completeCall(ID.bizA, call.id, { outcome: 'reached', notes: 'completed notes' }, ID.owner),
        svc.updateCallLog(ID.bizA, call.id, { notes: 'late edit' }),
      ]);
      expect(completed.status, `round ${round}`).toBe('fulfilled');
      const row = await db.callLog.findUnique({ where: { id: call.id } });
      // Serial orders only: the edit landed first and the completion then wrote its notes,
      // or the completion landed first and the edit was refused.
      expect(row.notes, `round ${round}`).toBe('completed notes');
      if (updated.status === 'rejected') {
        expect(updated.reason.message).toBe('Cannot update a completed call log');
      }
      expect(completedEventsFor(call.id)).toHaveLength(1);
    }
  }, 60_000);

  it('a delete racing a completion never removes a call that was completed', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const call = await openCall(round, 'cd');
      const [completed, deleted] = await Promise.allSettled([
        svc.completeCall(ID.bizA, call.id, { outcome: 'callback_requested' }, ID.staff),
        svc.deleteCallLog(ID.bizA, call.id),
      ]);
      const row = await db.callLog.findUnique({ where: { id: call.id } });
      const events = completedEventsFor(call.id);
      // exactly one of the two writes took effect
      expect([completed.status, deleted.status].sort(), `round ${round}`).toEqual(['fulfilled', 'rejected']);
      if (completed.status === 'fulfilled') {
        expect(row).toMatchObject({ outcome: 'callback_requested' });
        expect((deleted as PromiseRejectedResult).reason.message).toBe('Cannot delete a completed call log');
        expect(events).toHaveLength(1);
      } else {
        expect(row).toBeNull();
        expect(['Call log not found', 'Call is already completed']).toContain(completed.reason.message);
        expect(events).toEqual([]);
      }
    }
  }, 60_000);
});

describe('createFromContactNextAction stays in the business it is given (review ST-3)', () => {
  it("with no ambient tenant, another business's contact answers 404 and no call log is written anywhere", async () => {
    await expect(svc.createFromContactNextAction(ID.bizA, ID.contactB, ID.owner)).rejects.toThrow('Contact not found');
    expect(await db.callLog.count({ where: { contactId: ID.contactB } })).toBe(0);
    expect(await db.callLog.count({ where: { businessId: ID.bizB } })).toBe(0);
    expect(emitted).toEqual([]);
  });

  it('its own contact gets a call log in its own business, for the member who asked', async () => {
    const log = await svc.createFromContactNextAction(ID.bizA, ID.contactA, ID.staff);
    expect(log).toMatchObject({ businessId: ID.bizA, contactId: ID.contactA, callerId: ID.staff });
    const row = await db.callLog.findUnique({ where: { id: log.id } });
    expect(row).toMatchObject({ businessId: ID.bizA, contactId: ID.contactA, callerId: ID.staff });
    expect(emitted.map(([name]) => name)).toEqual(['call_log.created_from_next_action']);
  });
});
