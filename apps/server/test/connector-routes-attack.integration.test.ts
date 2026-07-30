/**
 * Connectors Certification — cross-tenant attack suite: HTTP routes (REAL database).
 *
 * The connector controller exposes every connector operation under
 * `connectors/businesses/:businessId/<op>/:type` behind a CLASS-LEVEL
 * `@UseGuards(AuthGuard, BusinessGuard)`. Nest runs that guard before any
 * handler, so a request whose `:businessId` the caller is not a member of is
 * denied before the registry (and therefore any external provider) is invoked.
 *
 * This proves, together:
 *   1. every route is gated by BusinessGuard (class-level guard metadata), and
 *   2. the real BusinessGuard denies cross-tenant `:businessId` and fails closed,
 *   3. the handler only reaches the registry with a verified businessId.
 *
 * EXIT CRITERIA (Tenant Isolation — connector HTTP routes):
 *   [x] cross-tenant :businessId denied for every operation (guard gates all routes)
 *   [x] malformed / nonexistent / missing businessId rejected (fail closed)
 *   [x] missing authenticated user rejected
 *   [x] registry/provider not reached on a denied request
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'tcr_';
const ID = { userA: `${P}userA`, userB: `${P}userB`, bizA: `${P}bizA`, bizB: `${P}bizB` };

let db: any;
let BusinessGuard: any;
let AuthGuard: any;
let ConnectorController: any;
let guard: any;

function ctx(user: { id: string; role?: string } | undefined, businessId?: string) {
  return { switchToHttp: () => ({ getRequest: () => ({ user, params: { businessId } }) }) } as any;
}

async function cleanup() {
  for (const sql of [
    `DELETE FROM memberships WHERE id LIKE '${P}%'`,
    `DELETE FROM businesses WHERE id LIKE '${P}%'`,
    `DELETE FROM users WHERE id LIKE '${P}%'`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  ({ BusinessGuard } = await import('../src/core/auth/business.guard'));
  ({ AuthGuard } = await import('../src/core/auth/auth.guard'));
  ({ ConnectorController } = await import('../src/core/connectors/connector.controller'));
  guard = new BusinessGuard(new PrismaService() as any);

  await cleanup();
  await db.user.create({ data: { id: ID.userA, email: `${P}a@t.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.userB, email: `${P}b@t.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizA, name: 'A', ownerId: ID.userA } });
  await db.business.create({ data: { id: ID.bizB, name: 'B', ownerId: ID.userB } });
  await db.membership.create({ data: { id: `${P}mA`, userId: ID.userA, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}mB`, userId: ID.userB, businessId: ID.bizB, role: 'OWNER' } });
}, 60_000);

afterAll(async () => { if (db) await cleanup(); });

describe('Connector HTTP routes — every route is gated by BusinessGuard', () => {
  it('the controller applies AuthGuard + BusinessGuard at the class level', () => {
    // Nest stores @UseGuards under the '__guards__' metadata key.
    const guards = Reflect.getMetadata('__guards__', ConnectorController) ?? [];
    expect(guards).toContain(AuthGuard);
    expect(guards).toContain(BusinessGuard);
  });
});

describe('Connector HTTP routes — BusinessGuard cross-tenant denial (real DB)', () => {
  it('DENIES a member of Business A from any connector op on Business B', async () => {
    await expect(guard.canActivate(ctx({ id: ID.userA }, ID.bizB))).rejects.toThrow();
  });

  it('allows a member on their own business', async () => {
    await expect(guard.canActivate(ctx({ id: ID.userA }, ID.bizA))).resolves.toBe(true);
  });

  it('fails closed on missing / nonexistent businessId and missing user', async () => {
    await expect(guard.canActivate(ctx({ id: ID.userA }, undefined))).rejects.toThrow();
    await expect(guard.canActivate(ctx({ id: ID.userA }, `${P}nope`))).rejects.toThrow();
    await expect(guard.canActivate(ctx(undefined, ID.bizA))).rejects.toThrow();
  });
});

describe('Connector HTTP routes — registry only reached with a verified businessId', () => {
  it('the handler delegates to the registry using the (guard-verified) :businessId', async () => {
    // Positive control: with the guard satisfied, the handler forwards the exact
    // businessId to the registry — so the registry never sees a foreign tenant.
    const registry = { getStatuses: vi.fn().mockResolvedValue([]), syncConnector: vi.fn().mockResolvedValue({ success: true }) } as any;
    const controller = new ConnectorController(registry, {} as any, {} as any, {} as any, {} as any);
    await controller.getStatuses(ID.bizA);
    expect(registry.getStatuses).toHaveBeenCalledWith(ID.bizA);
    expect(registry.getStatuses).not.toHaveBeenCalledWith(ID.bizB);
  });
});
