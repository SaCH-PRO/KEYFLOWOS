/**
 * V1-91 (RR-ADMIN-API-SIGNIN-KIND, owner ruling D-291):
 * Unit specification proving that:
 *
 *   1. AuthMiddleware records an explicit, non-forgeable `authKind`
 *      ('supabase' | 'admin') derived strictly from WHICH cryptographic
 *      verifier verified the bearer token — NEVER from headers, query params,
 *      or JWT payload/metadata claims.
 *   2. `req.user` stays deep-equal to `{ id, email, role }` (R0 compatibility)
 *      while exposing `authKind` read-only on `req.user` and on `req.authKind`.
 *   3. AdminGuard requires BOTH `user.role === 'SUPER_ADMIN'` AND
 *      `authKind === 'admin'` (separate local HMAC admin sign-in).
 *   4. Other role-only admin guards / inline checks (SeoAdminGuard's
 *      comingSoon SUPER_ADMIN bypass, DiagnosticsController,
 *      AdminFeatureFlagsController, AiUsageAdminController,
 *      RiscAdminController, AdminAuthController /me & /logout,
 *      IdentityController.getAuthAudit, AiController.updateRoutingConfig)
 *      consistently enforce the separate admin sign-in kind.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthMiddleware } from './auth.middleware';
import { AdminGuard } from './admin.guard';
import { buildAdminToken } from './admin-token.util';
import { SeoAdminGuard } from '../../modules/seo/seo-admin.guard';
import { DiagnosticsController } from '../../modules/diagnostics/diagnostics.controller';
import { AdminFeatureFlagsController } from '../../modules/feature-flags/feature-flags.controller';
import { AiUsageAdminController } from '../../modules/ai/ai-usage-admin.controller';
import { RiscAdminController } from '../../modules/risc/risc-admin.controller';
import { AdminAuthController } from '../../modules/admin-auth/admin-auth.controller';
import { IdentityController } from '../../modules/identity/identity.controller';
import { AiController } from '../../modules/ai/ai.controller';

const ADMIN_SECRET = 'p202-unit-admin-secret-not-real';

function makeReq(overrides: Partial<Request> & Record<string, unknown> = {}): Request {
  return {
    headers: {},
    query: {},
    ...overrides,
  } as unknown as Request;
}

function makeHttpContext(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

function makeFakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fake-sig`;
}

describe('D-291 RR-ADMIN-API-SIGNIN-KIND — AuthMiddleware authKind recording', () => {
  const prevSecret = process.env.ADMIN_JWT_SECRET;
  const res = {} as Response;
  const next = vi.fn();

  beforeEach(() => {
    process.env.ADMIN_JWT_SECRET = ADMIN_SECRET;
    next.mockReset();
  });

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.ADMIN_JWT_SECRET;
    else process.env.ADMIN_JWT_SECRET = prevSecret;
  });

  function makeMiddleware(opts: {
    supabaseUser: { id: string; email?: string; role?: string } | null;
    dbRow?: { role: string; deletedAt: Date | null; bannedAt: Date | null; metaData?: unknown } | null;
  }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- unit mock
    const supabaseAuth: any = {
      getUserFromToken: vi.fn().mockResolvedValue(opts.supabaseUser),
    };
    const row =
      opts.dbRow === undefined
        ? { role: 'SUPER_ADMIN', deletedAt: null, bannedAt: null, metaData: null }
        : opts.dbRow;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- unit mock
    const prisma: any = {
      client: { user: { findUnique: vi.fn().mockResolvedValue(row) } },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- unit mock
    const redis: any = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
    };
    return new AuthMiddleware(supabaseAuth, prisma, redis);
  }

  it('records authKind="supabase" for a Supabase-verified SUPER_ADMIN and preserves { id, email, role } equality', async () => {
    const mw = makeMiddleware({
      supabaseUser: { id: 'u-super', email: 'super@example.com' },
      dbRow: { role: 'SUPER_ADMIN', deletedAt: null, bannedAt: null, metaData: null },
    });
    const token = makeFakeJwt({
      sub: 'u-super',
      email: 'super@example.com',
      role: 'SUPER_ADMIN',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const req = makeReq({ headers: { authorization: `Bearer ${token}` } });

    await mw.use(req, res, next);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reading attached auth fields
    const r = req as any;
    expect(r.user).toEqual({ id: 'u-super', email: 'super@example.com', role: 'SUPER_ADMIN' });
    expect(r.authKind).toBe('supabase');
    expect(r.user.authKind).toBe('supabase');
  });

  it('ignores forged headers, query params, and Supabase JWT authKind/type/app_metadata claims', async () => {
    const mw = makeMiddleware({
      supabaseUser: { id: 'u-super', email: 'super@example.com', role: 'SUPER_ADMIN' },
      dbRow: { role: 'SUPER_ADMIN', deletedAt: null, bannedAt: null, metaData: null },
    });
    const forgedSupabaseJwt = makeFakeJwt({
      sub: 'u-super',
      email: 'super@example.com',
      role: 'SUPER_ADMIN',
      type: 'admin',
      authKind: 'admin',
      signInKind: 'admin',
      user_metadata: { authKind: 'admin', role: 'SUPER_ADMIN' },
      app_metadata: { authKind: 'admin', role: 'SUPER_ADMIN' },
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const req = makeReq({
      headers: {
        authorization: `Bearer ${forgedSupabaseJwt}`,
        'x-auth-kind': 'admin',
        'x-signin-kind': 'admin',
        'x-admin-session': 'true',
      },
      query: { authKind: 'admin', signInKind: 'admin' },
    });

    await mw.use(req, res, next);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reading attached auth fields
    const r = req as any;
    expect(r.authKind).toBe('supabase');
    expect(r.user.authKind).toBe('supabase');
  });

  it('records authKind="admin" ONLY for a valid local HMAC admin token and preserves { id, email, role } equality', async () => {
    const mw = makeMiddleware({
      supabaseUser: null,
      dbRow: { role: 'SUPER_ADMIN', deletedAt: null, bannedAt: null },
    });
    const adminToken = buildAdminToken(
      { id: 'u-admin', email: 'admin@example.com', role: 'SUPER_ADMIN' },
      ADMIN_SECRET,
    );
    const req = makeReq({ headers: { authorization: `Bearer ${adminToken}` } });

    await mw.use(req, res, next);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reading attached auth fields
    const r = req as any;
    expect(r.user).toEqual({ id: 'u-admin', email: 'admin@example.com', role: 'SUPER_ADMIN' });
    expect(r.authKind).toBe('admin');
    expect(r.user.authKind).toBe('admin');
  });

  it('records authKind="admin" with DB role="USER" when an admin-signed-in user was demoted in DB', async () => {
    const mw = makeMiddleware({
      supabaseUser: null,
      dbRow: { role: 'USER', deletedAt: null, bannedAt: null },
    });
    const adminToken = buildAdminToken(
      { id: 'u-demoted', email: 'demoted@example.com', role: 'SUPER_ADMIN' },
      ADMIN_SECRET,
    );
    const req = makeReq({ headers: { authorization: `Bearer ${adminToken}` } });

    await mw.use(req, res, next);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reading attached auth fields
    const r = req as any;
    expect(r.user).toEqual({ id: 'u-demoted', email: 'demoted@example.com', role: 'USER' });
    expect(r.authKind).toBe('admin');
    expect(r.user.authKind).toBe('admin');
  });

  it('leaves authKind undefined and clears any pre-populated authKind when unauthenticated or rejected', async () => {
    const mw = makeMiddleware({ supabaseUser: null });
    const reqNoHeader = makeReq({ authKind: 'admin' });
    await mw.use(reqNoHeader, res, next);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reading attached auth fields
    expect((reqNoHeader as any).user).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reading attached auth fields
    expect((reqNoHeader as any).authKind).toBeUndefined();

    const reqBadToken = makeReq({
      headers: { authorization: 'Bearer invalid.jwt.token' },
      authKind: 'admin',
    });
    await mw.use(reqBadToken, res, next);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reading attached auth fields
    expect((reqBadToken as any).user).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reading attached auth fields
    expect((reqBadToken as any).authKind).toBeUndefined();
  });
});

describe('D-291 RR-ADMIN-API-SIGNIN-KIND — AdminGuard', () => {
  const guard = new AdminGuard();

  it('admits a SUPER_ADMIN with authKind="admin"', () => {
    const ctx = makeHttpContext({
      authKind: 'admin',
      user: { id: 'u-admin', role: 'SUPER_ADMIN', authKind: 'admin' },
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('refuses a Supabase-authenticated SUPER_ADMIN with ForbiddenException', () => {
    const ctx = makeHttpContext({
      authKind: 'supabase',
      user: { id: 'u-super', role: 'SUPER_ADMIN', authKind: 'supabase' },
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('fails closed (ForbiddenException) when a SUPER_ADMIN request has no authKind', () => {
    const ctx = makeHttpContext({
      user: { id: 'u-super', role: 'SUPER_ADMIN' },
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('treats req.authKind="supabase" as authoritative even if user.authKind were tampered', () => {
    const ctx = makeHttpContext({
      authKind: 'supabase',
      user: { id: 'u-super', role: 'SUPER_ADMIN', authKind: 'admin' },
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('refuses a non-SUPER_ADMIN even with authKind="admin"', () => {
    const ctx = makeHttpContext({
      authKind: 'admin',
      user: { id: 'u-demoted', role: 'USER', authKind: 'admin' },
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('refuses an unauthenticated request with ForbiddenException', () => {
    const ctx = makeHttpContext({});
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});

describe('D-291 RR-ADMIN-API-SIGNIN-KIND — SeoAdminGuard', () => {
  function makeGuard(flagStatus: { exists: boolean; comingSoon: boolean; bypass: boolean }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- unit mock
    const featureFlags: any = {
      hasBypass: vi.fn().mockResolvedValue(flagStatus),
    };
    return { guard: new SeoAdminGuard(featureFlags), featureFlags };
  }

  it('allows an admin-signed-in SUPER_ADMIN to bypass comingSoon without bypassEmails', async () => {
    const { guard, featureFlags } = makeGuard({ exists: true, comingSoon: true, bypass: false });
    const ctx = makeHttpContext({
      authKind: 'admin',
      user: { id: 'u-admin', email: 'admin@example.com', role: 'SUPER_ADMIN', authKind: 'admin' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(featureFlags.hasBypass).not.toHaveBeenCalled();
  });

  it('refuses a Supabase-signed-in SUPER_ADMIN when nav.workspaces.seo is comingSoon and not in bypassEmails', async () => {
    const { guard } = makeGuard({ exists: true, comingSoon: true, bypass: false });
    const ctx = makeHttpContext({
      authKind: 'supabase',
      user: { id: 'u-super', email: 'super@example.com', role: 'SUPER_ADMIN', authKind: 'supabase' },
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('fails closed when a SUPER_ADMIN has no authKind and nav.workspaces.seo is comingSoon', async () => {
    const { guard } = makeGuard({ exists: true, comingSoon: true, bypass: false });
    const ctx = makeHttpContext({
      user: { id: 'u-super', email: 'super@example.com', role: 'SUPER_ADMIN' },
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('allows a Supabase-signed-in SUPER_ADMIN when explicitly allowlisted in bypassEmails', async () => {
    const { guard } = makeGuard({ exists: true, comingSoon: true, bypass: true });
    const ctx = makeHttpContext({
      authKind: 'supabase',
      user: { id: 'u-super', email: 'allowlisted@example.com', role: 'SUPER_ADMIN', authKind: 'supabase' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('allows regular users and Supabase SUPER_ADMIN when nav.workspaces.seo is NOT comingSoon', async () => {
    const { guard } = makeGuard({ exists: false, comingSoon: false, bypass: false });
    const ctx = makeHttpContext({
      authKind: 'supabase',
      user: { id: 'u-regular', email: 'user@example.com', role: 'USER', authKind: 'supabase' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('throws UnauthorizedException when unauthenticated', async () => {
    const { guard } = makeGuard({ exists: false, comingSoon: false, bypass: false });
    const ctx = makeHttpContext({});
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });
});

describe('D-291 RR-ADMIN-API-SIGNIN-KIND — other role-only platform-admin controllers', () => {
  const adminReq = {
    authKind: 'admin',
    user: { id: 'u-admin', email: 'admin@example.com', role: 'SUPER_ADMIN', authKind: 'admin' },
  } as unknown as Request;

  const supabaseSuperReq = {
    authKind: 'supabase',
    user: { id: 'u-super', email: 'super@example.com', role: 'SUPER_ADMIN', authKind: 'supabase' },
  } as unknown as Request;

  const demotedAdminReq = {
    authKind: 'admin',
    user: { id: 'u-demoted', email: 'demoted@example.com', role: 'USER', authKind: 'admin' },
  } as unknown as Request;

  it('DiagnosticsController refuses Supabase SUPER_ADMIN and demoted admin, allows admin SUPER_ADMIN', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- unit mock
    const svc: any = { checkEnvVars: vi.fn().mockReturnValue({ ok: true }) };
    const ctrl = new DiagnosticsController(svc);

    expect(ctrl.envVars(adminReq)).toEqual({ ok: true });
    expect(() => ctrl.envVars(supabaseSuperReq)).toThrow(ForbiddenException);
    expect(() => ctrl.envVars(demotedAdminReq)).toThrow(ForbiddenException);
  });

  it('AdminFeatureFlagsController refuses Supabase SUPER_ADMIN and allows admin SUPER_ADMIN', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- unit mock
    const svc: any = { listAll: vi.fn().mockResolvedValue([]) };
    const ctrl = new AdminFeatureFlagsController(svc);

    await expect(ctrl.listAll(adminReq)).resolves.toEqual({ flags: [] });
    await expect(ctrl.listAll(supabaseSuperReq)).rejects.toThrow(ForbiddenException);
    await expect(ctrl.listAll(demotedAdminReq)).rejects.toThrow(ForbiddenException);
  });

  it('AiUsageAdminController refuses Supabase SUPER_ADMIN and allows admin SUPER_ADMIN', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- unit mock
    const aiUsage: any = { getUsageSummary: vi.fn().mockResolvedValue({ creditsUsed: 0 }) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- unit mock
    const prisma: any = { client: {} };
    const ctrl = new AiUsageAdminController(aiUsage, prisma);

    await expect(ctrl.businessSummary(adminReq, 'biz-1')).resolves.toEqual({ creditsUsed: 0 });
    await expect(ctrl.businessSummary(supabaseSuperReq, 'biz-1')).rejects.toThrow(ForbiddenException);
    await expect(ctrl.businessSummary(demotedAdminReq, 'biz-1')).rejects.toThrow(ForbiddenException);
  });

  it('RiscAdminController refuses Supabase SUPER_ADMIN and allows admin SUPER_ADMIN', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- unit mock
    const risc: any = { eraseForUser: vi.fn().mockResolvedValue({ deleted: 2 }) };
    const ctrl = new RiscAdminController(risc);

    await expect(
      ctrl.eraseUserEvents(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- authKind field added in GREEN
        { id: 'u-admin', email: 'admin@example.com', role: 'SUPER_ADMIN', authKind: 'admin' } as any,
        'u-target',
      ),
    ).resolves.toEqual({ erased: 2 });

    await expect(
      ctrl.eraseUserEvents(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- authKind field added in GREEN
        { id: 'u-super', email: 'super@example.com', role: 'SUPER_ADMIN', authKind: 'supabase' } as any,
        'u-target',
      ),
    ).rejects.toThrow();
    expect(risc.eraseForUser).toHaveBeenCalledTimes(1);
  });

  it('AdminAuthController /me and /logout refuse Supabase SUPER_ADMIN with 403 and allow admin sign-in (including demoted role on /me)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- unit mock
    const adminAuth: any = { revokeAllTokens: vi.fn().mockResolvedValue(undefined) };
    const ctrl = new AdminAuthController(adminAuth);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- authKind field added in GREEN
    const adminUser = { id: 'u-admin', email: 'admin@example.com', role: 'SUPER_ADMIN', authKind: 'admin' } as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- authKind field added in GREEN
    const demotedUser = { id: 'u-demoted', email: 'demoted@example.com', role: 'USER', authKind: 'admin' } as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- authKind field added in GREEN
    const supabaseSuper = { id: 'u-super', email: 'super@example.com', role: 'SUPER_ADMIN', authKind: 'supabase' } as any;

    await expect(ctrl.me(adminUser)).resolves.toEqual({
      id: 'u-admin',
      email: 'admin@example.com',
      role: 'SUPER_ADMIN',
    });
    await expect(ctrl.me(demotedUser)).resolves.toEqual({
      id: 'u-demoted',
      email: 'demoted@example.com',
      role: 'USER',
    });
    await expect(ctrl.me(supabaseSuper)).rejects.toThrow(ForbiddenException);
    await expect(ctrl.me(undefined)).rejects.toThrow(UnauthorizedException);

    await expect(ctrl.logout(adminUser)).resolves.toEqual({ success: true });
    await expect(ctrl.logout(supabaseSuper)).rejects.toThrow(ForbiddenException);
    await expect(ctrl.logout(undefined)).rejects.toThrow(UnauthorizedException);
  });

  it('IdentityController.getAuthAudit refuses Supabase SUPER_ADMIN and allows admin SUPER_ADMIN', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- isolated controller prototype call
    const ctrl = Object.create(IdentityController.prototype) as any;
    ctrl.prisma = {
      client: {
        authAuditLog: { findMany: vi.fn().mockResolvedValue([]) },
      },
    };

    await expect(
      ctrl.getAuthAudit({ id: 'u-admin', email: 'admin@example.com', role: 'SUPER_ADMIN', authKind: 'admin' }),
    ).resolves.toEqual({ entries: [], count: 0 });

    await expect(
      ctrl.getAuthAudit({ id: 'u-super', email: 'super@example.com', role: 'SUPER_ADMIN', authKind: 'supabase' }),
    ).rejects.toThrow();
    expect(ctrl.prisma.client.authAuditLog.findMany).toHaveBeenCalledTimes(1);
  });

  it('AiController.updateRoutingConfig refuses Supabase SUPER_ADMIN and allows admin SUPER_ADMIN', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- isolated controller prototype call
    const ctrl = Object.create(AiController.prototype) as any;
    ctrl.gateway = { updateRoutingConfig: vi.fn().mockReturnValue({ updated: true }) };

    await expect(ctrl.updateRoutingConfig('biz-1', adminReq, {})).resolves.toEqual({ updated: true });
    await expect(ctrl.updateRoutingConfig('biz-1', supabaseSuperReq, {})).rejects.toThrow(ForbiddenException);
    expect(ctrl.gateway.updateRoutingConfig).toHaveBeenCalledTimes(1);
  });
});
