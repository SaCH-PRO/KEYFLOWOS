/**
 * R0-33-PORTAL-GRANT-TENANT — a portal access grant binds only a contact of
 * the tenant in the path (REAL database).
 *
 *   POST /portal/businesses/:businessId/access  { contactId, settings? }
 *     AuthGuard + BusinessGuard + RateLimitGuard (real Redis at REDIS_URL)
 *
 * Defect (CF-46, M38 grant half): PortalService.createAccess read and created
 * the PortalAccess row by { businessId, contactId } and never checked that the
 * contact belongs to businessId. PortalAccess.contactId is a bare column with
 * no relation, so A's owner could mint a portal link in A that points at B's
 * contact, and PortalModule is mounted unconditionally. The KEY flow tool
 * (portal_grant_access) and the storelink organ call the same method.
 *
 * After the fix, a contact id that is not a live contact of the path tenant
 * answers 404, byte-identical to an id that does not exist anywhere, and
 * writes nothing; A's own contact answers 201; re-granting an existing grant
 * of an A contact behaves as before (same row, fresh token, enabled, settings
 * kept when none are given). B's tenant state is byte-identical afterwards.
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * RateLimitGuard (real Redis), PortalService and the production
 * GlobalHttpExceptionFilter + ValidationPipe are real against DATABASE_URL.
 * Identity attachment is the one stand-in: a test middleware reads
 * `x-k33a-user`, loads that seeded user row and attaches `{ id, email, role }`
 * exactly as the Supabase-verifying AuthMiddleware would.
 *
 * Fixtures: prefix `k33a_` (values in globally unique columns embed it);
 * hard-deleted by raw SQL in dependency order in beforeAll and afterAll; no
 * $transaction wrapping.
 *
 * Cases tagged NEGATIVE CONTROL fail on the unmodified code: a foreign or
 * unknown contact id answers 201 and writes a row.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'k33a_';
const HEADER = 'x-k33a-user';
const UNKNOWN_CONTACT = `${P}does_not_exist`;
const DAY_MS = 24 * 60 * 60 * 1000;

const ID = {
  ownerA: `${P}ownerA`,       // OWNER of bizA
  ownerB: `${P}ownerB`,       // OWNER of bizB
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  cA1: `${P}cA1`,             // live contact of A, no grant yet
  cA2: `${P}cA2`,             // live contact of A with an existing (disabled) grant
  cADeleted: `${P}cADeleted`, // soft-deleted contact of A
  cB: `${P}cB`,               // live contact of B with its own grant
  gA2: `${P}gA2`,
  gB: `${P}gB`,
};
const TOKEN = {
  gA2: `${P}token_gA2_seeded`,
  gB: `${P}token_gB_seeded`,
};
const SETTINGS_A2 = { invoices: true, projects: false, documents: true, bookings: false };
const SETTINGS_B = { invoices: true, projects: true, documents: false, bookings: true };

let db: any;
let app: any;
let redis: any;
let PortalServiceCtor: any;
let NotFoundExceptionCtor: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM portal_access WHERE business_id LIKE '${P}%' OR contact_id LIKE '${P}%'`,
    `DELETE FROM contacts WHERE business_id LIKE '${P}%'`,
    `DELETE FROM memberships WHERE business_id LIKE '${P}%' OR user_id LIKE '${P}%'`,
    `DELETE FROM businesses WHERE id LIKE '${P}%'`,
    `DELETE FROM users WHERE id LIKE '${P}%'`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

async function clearRateLimit() {
  const keys: string[] = await redis.keys(`rate_limit:*:${P}*`);
  if (keys.length) await redis.del(...keys);
}

function grant(actor: string | null, businessId: string, body: Record<string, unknown>) {
  const req = request(app.getHttpServer()).post(`/portal/businesses/${businessId}/access`).send(body);
  return actor ? req.set(HEADER, actor) : req;
}

/** Error bodies differ only in volatile envelope fields; strip those before comparing. */
function stripVolatile(body: Record<string, unknown>) {
  const copy = { ...body };
  delete copy.timestamp;
  delete copy.correlationId;
  return copy;
}

/** Every k33a_ portal row, as stored (raw SQL: under every client extension). */
async function portalRows(): Promise<string[]> {
  const rows: Array<{ j: string }> = await db.$queryRawUnsafe(
    `SELECT row_to_json(p)::text AS j FROM portal_access p
      WHERE p.business_id LIKE '${P}%' OR p.contact_id LIKE '${P}%' ORDER BY p.id`,
  );
  return rows.map((r) => r.j);
}

/** B's tenant state, as stored: the business, its contacts, its grants and any grant naming its contact. */
async function tenantBState(): Promise<string> {
  const parts: string[] = [];
  for (const sql of [
    `SELECT row_to_json(b)::text AS j FROM businesses b WHERE b.id = '${ID.bizB}'`,
    `SELECT row_to_json(c)::text AS j FROM contacts c WHERE c.business_id = '${ID.bizB}' ORDER BY c.id`,
    `SELECT row_to_json(m)::text AS j FROM memberships m WHERE m.business_id = '${ID.bizB}' ORDER BY m.id`,
    `SELECT row_to_json(p)::text AS j FROM portal_access p
      WHERE p.business_id = '${ID.bizB}' OR p.contact_id = '${ID.cB}' ORDER BY p.id`,
  ]) {
    const rows: Array<{ j: string }> = await db.$queryRawUnsafe(sql);
    parts.push(...rows.map((r) => r.j));
  }
  return parts.join('\n');
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe, NotFoundException } = await import('@nestjs/common');
  const IORedis = (await import('ioredis')).default;
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { RateLimitGuard } = await import('../src/core/guards/rate-limit.guard');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { PortalController } = await import('../src/modules/portal/portal.controller');
  const { PortalService } = await import('../src/modules/portal/portal.service');
  PortalServiceCtor = PortalService;
  NotFoundExceptionCtor = NotFoundException;

  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

  // ---- the real HTTP path, wired before any row is seeded -----------------
  const moduleRef = await Test.createTestingModule({
    controllers: [PortalController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      RateLimitGuard,
      { provide: REDIS_CLIENT, useValue: redis },
      PortalService,
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  // Identity attachment only. No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  // Same filter and pipe as app-bootstrap.ts, so status codes are the production ones.
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup(); // in case a prior run aborted
  await clearRateLimit();

  // ---- identities and tenants ---------------------------------------------
  for (const id of [ID.ownerA, ID.ownerB]) {
    await db.user.create({ data: { id, email: `${id}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'K33A Biz A', ownerId: ID.ownerA } });
  await db.business.create({ data: { id: ID.bizB, name: 'K33A Biz B', ownerId: ID.ownerB } });
  await db.membership.create({ data: { id: `${P}m_ownerA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });

  // ---- contacts -----------------------------------------------------------
  await db.contact.create({ data: { id: ID.cA1, businessId: ID.bizA, firstName: 'K33A', lastName: 'One' } });
  await db.contact.create({ data: { id: ID.cA2, businessId: ID.bizA, firstName: 'K33A', lastName: 'Two' } });
  await db.contact.create({ data: { id: ID.cADeleted, businessId: ID.bizA, firstName: 'K33A', lastName: 'Gone', deletedAt: new Date() } });
  await db.contact.create({ data: { id: ID.cB, businessId: ID.bizB, firstName: 'K33A', lastName: 'Bee' } });

  // ---- existing grants: A2's is disabled and near expiry; B's is live -------
  await db.portalAccess.create({
    data: {
      id: ID.gA2, businessId: ID.bizA, contactId: ID.cA2, token: TOKEN.gA2,
      expiresAt: new Date(Date.now() + 2 * DAY_MS), enabled: false, settings: SETTINGS_A2,
    },
  });
  await db.portalAccess.create({
    data: {
      id: ID.gB, businessId: ID.bizB, contactId: ID.cB, token: TOKEN.gB,
      expiresAt: new Date(Date.now() + 30 * DAY_MS), enabled: true, settings: SETTINGS_B,
    },
  });
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) {
    try { await clearRateLimit(); } catch { /* best-effort */ }
    await redis.quit();
  }
});

beforeEach(clearRateLimit);

describe('fixture sanity (real rows)', () => {
  it('seeded two tenants, their contacts and one grant each', async () => {
    expect(await db.contact.count({ where: { businessId: ID.bizA } })).toBe(2); // soft-deleted one is hidden
    expect(await db.contact.count({ where: { businessId: ID.bizB } })).toBe(1);
    const rows = await portalRows();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => JSON.parse(r).id)).toEqual([ID.gA2, ID.gB].sort());
  });
});

describe('POST /portal/businesses/:businessId/access binds only a contact of the path tenant', () => {
  it("NEGATIVE CONTROL (pre-fix FAIL expected): A's owner granting B's contact on A's path answers 404 and writes no row", async () => {
    const before = await portalRows();
    const res = await grant(ID.ownerA, ID.bizA, { contactId: ID.cB });
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Contact not found');
    expect(JSON.stringify(res.body)).not.toContain('token');
    expect(await portalRows()).toEqual(before);
    expect(await db.portalAccess.count({ where: { businessId: ID.bizA, contactId: ID.cB } })).toBe(0);
  });

  it("NEGATIVE CONTROL (pre-fix FAIL expected): a foreign contact id answers byte-identically to an unknown id, and neither writes a row", async () => {
    const before = await portalRows();
    const foreign = await grant(ID.ownerA, ID.bizA, { contactId: ID.cB });
    const unknown = await grant(ID.ownerA, ID.bizA, { contactId: UNKNOWN_CONTACT });
    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(stripVolatile(foreign.body)).toEqual(stripVolatile(unknown.body));
    expect(Object.keys(foreign.body).sort()).toEqual(Object.keys(unknown.body).sort());
    expect(await portalRows()).toEqual(before);
  });

  it("NEGATIVE CONTROL (pre-fix FAIL expected): the reverse — B's owner granting A's contact on B's path — answers 404 and writes no row", async () => {
    const before = await portalRows();
    const res = await grant(ID.ownerB, ID.bizB, { contactId: ID.cA1 });
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Contact not found');
    expect(await portalRows()).toEqual(before);
  });

  it("NEGATIVE CONTROL (pre-fix FAIL expected): B's tenant state is byte-identical after A's attempts on B's contact", async () => {
    const before = await tenantBState();
    expect(before).toContain(TOKEN.gB);
    for (const settings of [undefined, { invoices: false }]) {
      const res = await grant(ID.ownerA, ID.bizA, settings ? { contactId: ID.cB, settings } : { contactId: ID.cB });
      expect(res.status).toBe(404);
    }
    expect(await tenantBState()).toBe(before);
  });

  it("NEGATIVE CONTROL (pre-fix FAIL expected): a request with no contactId, or a non-string one, binds nothing and answers like an unknown id", async () => {
    const before = await portalRows();
    const unknown = await grant(ID.ownerA, ID.bizA, { contactId: UNKNOWN_CONTACT });
    for (const body of [{}, { contactId: '' }, { contactId: { startsWith: P } }, { contactId: 42 }]) {
      const res = await grant(ID.ownerA, ID.bizA, body);
      expect(res.status, JSON.stringify(body)).toBe(404);
      expect(stripVolatile(res.body), JSON.stringify(body)).toEqual(stripVolatile(unknown.body));
    }
    expect(await portalRows()).toEqual(before);
  });

  it("a soft-deleted contact of A is not a contact of A: 404, no row", async () => {
    const before = await portalRows();
    const res = await grant(ID.ownerA, ID.bizA, { contactId: ID.cADeleted });
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Contact not found');
    expect(await portalRows()).toEqual(before);
  });

  it("the service refuses a foreign contact itself, so the KEY flow and storelink callers are bound too", async () => {
    const service = new PortalServiceCtor({ client: db });
    const before = await portalRows();
    await expect(service.createAccess(ID.bizA, ID.cB)).rejects.toBeInstanceOf(NotFoundExceptionCtor);
    await expect(service.createAccess(ID.bizA, ID.cB, { invoices: true })).rejects.toBeInstanceOf(NotFoundExceptionCtor);
    expect(await portalRows()).toEqual(before);
  });

  it("positive control: A's owner granting A's own contact answers 201 and writes one row bound to A", async () => {
    const res = await grant(ID.ownerA, ID.bizA, { contactId: ID.cA1, settings: { invoices: true } });
    expect(res.status).toBe(201);
    expect(res.body.businessId).toBe(ID.bizA);
    expect(res.body.contactId).toBe(ID.cA1);
    expect(res.body.enabled).toBe(true);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.settings).toEqual({ invoices: true });
    const rows = await db.portalAccess.findMany({ where: { businessId: ID.bizA, contactId: ID.cA1 } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: res.body.id, businessId: ID.bizA, contactId: ID.cA1, enabled: true });
  });

  it('positive control: B granting its own contact on its own path still answers 201 (re-grant of its existing row)', async () => {
    const res = await grant(ID.ownerB, ID.bizB, { contactId: ID.cB });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(ID.gB);
    expect(res.body.businessId).toBe(ID.bizB);
    expect(res.body.contactId).toBe(ID.cB);
    expect(res.body.token).not.toBe(TOKEN.gB);
    expect(res.body.settings).toEqual(SETTINGS_B);
  });

  it('re-granting an existing grant of an A contact behaves as before: same row, fresh token, enabled, 90 days, settings kept', async () => {
    const t0 = Date.now();
    const res = await grant(ID.ownerA, ID.bizA, { contactId: ID.cA2 });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(ID.gA2);
    expect(res.body.businessId).toBe(ID.bizA);
    expect(res.body.contactId).toBe(ID.cA2);
    expect(res.body.enabled).toBe(true);
    expect(res.body.token).not.toBe(TOKEN.gA2);
    expect(res.body.token).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.settings).toEqual(SETTINGS_A2);
    const expires = new Date(res.body.expiresAt).getTime();
    expect(expires).toBeGreaterThanOrEqual(t0 + 90 * DAY_MS - 5_000);
    expect(expires).toBeLessThanOrEqual(Date.now() + 90 * DAY_MS + 5_000);
    expect(await db.portalAccess.count({ where: { businessId: ID.bizA, contactId: ID.cA2 } })).toBe(1);

    // New settings replace the old ones on re-grant, as before.
    const again = await grant(ID.ownerA, ID.bizA, { contactId: ID.cA2, settings: { invoices: false } });
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(ID.gA2);
    expect(again.body.token).not.toBe(res.body.token);
    expect(again.body.settings).toEqual({ invoices: false });
    expect(await db.portalAccess.count({ where: { businessId: ID.bizA, contactId: ID.cA2 } })).toBe(1);
  });
});

describe('the guards in front of the grant are unchanged', () => {
  it('anonymous answers 401 and a member of another tenant answers 403; neither writes a row', async () => {
    const before = await portalRows();
    const anon = await grant(null, ID.bizA, { contactId: ID.cA1 });
    expect(anon.status).toBe(401);
    const other = await grant(ID.ownerB, ID.bizA, { contactId: ID.cA1 });
    expect(other.status).toBe(403);
    expect(await portalRows()).toEqual(before);
  });
});
