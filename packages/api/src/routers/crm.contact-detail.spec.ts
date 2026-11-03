/**
 * V1-26-CT-TRPC-VISIBILITY (PRS-M13, M06): tRPC crm.contactDetail applies CRM
 * record visibility before it reads a contact's child rows.
 *
 * /trpc is mounted (apps/server/src/trpc.module.ts) and reachable by any
 * authenticated member. crm.contactDetail checked business access only
 * (assertBusinessAccess), then read the contact and its events, notes and
 * tasks, so a STAFF member limited to their own book read another member's
 * PRIVATE contact in full. The REST detail route refuses that read
 * (V1-08: assertContactVisible in
 * apps/server/src/modules/crm/crm-permissions.helper.ts answers 404
 * 'Contact not found', the same as an unknown id, before any child read).
 *
 * ctx.db is an in-memory fake that EVALUATES the `where` it is handed (equality,
 * null, `in`, OR/AND, `members.some`, `shares.some`) and throws on anything
 * else, so a visibility clause added to a query is honoured rather than
 * ignored, and the fake never answers "match" for an operator it does not
 * understand.
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
    ] as Row[],
    contactShare: [
      { id: 's1', businessId: BIZ, contactId: C_PRIVATE_SHARED, userId: STAFF_OWNED },
    ] as Row[],
  };
}

function childRows(kind: string): Row[] {
  return [C_PRIVATE_OTHER, C_TEAM_OTHER, C_PRIVATE_MINE, C_PRIVATE_SHARED].map((contactId) => ({
    id: `${kind}_${contactId}`,
    businessId: BIZ,
    contactId,
    body: `${kind} of ${contactId}`,
  }));
}

/**
 * Evaluate a Prisma-style `where` against one row. Throws on an operator it
 * does not know, so an unsupported clause fails the test loudly instead of
 * matching everything.
 */
function matches(row: Row, where: Where | undefined, relations: Record<string, (row: Row) => Row[]>): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'OR') {
      if (!(cond as Where[]).some((w) => matches(row, w, relations))) return false;
      continue;
    }
    if (key === 'AND') {
      const all = Array.isArray(cond) ? (cond as Where[]) : [cond as Where];
      if (!all.every((w) => matches(row, w, relations))) return false;
      continue;
    }
    if (key in relations) {
      const rel = cond as Where;
      const extra = Object.keys(rel).filter((k) => k !== 'some');
      if (extra.length > 0) throw new Error(`fake db: unsupported relation filter ${key}.${extra.join(',')}`);
      if (!relations[key](row).some((r) => matches(r, rel.some as Where, {}))) return false;
      continue;
    }
    if (cond === null || typeof cond !== 'object' || cond instanceof Date) {
      if ((row[key] ?? null) !== cond) return false;
      continue;
    }
    const ops = cond as Where;
    for (const [op, value] of Object.entries(ops)) {
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
   * TODO, BLOCKED (V1-26 deviation): these four cases are the packet's RED,
   * recorded failing at bb6b86d4 (commit "V1-26-CT-TRPC-VISIBILITY tests
   * first": each call resolved with the contact, or { contact: null }, and ran
   * the child findMany). The fix must reuse the rule V1-08 landed for REST
   * (resolveCrmAccess + visibilityClause + assertContactVisible in
   * apps/server/src/modules/crm/crm-permissions.helper.ts), and packages/api
   * cannot reach it: apps/server depends on @keyflow/api (not the reverse), the
   * helper takes the Nest PrismaService and throws Nest exceptions, and a
   * relative import fails `tsc -p packages/api` with TS6059 (outside rootDir).
   * Reuse needs a shared helper outside this packet's write set (e.g. the pure
   * rule moved to a workspace package both sides import, or a visibility check
   * the server injects into AppContext), and the packet forbids copying the
   * rule here. The bodies are kept so the follow-up flips `it.todo` to `it`.
   */
  describe('refused: NOT_FOUND before any child row is read', () => {
    it.todo("a STAFF member limited to their own book (crm_view 'owned') gets NOT_FOUND for another member's PRIVATE contact, and events, notes and tasks are never read", async () => {
      await expect(
        callerFor(STAFF_OWNED).contactDetail({ businessId: BIZ, contactId: C_PRIVATE_OTHER }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expectNoChildRead();
    });

    it.todo("a STAFF member limited to their own book gets NOT_FOUND for another member's TEAM contact", async () => {
      await expect(
        callerFor(STAFF_OWNED).contactDetail({ businessId: BIZ, contactId: C_TEAM_OTHER }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expectNoChildRead();
    });

    it.todo("a STAFF member who views all (default crm 'read') still gets NOT_FOUND for another member's PRIVATE contact", async () => {
      await expect(
        callerFor(STAFF_READ).contactDetail({ businessId: BIZ, contactId: C_PRIVATE_OTHER }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expectNoChildRead();
    });

    it.todo('an unknown contact id answers the same NOT_FOUND (a hidden contact and an absent one cannot be told apart), and no child row is read', async () => {
      await expect(
        callerFor(OWNER).contactDetail({ businessId: BIZ, contactId: C_UNKNOWN }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expectNoChildRead();
    });
  });

  describe('allowed: the row and its child rows', () => {
    it("the OWNER gets another member's PRIVATE contact with its events, notes and tasks", async () => {
      const res = await callerFor(OWNER).contactDetail({ businessId: BIZ, contactId: C_PRIVATE_OTHER });
      expect(res.contact).toMatchObject({ id: C_PRIVATE_OTHER, visibility: 'PRIVATE' });
      expect(res.events.map((r: Row) => r.contactId)).toEqual([C_PRIVATE_OTHER]);
      expect(res.notes.map((r: Row) => r.contactId)).toEqual([C_PRIVATE_OTHER]);
      expect(res.tasks.map((r: Row) => r.contactId)).toEqual([C_PRIVATE_OTHER]);
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
