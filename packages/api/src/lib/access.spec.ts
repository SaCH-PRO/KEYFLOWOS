/**
 * W11-TRPC-MEMBERSHIP: the tRPC access predicates follow owner rulings D-104,
 * D-116 and D-125. Membership is the only rule, and the role comes from the
 * membership.
 *
 *   D-104  Membership is the single rule for business access: an owner
 *          recorded only as Business.ownerId, with no Membership row, is
 *          refused everywhere.
 *   D-116  A recorded owner who holds only an ADMIN or STAFF membership is
 *          treated as that role.
 *   D-125  The owner rule is "holds an OWNER membership of this business". A
 *          co-owner (OWNER membership, not the recorded owner) is the owner;
 *          the recorded-owner field grants nothing on its own.
 *
 * No procedure is reachable today (D-68: /trpc is served only with
 * TRPC_ENABLED=1, apps/server/src/trpc.module.ts), so the defect is latent.
 * Before this packet assertBusinessAccess and assertBusinessRole admitted
 * `OR: [{ ownerId }, { members: { some: { userId } } }]`, assertBusinessRole
 * answered 'OWNER' for any recorded owner, and identity.listBusinesses kept an
 * `ownerId` "compatibility arm" the REST IdentityService.listBusinesses had
 * already dropped under D-104.
 *
 * ctx.db is an in-memory fake that EVALUATES the `where` it is handed (the
 * evaluator of routers/crm.contact-detail.spec.ts: equality, null, `in`,
 * OR/AND, `members.some`) and throws on anything else, so an `ownerId` arm is
 * honoured rather than ignored and an unknown operator never answers "match".
 * It throws on an `undefined` filter value too: Prisma DROPS such a predicate
 * (fails open). It honours `select`, so a column the code stops selecting is
 * really absent from what the code reads back.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { assertBusinessAccess, assertBusinessRole } from './access';
import { identityRouter } from '../routers/identity';
import type { AppContext } from '../trpc';

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

// Fixture prefix v98a_ (V1-97, W11-TRPC-MEMBERSHIP).
const BIZ_MAIN = 'v98a_biz_main'; // recorded owner RECORDED holds STAFF here (D-116)
const BIZ_ORPHAN = 'v98a_biz_orphan'; // recorded owner RECORDED holds NO membership here (D-104)
const BIZ_FOREIGN = 'v98a_biz_foreign'; // FOREIGN_OWNER's business; RECORDED is an ADMIN member
const BIZ_DELETED = 'v98a_biz_deleted'; // soft-deleted; RECORDED still holds OWNER
const BIZ_OUTSIDE = 'v98a_biz_outside'; // OUTSIDER's business only

const RECORDED = 'v98a_user_recorded'; // Business.ownerId of BIZ_MAIN, BIZ_ORPHAN, BIZ_DELETED
const COOWNER = 'v98a_user_coowner'; // OWNER membership of BIZ_MAIN, not its Business.ownerId (D-125)
const ADMIN = 'v98a_user_admin';
const STAFF = 'v98a_user_staff';
const FOREIGN_OWNER = 'v98a_user_foreign_owner'; // recorded owner holding OWNER of BIZ_FOREIGN
const OUTSIDER = 'v98a_user_outsider'; // member of BIZ_OUTSIDE only

const ALL_ROLES = ['OWNER', 'ADMIN', 'STAFF'];

function tables() {
  return {
    business: [
      // A decrypted token column stands in for the 14 the token-encryption
      // extension decrypts on read: the workspace picker must never ship it.
      { id: BIZ_MAIN, ownerId: RECORDED, name: 'V98A main', slug: 'v98a_main', deletedAt: null, createdAt: new Date('2026-03-01T00:00:00Z'), googleAccessToken: 'v98a-not-a-real-token' },
      { id: BIZ_ORPHAN, ownerId: RECORDED, name: 'V98A orphan', slug: 'v98a_orphan', deletedAt: null, createdAt: new Date('2026-04-01T00:00:00Z'), googleAccessToken: 'v98a-not-a-real-token' },
      { id: BIZ_FOREIGN, ownerId: FOREIGN_OWNER, name: 'V98A foreign', slug: 'v98a_foreign', deletedAt: null, createdAt: new Date('2026-02-01T00:00:00Z'), googleAccessToken: 'v98a-not-a-real-token' },
      { id: BIZ_DELETED, ownerId: RECORDED, name: 'V98A deleted', slug: 'v98a_deleted', deletedAt: new Date('2026-06-01T00:00:00Z'), createdAt: new Date('2026-05-01T00:00:00Z'), googleAccessToken: 'v98a-not-a-real-token' },
      { id: BIZ_OUTSIDE, ownerId: OUTSIDER, name: 'V98A outside', slug: 'v98a_outside', deletedAt: null, createdAt: new Date('2026-01-01T00:00:00Z'), googleAccessToken: 'v98a-not-a-real-token' },
    ] as Row[],
    membership: [
      { id: 'v98a_m_recorded_main', userId: RECORDED, businessId: BIZ_MAIN, role: 'STAFF' },
      { id: 'v98a_m_coowner_main', userId: COOWNER, businessId: BIZ_MAIN, role: 'OWNER' },
      { id: 'v98a_m_admin_main', userId: ADMIN, businessId: BIZ_MAIN, role: 'ADMIN' },
      { id: 'v98a_m_staff_main', userId: STAFF, businessId: BIZ_MAIN, role: 'STAFF' },
      // BIZ_ORPHAN has members, just not its recorded owner, so a predicate
      // that only asks "does this business have members" cannot pass.
      { id: 'v98a_m_staff_orphan', userId: STAFF, businessId: BIZ_ORPHAN, role: 'STAFF' },
      { id: 'v98a_m_foreign_owner', userId: FOREIGN_OWNER, businessId: BIZ_FOREIGN, role: 'OWNER' },
      { id: 'v98a_m_recorded_foreign', userId: RECORDED, businessId: BIZ_FOREIGN, role: 'ADMIN' },
      { id: 'v98a_m_recorded_deleted', userId: RECORDED, businessId: BIZ_DELETED, role: 'OWNER' },
      { id: 'v98a_m_outsider', userId: OUTSIDER, businessId: BIZ_OUTSIDE, role: 'OWNER' },
    ] as Row[],
  };
}

/**
 * Evaluate a Prisma-style `where` against one row: the evaluator of
 * routers/crm.contact-detail.spec.ts. Throws on an operator it does not know,
 * and on an `undefined` value anywhere inside a `where` (Prisma drops that
 * predicate, so it would match EVERY row there).
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

function onlyKeys(args: Row, allowed: string[], method: string) {
  const extra = Object.keys(args).filter((k) => !allowed.includes(k));
  if (extra.length > 0) throw new Error(`fake db: business.${method} does not support ${extra.join(',')}`);
}

function makeDb() {
  const t = tables();
  const membersOf = (b: Row) => t.membership.filter((m) => m.businessId === b.id);
  const relations = { members: membersOf };

  /** Project a row through a Prisma `select`; `members` is the one relation. */
  const project = (row: Row, select: Where | undefined): Row => {
    if (!select) return { ...row };
    const out: Row = {};
    for (const [key, spec] of Object.entries(select)) {
      if (key === 'members') {
        const rel = (spec === true ? {} : spec) as { where?: Where; select?: Where; take?: number };
        onlyKeys(rel as Row, ['where', 'select', 'take'], 'select.members');
        let rows = membersOf(row).filter((m) => matches(m, rel.where, {}));
        if (rel.take !== undefined) rows = rows.slice(0, rel.take);
        out.members = rows.map((m) => project(m, rel.select));
        continue;
      }
      if (spec !== true) throw new Error(`fake db: unsupported select ${key}`);
      out[key] = row[key];
    }
    return out;
  };

  const findAll = (where?: Where) => t.business.filter((row) => matches(row, where, relations));

  return {
    tables: t,
    business: {
      findFirst: vi.fn(async (args: { where?: Where; select?: Where } = {}) => {
        onlyKeys(args, ['where', 'select'], 'findFirst');
        const row = findAll(args.where)[0];
        return row ? project(row, args.select) : null;
      }),
      findMany: vi.fn(async (args: { where?: Where; select?: Where; orderBy?: Where } = {}) => {
        onlyKeys(args, ['where', 'select', 'orderBy'], 'findMany');
        const rows = findAll(args.where);
        if (args.orderBy) {
          const entries = Object.entries(args.orderBy);
          if (entries.length !== 1 || entries[0][0] !== 'createdAt') throw new Error('fake db: unsupported orderBy');
          const dir = entries[0][1] === 'desc' ? -1 : 1;
          rows.sort((a, b) => dir * ((a.createdAt as Date).getTime() - (b.createdAt as Date).getTime()));
        }
        return rows.map((row) => project(row, args.select));
      }),
      create: vi.fn(async (args: { data: Row; select?: Where }) => {
        onlyKeys(args, ['data', 'select'], 'create');
        const { members, ...data } = args.data as Row & { members?: { create: Row } };
        const row: Row = { id: 'v98a_biz_created', deletedAt: null, createdAt: new Date('2026-11-12T00:00:00Z'), ...data };
        t.business.push(row);
        if (members) t.membership.push({ id: 'v98a_m_created', businessId: row.id, ...members.create });
        return project(row, args.select);
      }),
    },
  };
}

type FakeDb = ReturnType<typeof makeDb>;
let db: FakeDb;

function ctxFor(userId: string | undefined, business?: { id: string; role: string }): AppContext {
  return {
    db: db as unknown as AppContext['db'],
    eventBus: { emit: vi.fn() },
    user: userId ? { id: userId, email: `${userId}@v98a.test` } : undefined,
    business,
  };
}

// identityRouter is exported as AnyRouter, so its caller's procedures are
// untyped; this names the two procedures under test.
type IdentityCaller = {
  listBusinesses: () => Promise<Row[]>;
  createBusiness: (input: { name: string }) => Promise<Row>;
};

function identityFor(userId: string): IdentityCaller {
  return identityRouter.createCaller(ctxFor(userId)) as unknown as IdentityCaller;
}

beforeEach(() => {
  db = makeDb();
});

describe('tRPC access predicates follow membership only (W11-TRPC-MEMBERSHIP, D-104, D-116, D-125)', () => {
  describe('assertBusinessAccess: any membership of the business, nothing else', () => {
    it('[D-104] a recorded owner (Business.ownerId) with no Membership of that business is Forbidden', async () => {
      await expect(assertBusinessAccess(ctxFor(RECORDED), BIZ_ORPHAN)).rejects.toThrow('Forbidden');
    });

    it('[D-104] a STAFF member is admitted and gets the business back', async () => {
      await expect(assertBusinessAccess(ctxFor(STAFF), BIZ_MAIN)).resolves.toMatchObject({ id: BIZ_MAIN });
    });

    it('[D-125] a co-owner (OWNER membership, not Business.ownerId) is admitted', async () => {
      await expect(assertBusinessAccess(ctxFor(COOWNER), BIZ_MAIN)).resolves.toMatchObject({ id: BIZ_MAIN });
    });

    it('[D-116] a recorded owner holding a STAFF membership is admitted as a member', async () => {
      await expect(assertBusinessAccess(ctxFor(RECORDED), BIZ_MAIN)).resolves.toMatchObject({ id: BIZ_MAIN });
    });

    it('a member of another business only is Forbidden', async () => {
      await expect(assertBusinessAccess(ctxFor(OUTSIDER), BIZ_MAIN)).rejects.toThrow('Forbidden');
    });

    it('an unauthenticated caller is Unauthorized before any read', async () => {
      await expect(assertBusinessAccess(ctxFor(undefined), BIZ_MAIN)).rejects.toThrow('Unauthorized');
      expect(db.business.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('assertBusinessRole: the role is the membership role, and only the membership role', () => {
    it('[D-104] a recorded owner with no Membership of the business is Forbidden even when every role is allowed', async () => {
      await expect(
        assertBusinessRole(ctxFor(RECORDED, { id: BIZ_ORPHAN, role: 'OWNER' }), ALL_ROLES),
      ).rejects.toThrow('Forbidden');
    });

    it('[D-116] a recorded owner holding a STAFF membership resolves STAFF, not OWNER', async () => {
      await expect(
        assertBusinessRole(ctxFor(RECORDED, { id: BIZ_MAIN, role: 'OWNER' }), ALL_ROLES),
      ).resolves.toEqual({ businessId: BIZ_MAIN, userId: RECORDED, role: 'STAFF' });
    });

    it("[D-116] a recorded owner holding a STAFF membership is Forbidden where only ['OWNER', 'ADMIN'] are allowed", async () => {
      await expect(
        assertBusinessRole(ctxFor(RECORDED, { id: BIZ_MAIN, role: 'OWNER' }), ['OWNER', 'ADMIN']),
      ).rejects.toThrow('Forbidden');
    });

    it('[D-125] a co-owner (OWNER membership, not Business.ownerId) resolves OWNER', async () => {
      await expect(
        assertBusinessRole(ctxFor(COOWNER, { id: BIZ_MAIN, role: 'OWNER' }), ['OWNER']),
      ).resolves.toEqual({ businessId: BIZ_MAIN, userId: COOWNER, role: 'OWNER' });
    });

    it('[D-125] a recorded owner holding an OWNER membership resolves OWNER', async () => {
      await expect(
        assertBusinessRole(ctxFor(FOREIGN_OWNER, { id: BIZ_FOREIGN, role: 'OWNER' }), ['OWNER']),
      ).resolves.toEqual({ businessId: BIZ_FOREIGN, userId: FOREIGN_OWNER, role: 'OWNER' });
    });

    it("an ADMIN member resolves ADMIN and is Forbidden where only ['OWNER'] is allowed", async () => {
      await expect(
        assertBusinessRole(ctxFor(ADMIN, { id: BIZ_MAIN, role: 'ADMIN' }), ['OWNER', 'ADMIN']),
      ).resolves.toEqual({ businessId: BIZ_MAIN, userId: ADMIN, role: 'ADMIN' });
      await expect(
        assertBusinessRole(ctxFor(ADMIN, { id: BIZ_MAIN, role: 'ADMIN' }), ['OWNER']),
      ).rejects.toThrow('Forbidden');
    });

    it('the role is read from the database membership, never from ctx.business.role', async () => {
      await expect(
        assertBusinessRole(ctxFor(STAFF, { id: BIZ_MAIN, role: 'OWNER' }), ['OWNER', 'ADMIN']),
      ).rejects.toThrow('Forbidden');
      await expect(
        assertBusinessRole(ctxFor(STAFF, { id: BIZ_MAIN, role: 'OWNER' }), ALL_ROLES),
      ).resolves.toMatchObject({ role: 'STAFF' });
    });

    it('[D-104] the role query neither filters on nor selects Business.ownerId', async () => {
      await assertBusinessRole(ctxFor(COOWNER, { id: BIZ_MAIN, role: 'OWNER' }), ['OWNER']);
      const [args] = db.business.findFirst.mock.calls[0] as [{ where: Where; select: Where }];
      expect(JSON.stringify(args.where)).not.toContain('ownerId');
      expect(args.select).not.toHaveProperty('ownerId');
    });

    it('a member of another business only is Forbidden', async () => {
      await expect(
        assertBusinessRole(ctxFor(OUTSIDER, { id: BIZ_MAIN, role: 'OWNER' }), ALL_ROLES),
      ).rejects.toThrow('Forbidden');
    });

    it('no ctx.business is Forbidden and no user is Unauthorized, both before any read', async () => {
      await expect(assertBusinessRole(ctxFor(COOWNER), ALL_ROLES)).rejects.toThrow('Forbidden');
      await expect(assertBusinessRole(ctxFor(undefined, { id: BIZ_MAIN, role: 'OWNER' }), ALL_ROLES)).rejects.toThrow(
        'Unauthorized',
      );
      expect(db.business.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('identity.listBusinesses: membership businesses only (D-104, as the REST IdentityService.listBusinesses)', () => {
    it('[D-104] excludes an ownerId-only business and a soft-deleted one, and includes every live membership business newest first', async () => {
      const rows = await identityFor(RECORDED).listBusinesses();
      // BIZ_ORPHAN (recorded owner, no membership) and BIZ_DELETED (soft-deleted,
      // OWNER membership) are out; BIZ_MAIN (STAFF) and BIZ_FOREIGN (ADMIN, not
      // the recorded owner) are in.
      expect(rows.map((r) => r.id)).toEqual([BIZ_MAIN, BIZ_FOREIGN]);
    });

    it('[D-125] a co-owner lists the business they hold an OWNER membership of', async () => {
      const rows = await identityFor(COOWNER).listBusinesses();
      expect(rows.map((r) => r.id)).toEqual([BIZ_MAIN]);
    });

    it('rows carry the summary select only, never a decrypted token column', async () => {
      const rows = await identityFor(RECORDED).listBusinesses();
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row).not.toHaveProperty('googleAccessToken');
    });
  });

  describe('identity.createBusiness (unchanged)', () => {
    it('still founds the business with one OWNER membership for the caller', async () => {
      const created = await identityFor(STAFF).createBusiness({ name: 'V98A created' });
      expect(created).toMatchObject({ id: 'v98a_biz_created', name: 'V98A created', ownerId: STAFF });
      expect(db.business.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { name: 'V98A created', ownerId: STAFF, members: { create: { userId: STAFF, role: 'OWNER' } } },
        }),
      );
      // The founding OWNER membership is what admits the founder from here on.
      await expect(
        assertBusinessRole(ctxFor(STAFF, { id: 'v98a_biz_created', role: 'STAFF' }), ['OWNER']),
      ).resolves.toMatchObject({ role: 'OWNER' });
    });
  });
});
