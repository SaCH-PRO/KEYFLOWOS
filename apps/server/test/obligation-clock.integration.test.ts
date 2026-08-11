/**
 * The obligation clock, against a REAL database.
 *
 * Mocked, every one of these passes whether or not the code works: the upsert
 * that proves idempotency is the DATABASE's unique index doing the work, and a
 * mock cannot disagree with you about a constraint it does not have. So this
 * runs against Postgres with the real extended client, and the only thing
 * stubbed is nothing.
 *
 * Each test below names the control that makes it falsifiable — the specific
 * edit to the production code that must turn it red. Those were run; the
 * results are recorded per test rather than claimed in the aggregate, because
 * "the suite is green" has been true here while a gate quietly measured the
 * wrong thing.
 *
 * Requires DATABASE_URL, same as the other integration tests.
 */
import 'reflect-metadata';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Logger } from '@nestjs/common';
import {
  WORK_OBLIGATION_RAISED,
  WORK_OBLIGATION_SETTLED,
  type ObligationRaisedPayload,
} from '@keyflow/shared';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { db } = require('@keyflow/db') as typeof import('@keyflow/db');
// These two are TypeScript SOURCE, not a built package: they have to come
// through vitest's transform, so they are `import` and not `require`. A
// `require` here resolves nothing and the whole file reports "0 test", which
// reads as a pass in a summary line.
import { ObligationListener } from '../src/modules/command/obligation.listener';
import { CommandService } from '../src/modules/command/command.service';

const P = 'zz_obl_';
const BIZ_A = `${P}bizA`;
const BIZ_B = `${P}bizB`;
const OWNER = `${P}owner`;
const CONTACT_A = `${P}contactA`;

/** The listener takes only PrismaService; `client` is the whole surface it uses. */
const prismaStub = { client: db } as never;
const listener = new ObligationListener(prismaStub);

/** CommandService's other three deps are untouched by findDue. */
const service = new CommandService(prismaStub, {} as never, {} as never, {} as never);

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-08-10T12:00:00.000Z');

function raised(over: Partial<ObligationRaisedPayload> = {}): ObligationRaisedPayload {
  return {
    businessId: BIZ_A,
    sourceModule: 'bookings',
    sourceType: 'booking',
    sourceId: `${P}bk1`,
    actionType: 'REBOOK',
    title: 'Rebook Priya for a trim',
    category: 'SALES',
    dueAt: new Date(now.getTime() + 3 * DAY),
    owedToType: 'CONTACT',
    owedToId: CONTACT_A,
    owedToLabel: 'Priya Ramkissoon',
    ...over,
  };
}

async function wipe() {
  await db.commandItem.deleteMany({ where: { businessId: { in: [BIZ_A, BIZ_B] } } });
}

describe('the obligation clock (real database)', () => {
  beforeAll(async () => {
    // Quieten the listener's deliberate error/warn logging; the tests assert on
    // rows, and a red wall of expected warnings hides a real one.
    Logger.overrideLogger(false);
    await db.user.upsert({
      where: { id: OWNER },
      update: {},
      create: { id: OWNER, email: `${P}owner@example.test`, name: 'Obl Owner' },
    });
    for (const [id, name] of [
      [BIZ_A, 'Obl A'],
      [BIZ_B, 'Obl B'],
    ] as const) {
      await db.business.upsert({
        where: { id },
        update: {},
        create: { id, name, slug: id, ownerId: OWNER },
      });
    }
    // No Contact row is created. CommandItem.contactId carries no foreign key
    // (verified in the model — there is no `contact Contact @relation` line),
    // so seeding one would be scaffolding that tests nothing and couples this
    // file to the CRM schema.
  });

  afterAll(async () => {
    // CommandItem is not soft-deleted, so deleteMany on it is a real delete.
    await wipe();
    // Business and User ARE, so `deleteMany` on them becomes an UPDATE setting
    // deletedAt: the teardown reports success, the rows survive, and the NEXT
    // run's upsert matches a soft-deleted row and seeds nothing. Raw SQL runs
    // underneath the extension. fixture-cleanup-integrity.spec.ts fails the
    // build over this, and it caught this file.
    for (const sql of [
      `DELETE FROM businesses WHERE id IN ('${BIZ_A}', '${BIZ_B}')`,
      `DELETE FROM users WHERE id = '${OWNER}'`,
    ]) {
      await db.$executeRawUnsafe(sql);
    }
    await db.$disconnect();
  });

  beforeEach(wipe);

  // ── 1. Idempotency ────────────────────────────────────────────────────────
  it('raising the same obligation three times produces exactly one row', async () => {
    await Promise.all([
      listener.onRaised(raised()),
      listener.onRaised(raised()),
      listener.onRaised(raised()),
    ]);

    const rows = await db.commandItem.findMany({ where: { businessId: BIZ_A } });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('OBLIGATION');
    expect(rows[0].status).toBe('OPEN');

    // HONEST NOTE ON THIS TEST'S POWER, because the first version of this
    // comment claimed something that turned out to be false.
    //
    // It was written asserting that a findFirst-then-create — the shape at
    // intelligence/command-bridge.service.ts:31-46 that this replaces — would
    // yield 2-3 rows here. That control was then actually run, and it PASSED:
    // 12/12 green with the check-then-act version installed. Three awaits in
    // one Node process against one connection pool do not reliably interleave
    // their SELECTs before the first INSERT commits, so this test does not
    // discriminate between the two implementations and must not be quoted as
    // if it does.
    //
    // What it does prove is worth keeping — the listener is idempotent under
    // ordinary repetition, which is what a nightly producer actually does. The
    // guarantee under genuine concurrency is the DATABASE's, and the next test
    // is the one that demonstrates it.
  });

  it('the five-tuple is enforced by the database, not by the listener', async () => {
    // This is the assertion that makes the upsert load-bearing. A second
    // insert on the same five-tuple is rejected by the unique index, so no
    // interleaving of two processes — replicas, a worker and a request, two
    // requests — can produce a duplicate obligation. check-then-act cannot
    // claim that at any level of test concurrency, because the guarantee is
    // not in the application at all.
    await listener.onRaised(raised());

    const dup = db.commandItem.create({
      data: {
        businessId: BIZ_A,
        sourceModule: 'bookings',
        sourceType: 'booking',
        sourceId: `${P}bk1`,
        actionType: 'REBOOK',
        title: 'A second rebook for the same appointment',
        category: 'SALES',
      },
    });

    await expect(dup).rejects.toMatchObject({ code: 'P2002' });
    expect(await db.commandItem.count({ where: { businessId: BIZ_A } })).toBe(1);
    // CONTROL: drop the @@unique from CommandItem and migrate. The insert
    // succeeds and the count is 2. Not run against the shared database — the
    // constraint is asserted directly here instead, which is the same evidence
    // without dropping an index on a schema other suites are using.
  });

  it('a different actionType on the same source is a different obligation', async () => {
    await listener.onRaised(raised());
    await listener.onRaised(raised({ actionType: 'COLLECT_FEEDBACK', title: 'Ask Priya how it went' }));

    const rows = await db.commandItem.findMany({ where: { businessId: BIZ_A } });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.actionType).sort()).toEqual(['COLLECT_FEEDBACK', 'REBOOK']);
  });

  // ── 2. Re-raising must not resurrect ──────────────────────────────────────
  it('re-raising a DISMISSED obligation refreshes its facts and leaves it dismissed', async () => {
    await listener.onRaised(raised());
    await db.commandItem.updateMany({
      where: { businessId: BIZ_A },
      data: { status: 'DISMISSED', dismissedAt: new Date() },
    });

    // A nightly producer does not remember what it emitted yesterday.
    const newDue = new Date(now.getTime() + 9 * DAY);
    await listener.onRaised(raised({ dueAt: newDue, title: 'Rebook Priya for a cut and colour' }));

    const rows = await db.commandItem.findMany({ where: { businessId: BIZ_A } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('DISMISSED');
    expect(rows[0].title).toBe('Rebook Priya for a cut and colour');
    expect(rows[0].dueAt?.toISOString()).toBe(newDue.toISOString());
    // CONTROL: add `status: 'OPEN'` to the update clause in the listener.
    // Verified this assertion, and only this one, goes red — the title and
    // dueAt expectations still pass, which is the point: the facts SHOULD
    // refresh and the disposition should not.
  });

  // ── 3. Tenant scope ───────────────────────────────────────────────────────
  it('the due query returns this business and not the other', async () => {
    await listener.onRaised(raised());
    await listener.onRaised(raised({ businessId: BIZ_B, sourceId: `${P}bk_b`, title: "B's rebook" }));

    const a = await service.findDue(BIZ_A, { now, windowDays: 7 });
    const b = await service.findDue(BIZ_B, { now, windowDays: 7 });

    expect(a.items).toHaveLength(1);
    expect(a.items[0].title).toBe('Rebook Priya for a trim');
    expect(b.items).toHaveLength(1);
    expect(b.items[0].title).toBe("B's rebook");
    // CONTROL: delete `businessId` from findDue's where. Verified: A returns 2.
    //
    // This test carries more weight than it looks. The tenant extension is
    // HTTP-only — activeBusinessId() is undefined on the event bus and in any
    // worker — so for this path the explicit `where` is the ONLY scoping, and
    // nothing else in the codebase would report its absence.
  });

  // ── 4. The clock ──────────────────────────────────────────────────────────
  it('answers "what is due this week" — and counts what is already late', async () => {
    await listener.onRaised(raised({ sourceId: `${P}late`, dueAt: new Date(now.getTime() - 2 * DAY), title: 'Late one' }));
    await listener.onRaised(raised({ sourceId: `${P}soon`, dueAt: new Date(now.getTime() + 2 * DAY), title: 'Due Wednesday' }));
    await listener.onRaised(raised({ sourceId: `${P}far`, dueAt: new Date(now.getTime() + 30 * DAY), title: 'Next month' }));

    const due = await service.findDue(BIZ_A, { now, windowDays: 7 });

    expect(due.items.map((i) => i.title)).toEqual(['Late one', 'Due Wednesday']);
    expect(due.total).toBe(2);
    expect(due.overdueCount).toBe(1);
    expect(due.items[0].overdue).toBe(true);
    expect(due.items[0].daysUntilDue).toBe(-2);
    expect(due.items[1].overdue).toBe(false);
    // Oldest first, not highest-priority first: a question about time gets an
    // answer ordered by time.
  });

  it('excludes a snoozed obligation until its snooze expires', async () => {
    await listener.onRaised(raised());
    await db.commandItem.updateMany({
      where: { businessId: BIZ_A },
      data: { status: 'SNOOZED', snoozedUntil: new Date(now.getTime() + 4 * DAY) },
    });
    expect((await service.findDue(BIZ_A, { now, windowDays: 7 })).items).toHaveLength(0);

    const later = new Date(now.getTime() + 5 * DAY);
    expect((await service.findDue(BIZ_A, { now: later, windowDays: 7 })).items).toHaveLength(1);
  });

  it('does not answer with suggestions', async () => {
    // Everything already in this table is a SUGGESTION. If they leaked into
    // the due list the number would stop meaning "what I owe" and people would
    // stop reading it.
    await db.commandItem.create({
      data: {
        businessId: BIZ_A,
        sourceModule: 'intelligence',
        sourceType: 'insight',
        sourceId: `${P}sugg`,
        actionType: 'CONSIDER_UPSELL',
        title: 'Consider an upsell',
        category: 'SALES',
        status: 'OPEN',
        dueAt: new Date(now.getTime() + DAY),
      },
    });
    await listener.onRaised(raised());

    const due = await service.findDue(BIZ_A, { now, windowDays: 7 });
    expect(due.items.map((i) => i.title)).toEqual(['Rebook Priya for a trim']);
    // CONTROL: drop `kind: 'OBLIGATION'` from findDue's where. Verified: 2.
  });

  // ── 5. Settling ───────────────────────────────────────────────────────────
  it('settling discharges the obligation and drops it out of the due list', async () => {
    await listener.onRaised(raised());
    await listener.onSettled({
      businessId: BIZ_A,
      sourceModule: 'bookings',
      sourceType: 'booking',
      sourceId: `${P}bk1`,
      actionType: 'REBOOK',
      dischargeRef: 'bookings_create_booking',
    });

    const row = (await db.commandItem.findMany({ where: { businessId: BIZ_A } }))[0];
    expect(row.status).toBe('COMPLETED');
    expect(row.dischargedAt).toBeInstanceOf(Date);
    expect(row.dischargeRef).toBe('bookings_create_booking');
    expect((await service.findDue(BIZ_A, { now, windowDays: 7 })).items).toHaveLength(0);
  });

  it('settling an obligation that was never raised is a no-op, not an error', async () => {
    await expect(
      listener.onSettled({
        businessId: BIZ_A,
        sourceModule: 'bookings',
        sourceType: 'booking',
        sourceId: 'never-existed',
        actionType: 'REBOOK',
      }),
    ).resolves.toBeUndefined();
    // `update` would throw P2025 here and turn an ordinary race — the human
    // ticked it off before the producer noticed — into a logged error.
  });

  it('settling one business cannot discharge another business\'s obligation', async () => {
    await listener.onRaised(raised());
    await listener.onRaised(raised({ businessId: BIZ_B }));

    // Same five-tuple except the tenant.
    await listener.onSettled({
      businessId: BIZ_B,
      sourceModule: 'bookings',
      sourceType: 'booking',
      sourceId: `${P}bk1`,
      actionType: 'REBOOK',
    });

    const a = await db.commandItem.findFirst({ where: { businessId: BIZ_A } });
    const b = await db.commandItem.findFirst({ where: { businessId: BIZ_B } });
    expect(a?.dischargedAt).toBeNull();
    expect(b?.dischargedAt).toBeInstanceOf(Date);
  });

  // ── 5b. The loop actually closes ──────────────────────────────────────────
  it('rebooking the client settles the rebook, without knowing which appointment raised it', async () => {
    // The bug this pins. A completed appointment raises REBOOK keyed on THAT
    // appointment's id. The new booking knows only the CONTACT — it cannot name
    // the five-tuple — so before the by-party settle existed, the obligation
    // stayed open after the client was genuinely rebooked and the due list
    // filled with work that had already happened.
    await listener.onRaised(raised({ sourceId: `${P}oldbooking` }));
    expect((await service.findDue(BIZ_A, { now, windowDays: 7 })).items).toHaveLength(1);

    // Exactly what bookings.service emits on booking.created: no sourceId.
    await listener.onSettled({
      businessId: BIZ_A,
      actionType: 'REBOOK',
      owedToId: CONTACT_A,
      dischargeRef: 'booking:new-one',
    });

    const row = (await db.commandItem.findMany({ where: { businessId: BIZ_A } }))[0];
    expect(row.dischargedAt).toBeInstanceOf(Date);
    expect(row.dischargeRef).toBe('booking:new-one');
    expect((await service.findDue(BIZ_A, { now, windowDays: 7 })).items).toHaveLength(0);
  });

  it('settling by party does not discharge a different kind of obligation to the same person', async () => {
    // Rebooking someone does not settle the invoice you owe them a chase on.
    await listener.onRaised(raised({ sourceId: `${P}bk_r`, actionType: 'REBOOK' }));
    await listener.onRaised(
      raised({ sourceId: `${P}inv_c`, actionType: 'CHASE_PAYMENT', title: 'Chase Priya' }),
    );

    await listener.onSettled({
      businessId: BIZ_A,
      actionType: 'REBOOK',
      owedToId: CONTACT_A,
      dischargeRef: 'booking:x',
    });

    const open = await service.findDue(BIZ_A, { now, windowDays: 7 });
    expect(open.items.map((i) => i.actionType)).toEqual(['CHASE_PAYMENT']);
  });

  it('settling by party cannot reach another business', async () => {
    await listener.onRaised(raised({ sourceId: `${P}bk_a` }));
    await listener.onRaised(raised({ businessId: BIZ_B, sourceId: `${P}bk_b` }));

    // Same contact id, same actionType, different tenant.
    await listener.onSettled({ businessId: BIZ_B, actionType: 'REBOOK', owedToId: CONTACT_A });

    expect((await db.commandItem.findFirst({ where: { businessId: BIZ_A } }))?.dischargedAt).toBeNull();
    expect(
      (await db.commandItem.findFirst({ where: { businessId: BIZ_B } }))?.dischargedAt,
    ).toBeInstanceOf(Date);
  });

  // ── 6. Refusing a partial tuple ───────────────────────────────────────────
  it('refuses an obligation with no clock, rather than storing one that can never be due', async () => {
    await listener.onRaised({ ...raised(), dueAt: undefined as never });
    expect(await db.commandItem.count({ where: { businessId: BIZ_A } })).toBe(0);
  });

  it('refuses a partial identity tuple', async () => {
    // A missing sourceId would land on a DIFFERENT five-tuple than the settle
    // event will later name, so the obligation could never be discharged and
    // would sit in "due this week" forever.
    await listener.onRaised({ ...raised(), sourceId: '' });
    expect(await db.commandItem.count({ where: { businessId: BIZ_A } })).toBe(0);
  });
});
