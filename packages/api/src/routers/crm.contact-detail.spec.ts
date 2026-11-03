/**
 * V1-26-CT-TRPC-VISIBILITY (PRS-M13, M06): tRPC crm.contactDetail applies CRM
 * record visibility before it reads a contact's child rows.
 *
 * The router is mounted (apps/server/src/trpc.module.ts) but no procedure is
 * reachable today: the Nest 11 exact-path mount `forRoutes({ path: '/trpc' })`
 * answers 404 for /trpc/<procedure> (apps/server/src/trpc.module.spec.ts).
 * The hole is latent, one mount-path fix away from live, and this spec gates
 * the procedure for that day. crm.contactDetail checks business access only
 * (assertBusinessAccess), then reads the contact and its events, notes and
 * tasks, so a STAFF member limited to their own book would read another
 * member's PRIVATE contact in full. The REST detail route refuses that read
 * (V1-08: assertContactVisible in
 * apps/server/src/modules/crm/crm-permissions.helper.ts answers 404
 * 'Contact not found', the same as an unknown id, before any child read).
 *
 * ctx.db is an in-memory fake that EVALUATES the `where` it is handed (equality,
 * null, `in`, OR/AND, `members.some`, `shares.some`) and throws on anything
 * else, so a visibility clause added to a query is honoured rather than
 * ignored, and the fake never answers "match" for an operator it does not
 * understand. It also throws on an `undefined` filter value: Prisma DROPS such
 * a predicate (fails open) where a naive fake would deny the row (fail
 * closed), so a clause built from an undefined actor id must not pass here
 * and leak in production.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crmRouter } from './crm';
import type { AppContext } from '../trpc';

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

const BIZ = 'v126_biz';
const OTHER_BIZ = 'v126_biz_other';

const OWNER = 'v126_user_owner';
const STAFF_OWNED = 'v126_user_staff_owned'; // crm_view = 'owned' ("my book")
const STAFF_READ = 'v126_user_staff_read'; // default STAFF: crm 'read', view all
const STAFF_OTHER = 'v126_user_staff_other'; // owns the PRIVATE rows below
const OUTSIDER = 'v126_user_outsider'; // member of another business only

const C_PRIVATE_OTHER = 'v126_contact_private_other';
const C_TEAM_OTHER = 'v126_contact_team_other';
const C_PRIVATE_MINE = 'v126_contact_private_mine';
const C_PRIVATE_SHARED = 'v126_contact_private_shared';
const C_DELETED = 'v126_contact_deleted';
const C_OTHER_TENANT = 'v126_contact_other_tenant'; // belongs to OTHER_BIZ
const C_UNKNOWN = 'v126_contact_does_not_exist';

function tables() {
  return {
    user: [
      { id: OWNER, email: 'owner@v126.test', role: 'USER' },
      { id: STAFF_OWNED, email: 'owned@v126.test', role: 'USER' },
      { id: STAFF_READ, email: 'read@v126.test', role: 'USER' },
      { id: STAFF_OTHER, email: 'other@v126.test', role: 'USER' },
      { id: OUTSIDER, email: 'outsider@v126.test', role: 'USER' },
    ] as Row[],
    business: [
      { id: BIZ, ownerId: OWNER, name: 'V1-26 business' },
      { id: OTHER_BIZ, ownerId: OUTSIDER, name: 'V1-26 other business' },
    ] as Row[],
    membership: [
      { id: 'm1', userId: OWNER, businessId: BIZ, role: 'OWNER', permissionScopes: null },
      { id: 'm2', userId: STAFF_OWNED, businessId: BIZ, role: 'STAFF', permissionScopes: { crm_view: 'owned' } },
      { id: 'm3', userId: STAFF_READ, businessId: BIZ, role: 'STAFF', permissionScopes: null },
      { id: 'm4', userId: STAFF_OTHER, businessId: BIZ, role: 'STAFF', permissionScopes: null },
      { id: 'm5', userId: OUTSIDER, businessId: OTHER_BIZ, role: 'OWNER', permissionScopes: null },
    ] as Row[],
    contact: [
      { id: C_PRIVATE_OTHER, businessId: BIZ, ownerId: STAFF_OTHER, visibility: 'PRIVATE', deletedAt: null, firstName: 'Private', lastName: 'Other' },
      { id: C_TEAM_OTHER, businessId: BIZ, ownerId: STAFF_OTHER, visibility: 'TEAM', deletedAt: null, firstName: 'Team', lastName: 'Other' },
      { id: C_PRIVATE_MINE, businessId: BIZ, ownerId: STAFF_OWNED, visibility: 'PRIVATE', deletedAt: null, firstName: 'Private', lastName: 'Mine' },
      { id: C_PRIVATE_SHARED, businessId: BIZ, ownerId: STAFF_OTHER, visibility: 'PRIVATE', deletedAt: null, firstName: 'Private', lastName: 'Shared' },
      { id: C_DELETED, businessId: BIZ, ownerId: STAFF_OTHER, visibility: 'TEAM', deletedAt: new Date('2026-01-01T00:00:00Z'), firstName: 'Deleted', lastName: 'Other' },
      { id: C_OTHER_TENANT, businessId: OTHER_BIZ, ownerId: OUTSIDER, visibility: 'TEAM', deletedAt: null, firstName: 'Other', lastName: 'Tenant' },
    ] as Row[],
    contactShare: [
      { id: 's1', businessId: BIZ, contactId: C_PRIVATE_SHARED, userId: STAFF_OWNED },
    ] as Row[],
  };
}

/**
 * One event, note and task per contact, in the contact's own business, plus a
 * row of ANOTHER business that names a BIZ contact id (the shape a writer that
 * never checks the contact's tenant leaves behind). The child reads must keep
 * their businessId predicate, or that row comes back with BIZ's contact.
 */
const CHILD_ROWS: Array<{ tag: string; businessId: string; contactId: string }> = [
  ...[C_PRIVATE_OTHER, C_TEAM_OTHER, C_PRIVATE_MINE, C_PRIVATE_SHARED, C_DELETED].map((contactId) => ({
    tag: contactId,
    businessId: BIZ,
    contactId,
  })),
  { tag: C_OTHER_TENANT, businessId: OTHER_BIZ, contactId: C_OTHER_TENANT },
  { tag: `foreign_${C_PRIVATE_OTHER}`, businessId: OTHER_BIZ, contactId: C_PRIVATE_OTHER },
];

function childRows(kind: string): Row[] {
  return CHILD_ROWS.map(({ tag, businessId, contactId }) => ({
    id: `${kind}_${tag}`,
    businessId,
    contactId,
    body: `${kind} of ${contactId} in ${businessId}`,
  }));
}

/**
 * Evaluate a Prisma-style `where` against one row. Throws on an operator it
 * does not know, so an unsupported clause fails the test loudly instead of
 * matching everything. Throws on an `undefined` value anywhere inside a
 * `where` too: Prisma drops that predicate, so `{ ownerId: undefined }` matches
 * EVERY row there, and `{ shares: { some: { userId: undefined } } }` matches
 * any row with any share. Denying the row here would let a clause that fails
 * open in production pass every refusal case.
 */
function matches(row: Row, where: Where | undefined, relations: Record<string, (row: Row) => Row[]>): boolean {
  if (!where) return true;
  return matchesClause(row, where, relations, 'where');
}

function clauseOf(value: unknown, path: string): Where {
  if (value === undefined) {
    throw new Error(`fake db: undefined filter value at ${path} (Prisma drops it, so the clause fails open)`);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`fake db: ${path} is not a where object`);
  }
  return value as Where;
}

function matchesClause(row: Row, where: Where, relations: Record<string, (row: Row) => Row[]>, path: string): boolean {
  for (const [key, cond] of Object.entries(where)) {
    const at = `${path}.${key}`;
    if (cond === undefined) {
      throw new Error(`fake db: undefined filter value at ${at} (Prisma drops it, so the clause fails open)`);
    }
    if (key === 'OR') {
      if (!Array.isArray(cond)) throw new Error(`fake db: ${at} is not an array`);
      const any = cond.map((w, i) => clauseOf(w, `${at}[${i}]`));
      if (!any.some((w, i) => matchesClause(row, w, relations, `${at}[${i}]`))) return false;
      continue;
    }
    if (key === 'AND') {
      const all = (Array.isArray(cond) ? cond : [cond]).map((w, i) => clauseOf(w, `${at}[${i}]`));
      if (!all.every((w, i) => matchesClause(row, w, relations, `${at}[${i}]`))) return false;
      continue;
    }
    if (key in relations) {
      const rel = clauseOf(cond, at);
      const extra = Object.keys(rel).filter((k) => k !== 'some');
      if (extra.length > 0) throw new Error(`fake db: unsupported relation filter ${key}.${extra.join(',')}`);
      const some = clauseOf(rel.some, `${at}.some`);
      if (!relations[key](row).some((r) => matchesClause(r, some, {}, `${at}.some`))) return false;
      continue;
    }
    if (cond === null || typeof cond !== 'object' || cond instanceof Date) {
      if ((row[key] ?? null) !== cond) return false;
      continue;
    }
    const ops = cond as Where;
    for (const [op, value] of Object.entries(ops)) {
      if (value === undefined) {
        throw new Error(`fake db: undefined filter value at ${at}.${op} (Prisma drops it, so the clause fails open)`);
      }
      if (op === 'in') {
        if (!(value as unknown[]).includes(row[key])) return false;
      } else if (op === 'equals') {
        if ((row[key] ?? null) !== value) return false;
      } else {
        throw new Error(`fake db: unsupported operator ${key}.${op}`);
      }
    }
  }
  return true;
}

function makeDb() {
  const t = tables();
  const relations = {
    business: { members: (b: Row) => t.membership.filter((m) => m.businessId === b.id) },
    contact: { shares: (c: Row) => t.contactShare.filter((s) => s.contactId === c.id) },
  } as Record<string, Record<string, (row: Row) => Row[]>>;

  const findAll = (model: keyof ReturnType<typeof tables>, where?: Where) =>
    t[model].filter((row) => matches(row, where, relations[model] ?? {}));

  const children = (kind: string) =>
    vi.fn(async ({ where }: { where?: Where } = {}) => childRows(kind).filter((row) => matches(row, where, {})));

  return {
    user: {
      findUnique: vi.fn(async ({ where }: { where: Where }) => findAll('user', where)[0] ?? null),
      findFirst: vi.fn(async ({ where }: { where?: Where } = {}) => findAll('user', where)[0] ?? null),
    },
    business: {
      findFirst: vi.fn(async ({ where, select }: { where?: Where; select?: Where } = {}) => {
        const row = findAll('business', where)[0];
        if (!row) return null;
        const membersSelect = select?.members as { where?: Where } | undefined;
        return {
          ...row,
          members: t.membership.filter((m) => m.businessId === row.id && matches(m, membersSelect?.where, {})),
        };
      }),
    },
    membership: {
      findUnique: vi.fn(async ({ where }: { where: Where }) => {
        const key = where.userId_businessId as Where | undefined;
        return findAll('membership', key ?? where)[0] ?? null;
      }),
      findFirst: vi.fn(async ({ where }: { where?: Where } = {}) => findAll('membership', where)[0] ?? null),
    },
    contact: {
      findFirst: vi.fn(async ({ where }: { where?: Where } = {}) => findAll('contact', where)[0] ?? null),
      findUnique: vi.fn(async ({ where }: { where: Where }) => findAll('contact', where)[0] ?? null),
      findMany: vi.fn(async ({ where }: { where?: Where } = {}) => findAll('contact', where)),
    },
    contactShare: {
      findFirst: vi.fn(async ({ where }: { where?: Where } = {}) => findAll('contactShare', where)[0] ?? null),
      findMany: vi.fn(async ({ where }: { where?: Where } = {}) => findAll('contactShare', where)),
    },
    contactEvent: { findMany: children('event') },
    contactNote: { findMany: children('note') },
    contactTask: { findMany: children('task') },
  };
}

type FakeDb = ReturnType<typeof makeDb>;

let db: FakeDb;

// crmRouter is exported as AnyRouter, so its caller's procedures are untyped;
// this names the one procedure under test.
type ContactDetailCaller = {
  contactDetail: (input: { businessId: string; contactId: string }) => Promise<{
    contact: Row | null;
    events: Row[];
    notes: Row[];
    tasks: Row[];
  }>;
};

function callerFor(userId: string): ContactDetailCaller {
  const ctx: AppContext = {
    db: db as unknown as AppContext['db'],
    eventBus: { emit: vi.fn() },
    user: { id: userId, email: `${userId}@v126.test` },
  };
  return crmRouter.createCaller(ctx) as unknown as ContactDetailCaller;
}

function expectNoChildRead() {
  expect(db.contactEvent.findMany).not.toHaveBeenCalled();
  expect(db.contactNote.findMany).not.toHaveBeenCalled();
  expect(db.contactTask.findMany).not.toHaveBeenCalled();
}

beforeEach(() => {
  db = makeDb();
});

describe('crm.contactDetail record visibility (V1-26, PRS-M13, M06)', () => {
  /**
   * RED, BLOCKED (V1-26 deviation): the three record-visibility refusals were
   * recorded failing at bb6b86d4 (commit "V1-26-CT-TRPC-VISIBILITY tests
   * first": each call resolved with the contact plus its events, notes and
   * tasks) and still fail. The fix must reuse the rule V1-08 landed for REST
   * (resolveCrmAccess + visibilityClause + assertContactVisible in
   * apps/server/src/modules/crm/crm-permissions.helper.ts), and packages/api
   * cannot reach it: apps/server depends on @keyflow/api (not the reverse), the
   * helper takes the Nest PrismaService and throws Nest exceptions, and a
   * relative import fails `tsc -p packages/api` with TS6059 (outside rootDir).
   * Reuse needs a shared helper outside this packet's write set (the pure rule
   * moved to a workspace package both sides import, or a visibility check the
   * server injects into AppContext), which needs an owner ruling, and the
   * packet forbids copying the rule here.
   *
   * They are `it.fails`, not `it.todo`, so CI runs them: they pass while the
   * hole is live, and the day the rule lands they start failing, which forces
   * the follow-up to turn each one back into `it`. Each expects the message an
   * unknown id gets as well as the code, so a hidden contact and an absent one
   * cannot be told apart once they flip.
   */
  describe('refused by record visibility (RED, blocked on a shared visibility helper)', () => {
    it.fails("[RED] a STAFF member limited to their own book (crm_view 'owned') gets NOT_FOUND for another member's PRIVATE contact, and events, notes and tasks are never read", async () => {
      await expect(
        callerFor(STAFF_OWNED).contactDetail({ businessId: BIZ, contactId: C_PRIVATE_OTHER }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Contact not found' });
      expectNoChildRead();
    });

    it.fails("[RED] a STAFF member limited to their own book gets NOT_FOUND for another member's TEAM contact", async () => {
      await expect(
        callerFor(STAFF_OWNED).contactDetail({ businessId: BIZ, contactId: C_TEAM_OTHER }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Contact not found' });
      expectNoChildRead();
    });

    it.fails("[RED] a STAFF member who views all (default crm 'read') still gets NOT_FOUND for another member's PRIVATE contact", async () => {
      await expect(
        callerFor(STAFF_READ).contactDetail({ businessId: BIZ, contactId: C_PRIVATE_OTHER }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Contact not found' });
      expectNoChildRead();
    });
  });

  describe('refused: no live contact of this business, NOT_FOUND before any child row is read', () => {
    it("an unknown contact id answers NOT_FOUND 'Contact not found' (the REST detail route's 404), and no child row is read", async () => {
      await expect(
        callerFor(OWNER).contactDetail({ businessId: BIZ, contactId: C_UNKNOWN }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Contact not found' });
      expectNoChildRead();
    });

    it('a soft-deleted contact answers the same NOT_FOUND, and its events, notes and tasks are never read', async () => {
      await expect(
        callerFor(OWNER).contactDetail({ businessId: BIZ, contactId: C_DELETED }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Contact not found' });
      expectNoChildRead();
    });

    it("another business's contact id under the caller's own businessId answers NOT_FOUND, and none of its child rows are read", async () => {
      // The OWNER passes visibility outright (visibilityClause is null for
      // them), so only the tenant predicate on the contact read stands between
      // this call and OTHER_BIZ's row.
      await expect(
        callerFor(OWNER).contactDetail({ businessId: BIZ, contactId: C_OTHER_TENANT }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Contact not found' });
      expect(db.contact.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: C_OTHER_TENANT, businessId: BIZ }) }),
      );
      expectNoChildRead();
    });
  });

  describe('allowed: the row and its child rows', () => {
    it("the OWNER gets another member's PRIVATE contact with its own business's events, notes and tasks only", async () => {
      const res = await callerFor(OWNER).contactDetail({ businessId: BIZ, contactId: C_PRIVATE_OTHER });
      expect(res.contact).toMatchObject({ id: C_PRIVATE_OTHER, businessId: BIZ, visibility: 'PRIVATE' });
      // OTHER_BIZ holds a row naming this contact id too; the child reads'
      // businessId predicate keeps it out.
      expect(res.events.map((r: Row) => r.id)).toEqual([`event_${C_PRIVATE_OTHER}`]);
      expect(res.notes.map((r: Row) => r.id)).toEqual([`note_${C_PRIVATE_OTHER}`]);
      expect(res.tasks.map((r: Row) => r.id)).toEqual([`task_${C_PRIVATE_OTHER}`]);
    });

    it('a STAFF member limited to their own book gets their own PRIVATE contact with its child rows', async () => {
      const res = await callerFor(STAFF_OWNED).contactDetail({ businessId: BIZ, contactId: C_PRIVATE_MINE });
      expect(res.contact).toMatchObject({ id: C_PRIVATE_MINE });
      expect(res.events.map((r: Row) => r.contactId)).toEqual([C_PRIVATE_MINE]);
    });

    it('a STAFF member limited to their own book gets a PRIVATE contact explicitly shared with them', async () => {
      const res = await callerFor(STAFF_OWNED).contactDetail({ businessId: BIZ, contactId: C_PRIVATE_SHARED });
      expect(res.contact).toMatchObject({ id: C_PRIVATE_SHARED });
      expect(res.notes.map((r: Row) => r.contactId)).toEqual([C_PRIVATE_SHARED]);
    });

    it("a STAFF member who views all gets another member's TEAM contact", async () => {
      const res = await callerFor(STAFF_READ).contactDetail({ businessId: BIZ, contactId: C_TEAM_OTHER });
      expect(res.contact).toMatchObject({ id: C_TEAM_OTHER, visibility: 'TEAM' });
      expect(res.tasks.map((r: Row) => r.contactId)).toEqual([C_TEAM_OTHER]);
    });
  });

  describe('tenant boundary (unchanged)', () => {
    it('a member of another business is refused before the contact is read', async () => {
      await expect(
        callerFor(OUTSIDER).contactDetail({ businessId: BIZ, contactId: C_TEAM_OTHER }),
      ).rejects.toThrow('Forbidden');
      expect(db.contact.findFirst).not.toHaveBeenCalled();
      expectNoChildRead();
    });
  });
});

describe('the fake ctx.db refuses what Prisma would let fail open (V1-26 review ST-3)', () => {
  const row: Row = { id: 'r1', businessId: BIZ, ownerId: STAFF_OTHER, visibility: 'PRIVATE' };
  const shares = { shares: () => [{ id: 's9', contactId: 'r1', userId: STAFF_OTHER }] as Row[] };

  it('throws on an undefined value instead of reading it as "must equal undefined"', () => {
    // Prisma drops { ownerId: undefined }: the query then has no owner predicate.
    expect(() => matches(row, { businessId: BIZ, ownerId: undefined }, {})).toThrow(/undefined filter value at where\.ownerId/);
    expect(() => matches(row, { ownerId: { in: undefined } }, {})).toThrow(/undefined filter value at where\.ownerId\.in/);
  });

  it('throws on an undefined value inside AND, OR or a relation filter (a visibility clause built from an undefined actor id)', () => {
    // In Prisma this collapses to "any contact with any share".
    const clause = { AND: [{ OR: [{ ownerId: undefined }, { shares: { some: { userId: undefined } } }] }] };
    expect(() => matches(row, clause, shares)).toThrow(/undefined filter value/);
    expect(() => matches(row, { shares: { some: undefined } }, shares)).toThrow(/undefined filter value at where\.shares/);
    expect(() => matches(row, { OR: [undefined as unknown as Where] }, {})).toThrow(/undefined filter value at where\.OR\[0\]/);
  });

  it('still evaluates a well-formed clause', () => {
    expect(matches(row, { AND: [{ OR: [{ ownerId: STAFF_OTHER }, { shares: { some: { userId: OWNER } } }] }] }, shares)).toBe(true);
    expect(matches(row, { OR: [{ ownerId: OWNER }, { shares: { some: { userId: OWNER } } }] }, shares)).toBe(false);
    expect(matches(row, undefined, {})).toBe(true);
  });
});
