/**
 * R0-F24-TENANT-INTERCEPTOR-ALIGN (build map CF-24) — one tenant answer per request.
 *
 * TenantInterceptor installs the ambient tenant (AsyncLocalStorage) that the
 * Prisma tenant extension in packages/db writes over every scoped query's
 * `where.businessId`. It picked that tenant as
 *
 *   req.params?.businessId || req.body?.businessId || req.query?.businessId
 *
 * — the first TRUTHY field, with no type check — while BusinessGuard validates
 * the first non-empty STRING (core/auth/request-business-id.ts). On a request
 * that carries a non-string businessId ahead of the string the guard checked,
 * the two disagree: the guard admits the caller for tenant A and the handler's
 * queries run under an array, an object (which Prisma reads as a filter:
 * `{not: 'x'}` is every tenant, `{equals: 'B'}` is B) or a number.
 *
 * These cases pin the contract with no database: the tenant a handler runs
 * under is exactly the string BusinessGuard validated (the value it attaches
 * to the request, else the same string-only resolver it ran); a non-string
 * candidate is skipped, never coerced; and every well-formed request from a
 * caller who belongs to the named tenant resolves exactly as the legacy
 * expression did. On a route no guard admitted (review finding F1) the named
 * tenant becomes ambient only for a caller who passes BusinessGuard's own
 * membership predicate for it, or is SUPER_ADMIN.
 */
import { describe, it, expect } from 'vitest';
import { Observable, lastValueFrom } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { TenantInterceptor } from './tenant.interceptor';
import { getTenantContext } from './tenant-context';
import { BusinessGuard } from '../auth/business.guard';
import { resolveRequestBusinessId } from '../auth/request-business-id';
import type { PrismaService } from '../prisma/prisma.service';

type Req = {
  user?: { id?: string; role?: string };
  params?: Record<string, unknown>;
  body?: unknown;
  query?: Record<string, unknown>;
  guardedBusinessId?: unknown;
};

const A = 'biz_A';
const B = 'biz_B';
const USER = 'user_1';

function ctxFor(req: Req): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

/** Every business id the tests in this file name; the default caller belongs to all of them. */
const EVERY_NAMED = [A, B, 'p_biz', 'b_biz', 'q_biz'];

/**
 * A fake PrismaService whose `business.findFirst` answers BusinessGuard's
 * membership predicate (`{ id, OR: [{ ownerId }, { members: { some: { userId } } }] }`)
 * for USER as a member of `memberOf`, recording every id it was asked about.
 */
function membershipPrisma(memberOf: string[], opts: { fail?: boolean } = {}) {
  const lookups: unknown[] = [];
  const prisma = {
    client: {
      business: {
        findFirst: async ({ where }: { where: { id: unknown; OR?: Array<Record<string, unknown>> } }) => {
          lookups.push(where.id);
          if (opts.fail) throw new Error('connection terminated');
          const asks = JSON.stringify(where.OR ?? []);
          const forUser = asks.includes(JSON.stringify(USER));
          return forUser && typeof where.id === 'string' && memberOf.includes(where.id) ? { id: where.id } : null;
        },
      },
    },
  };
  return { prisma: prisma as unknown as PrismaService, lookups };
}

/**
 * Run the interceptor around a handler that reports the ambient tenant it ran
 * under. The caller (USER) is a member of `memberOf` (default: every business
 * these tests name, so only the request shape decides the tenant).
 */
async function runUnderInterceptor(
  req: Req,
  memberOf: string[] = EVERY_NAMED,
): Promise<{ tenant: unknown; userId: unknown }> {
  return (await interceptWithLookups(req, memberOf)).seen;
}

async function interceptWithLookups(req: Req, memberOf: string[], opts: { fail?: boolean } = {}) {
  let seen: { tenant: unknown; userId: unknown } | undefined;
  const next: CallHandler = {
    handle: () =>
      new Observable((subscriber) => {
        const ctx = getTenantContext();
        seen = { tenant: ctx?.businessId, userId: ctx?.userId };
        subscriber.next('handled');
        subscriber.complete();
      }),
  };
  const { prisma, lookups } = membershipPrisma(memberOf, opts);
  const out = await lastValueFrom(new TenantInterceptor(prisma).intercept(ctxFor(req), next));
  expect(out).toBe('handled');
  if (!seen) throw new Error('handler did not run');
  return { seen, lookups };
}

/** The interceptor's pre-fix expression, kept here as the oracle for well-formed requests. */
function legacyPick(req: Req): unknown {
  const body = req.body as Record<string, unknown> | null | undefined;
  return (req.params?.businessId || body?.businessId || req.query?.businessId) || undefined;
}

/** A BusinessGuard over a fake Prisma that admits USER to A (and to B when asked), recording each id it checked. */
function guardFor(memberOf: string[]) {
  const checked: unknown[] = [];
  const prisma = {
    client: {
      business: {
        findFirst: async ({ where }: { where: { id: unknown } }) => {
          checked.push(where.id);
          return typeof where.id === 'string' && memberOf.includes(where.id) ? { id: where.id } : null;
        },
      },
    },
  };
  return { guard: new BusinessGuard(prisma as unknown as PrismaService), checked };
}

/**
 * The production order (guards, then interceptors, then the handler): the
 * handler runs only if the guard admits the request, and reports the tenant
 * it ran under next to the id the guard checked.
 */
async function guardedPipeline(req: Req, memberOf: string[] = [A]) {
  const { guard, checked } = guardFor(memberOf);
  let admitted = false;
  try {
    admitted = await guard.canActivate(ctxFor(req));
  } catch (err) {
    return { admitted: false, error: (err as Error).name, checked, handler: undefined };
  }
  const handler = admitted ? await runUnderInterceptor(req, memberOf) : undefined;
  return { admitted, error: undefined, checked, handler };
}

// ── Well-formed requests: every field a string or absent ─────────────────────

const PARAMS: Array<Record<string, unknown> | undefined> = [undefined, {}, { businessId: 'p_biz' }];
const BODIES: unknown[] = [
  undefined,
  null,
  {},
  { name: 'no tenant here' },
  { businessId: 'b_biz' },
  { businessId: '' },
  'a text/plain body',
  { businessId: 0 },
  { businessId: false },
  { businessId: null },
];
const QUERIES: Array<Record<string, unknown> | undefined> = [undefined, {}, { businessId: 'q_biz' }, { businessId: '' }];

const WELL_FORMED: Req[] = [];
for (const params of PARAMS) for (const body of BODIES) for (const query of QUERIES) {
  WELL_FORMED.push({ user: { id: USER }, params, body, query });
}

describe('TenantInterceptor: well-formed requests from a caller who belongs to the named tenant resolve exactly as before (control)', () => {
  it(`installs the legacy expression's tenant on all ${WELL_FORMED.length} well-formed shapes`, async () => {
    const mismatches: unknown[] = [];
    for (const req of WELL_FORMED) {
      const seen = await runUnderInterceptor(req);
      const expected = legacyPick(req);
      const want = { tenant: expected, userId: expected === undefined ? undefined : USER };
      if (JSON.stringify(seen) !== JSON.stringify(want) || seen.tenant !== want.tenant) {
        mismatches.push({ req, seen, want });
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('precedence is params, then body, then query', async () => {
    expect((await runUnderInterceptor({ user: { id: USER }, params: { businessId: A }, body: { businessId: B }, query: { businessId: B } })).tenant).toBe(A);
    expect((await runUnderInterceptor({ user: { id: USER }, body: { businessId: A }, query: { businessId: B } })).tenant).toBe(A);
    expect((await runUnderInterceptor({ user: { id: USER }, query: { businessId: A } })).tenant).toBe(A);
  });

  it('installs no tenant without an authenticated user', async () => {
    expect(await runUnderInterceptor({ params: { businessId: A } })).toEqual({ tenant: undefined, userId: undefined });
    expect(await runUnderInterceptor({ user: {}, query: { businessId: A } })).toEqual({ tenant: undefined, userId: undefined });
  });

  it('installs the user id with the tenant', async () => {
    expect(await runUnderInterceptor({ user: { id: USER }, query: { businessId: A } })).toEqual({ tenant: A, userId: USER });
  });
});

// ── Shapes where the guard and the interceptor diverged ───────────────────────

/** Truthy non-string body values that sat ahead of the string `?businessId=A` the guard validates. */
const NON_STRING_BODY_TENANTS: Array<[string, unknown]> = [
  ['array naming B', [B]],
  ['array naming A', [A]],
  ['filter object {not}', { not: 'x' }],
  ['filter object {equals: B}', { equals: B }],
  ['number', 42],
  ['boolean true', true],
  ['empty object', {}],
  ['empty array', []],
];

describe('TenantInterceptor: a non-string candidate is skipped, never installed or coerced', () => {
  for (const [label, value] of NON_STRING_BODY_TENANTS) {
    it(`body.businessId = ${label} with ?businessId=A runs the handler under A`, async () => {
      const req: Req = { user: { id: USER }, body: { businessId: value }, query: { businessId: A } };
      expect(resolveRequestBusinessId(req)).toBe(A); // what BusinessGuard checks
      expect(await runUnderInterceptor(req)).toEqual({ tenant: A, userId: USER });
    });
  }

  it('a request naming the tenant only by non-strings installs no tenant at all', async () => {
    const shapes: Req[] = [
      { user: { id: USER }, body: { businessId: { not: 'x' } } },
      { user: { id: USER }, body: { businessId: [A] } },
      { user: { id: USER }, body: { businessId: 7 } },
      { user: { id: USER }, query: { businessId: [A, B] } }, // ?businessId=A&businessId=B
      { user: { id: USER }, query: { businessId: { not: 'x' } } },
      { user: { id: USER }, params: { businessId: 5 }, body: { businessId: [B] }, query: { businessId: [B] } },
    ];
    const seen = [];
    for (const req of shapes) seen.push(await runUnderInterceptor(req));
    expect(seen).toEqual(shapes.map(() => ({ tenant: undefined, userId: undefined })));
  });

  it('a non-string query never displaces a string body', async () => {
    expect((await runUnderInterceptor({ user: { id: USER }, body: { businessId: A }, query: { businessId: [B] } })).tenant).toBe(A);
  });
});

describe('TenantInterceptor: the value BusinessGuard attached wins', () => {
  it('prefers req.guardedBusinessId over the request fields', async () => {
    // A request field changed after the guard ran (or a source the resolver
    // reads differently): the handler still runs under the tenant the guard checked.
    const req: Req = { user: { id: USER }, guardedBusinessId: A, body: { businessId: B }, query: { businessId: B } };
    expect(await runUnderInterceptor(req)).toEqual({ tenant: A, userId: USER });
  });

  it('installs the guard-attached tenant without a second membership lookup', async () => {
    const req: Req = { user: { id: USER }, guardedBusinessId: A, query: { businessId: A } };
    const { seen, lookups } = await interceptWithLookups(req, [A]);
    expect({ seen, lookups }).toEqual({ seen: { tenant: A, userId: USER }, lookups: [] });
  });

  it('ignores a non-string or empty guardedBusinessId and falls back to the shared resolver', async () => {
    for (const guarded of [{ not: 'x' }, [B], 9, '', null]) {
      const req: Req = { user: { id: USER }, guardedBusinessId: guarded, body: { businessId: { equals: B } }, query: { businessId: A } };
      expect({ guarded, tenant: (await runUnderInterceptor(req)).tenant }).toEqual({ guarded, tenant: A });
    }
  });
});

describe('BusinessGuard + TenantInterceptor: the handler runs under exactly the string the guard validated', () => {
  it('the guard attaches the tenant it validated to the request', async () => {
    const req: Req = { user: { id: USER }, body: { businessId: { not: 'x' } }, query: { businessId: A } };
    const { guard, checked } = guardFor([A]);
    await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);
    expect(checked).toEqual([A]);
    expect(req.guardedBusinessId).toBe(A);
  });

  it('the guard attaches nothing when it refuses', async () => {
    const foreign: Req = { user: { id: USER }, body: { businessId: [A] }, query: { businessId: B } };
    const { guard } = guardFor([A]);
    await expect(guard.canActivate(ctxFor(foreign))).rejects.toThrow();
    expect(foreign.guardedBusinessId).toBeUndefined();

    const unnamed: Req = { user: { id: USER }, body: { businessId: { not: 'x' } } };
    await expect(guard.canActivate(ctxFor(unnamed))).rejects.toThrow();
    expect(unnamed.guardedBusinessId).toBeUndefined();
  });

  it('for every divergent shape the guard checks A and the handler runs under A', async () => {
    const observed = [];
    for (const [label, value] of NON_STRING_BODY_TENANTS) {
      const r = await guardedPipeline({ user: { id: USER }, body: { businessId: value }, query: { businessId: A } });
      observed.push({ label, admitted: r.admitted, checked: r.checked, handlerTenant: r.handler?.tenant });
    }
    expect(observed).toEqual(
      NON_STRING_BODY_TENANTS.map(([label]) => ({ label, admitted: true, checked: [A], handlerTenant: A })),
    );
  });

  it('for every well-formed shape the guard checks a string and the handler runs under that same string', async () => {
    const mismatches = [];
    for (const req of WELL_FORMED) {
      const r = await guardedPipeline({ ...req }, ['p_biz', 'b_biz', 'q_biz']);
      if (!r.admitted) continue; // no tenant named: refused, nothing ran
      if (r.checked.length !== 1 || r.handler?.tenant !== r.checked[0]) mismatches.push({ req, r });
    }
    expect(mismatches).toEqual([]);
  });

  it('when the guard refuses, the handler never runs (foreign query string behind a non-string body)', async () => {
    const r = await guardedPipeline({ user: { id: USER }, body: { businessId: [A] }, query: { businessId: B } }, [A]);
    expect(r).toMatchObject({ admitted: false, error: 'ForbiddenException', checked: [B], handler: undefined });
  });

  it('when only non-strings name a tenant, the guard refuses before any lookup and nothing runs', async () => {
    const r = await guardedPipeline({ user: { id: USER }, body: { businessId: { equals: A } }, query: { businessId: [A] } }, [A]);
    expect(r).toMatchObject({ admitted: false, error: 'ForbiddenException', checked: [], handler: undefined });
  });

  it('SUPER_ADMIN (who bypasses the membership check) still runs under the string-only answer', async () => {
    const admin = (extra: Partial<Req>) => ({ user: { id: USER, role: 'SUPER_ADMIN' }, ...extra });
    const withObject = await guardedPipeline(admin({ body: { businessId: { not: 'x' } }, query: { businessId: A } }));
    expect({ admitted: withObject.admitted, checked: withObject.checked, tenant: withObject.handler?.tenant }).toEqual({
      admitted: true,
      checked: [],
      tenant: A,
    });
    const onlyNonString = await guardedPipeline(admin({ query: { businessId: [A, B] } }));
    expect({ admitted: onlyNonString.admitted, tenant: onlyNonString.handler?.tenant }).toEqual({ admitted: true, tenant: undefined });
  });
});

// ── Review finding F1: a route BusinessGuard did not admit ───────────────────
//
// TenantInterceptor is a global APP_INTERCEPTOR, so it also runs on the ~60
// AuthGuard-only routes (identity bootstrap, community, diagnostics...) and on
// public routes reached with a valid bearer token. No guard attaches a tenant
// there. Installing the request's businessId unverified made it a cross-tenant
// WRITE primitive: the Prisma extension forces businessId on create/upsert, so
// POST /identity/bootstrap?businessId=<B> by a user with no access to B wrote
// the bootstrap membership upsert (keyed to the caller's own business) into B
// as an OWNER row. On such a route the named tenant becomes ambient only when
// the caller passes BusinessGuard's own membership predicate for it (or is
// SUPER_ADMIN, whom BusinessGuard admits to every tenant); otherwise the
// handler runs exactly as if no tenant had been named.

describe('TenantInterceptor on a route no guard admitted: only a tenant the caller can access becomes ambient (F1)', () => {
  it('a caller with no access to B naming B (query, body or path) runs under no tenant', async () => {
    const shapes: Req[] = [
      { user: { id: USER, role: 'USER' }, query: { businessId: B } },
      { user: { id: USER, role: 'USER' }, body: { businessId: B } },
      { user: { id: USER, role: 'USER' }, params: { businessId: B } },
    ];
    const observed = [];
    for (const req of shapes) observed.push(await interceptWithLookups(req, [A]));
    expect(observed).toEqual(shapes.map(() => ({ seen: { tenant: undefined, userId: undefined }, lookups: [B] })));
  });

  it('a member of B naming B still runs under B (unchanged for legitimate callers)', async () => {
    const { seen, lookups } = await interceptWithLookups({ user: { id: USER, role: 'USER' }, query: { businessId: B } }, [A, B]);
    expect({ seen, lookups }).toEqual({ seen: { tenant: B, userId: USER }, lookups: [B] });
  });

  it('a foreign body tenant ahead of the caller’s own query tenant installs nothing (no fall-through to A)', async () => {
    const req: Req = { user: { id: USER, role: 'USER' }, body: { businessId: B }, query: { businessId: A } };
    const { seen, lookups } = await interceptWithLookups(req, [A]);
    expect({ seen, lookups }).toEqual({ seen: { tenant: undefined, userId: undefined }, lookups: [B] });
  });

  it('only SUPER_ADMIN bypasses the check; ADMIN, OWNER and USER roles do not', async () => {
    const admin = await interceptWithLookups({ user: { id: USER, role: 'SUPER_ADMIN' }, query: { businessId: B } }, []);
    expect(admin).toEqual({ seen: { tenant: B, userId: USER }, lookups: [] });
    for (const role of ['ADMIN', 'OWNER', 'USER', undefined]) {
      const r = await interceptWithLookups({ user: { id: USER, role }, query: { businessId: B } }, []);
      expect({ role, ...r }).toEqual({ role, seen: { tenant: undefined, userId: undefined }, lookups: [B] });
    }
  });

  it(`a caller who belongs to no named tenant runs under no tenant on all ${WELL_FORMED.length} well-formed shapes`, async () => {
    const installed = [];
    for (const req of WELL_FORMED) {
      const { seen } = await interceptWithLookups(req, []);
      if (seen.tenant !== undefined) installed.push({ req, seen });
    }
    expect(installed).toEqual([]);
  });

  it('a request that names no tenant performs no lookup', async () => {
    const r = await interceptWithLookups({ user: { id: USER, role: 'USER' }, body: { name: 'x' }, query: {} }, []);
    expect(r).toEqual({ seen: { tenant: undefined, userId: undefined }, lookups: [] });
  });

  it('when the membership lookup fails the request is refused and the handler never runs (fail closed)', async () => {
    let ran = false;
    const next: CallHandler = {
      handle: () =>
        new Observable((subscriber) => {
          ran = true;
          subscriber.next('handled');
          subscriber.complete();
        }),
    };
    const { prisma } = membershipPrisma([B], { fail: true });
    const req: Req = { user: { id: USER, role: 'USER' }, query: { businessId: B } };
    await expect(lastValueFrom(new TenantInterceptor(prisma).intercept(ctxFor(req), next))).rejects.toMatchObject({
      name: 'ForbiddenException',
    });
    expect(ran).toBe(false);
  });
});
