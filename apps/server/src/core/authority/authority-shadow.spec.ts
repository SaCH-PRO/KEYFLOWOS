import { describe, expect, it, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import {
  ModuleScopeGuard,
  RequireModuleScope,
  ShadowEffectiveAuthority,
} from '../auth/module-scope.guard';
import { EffectiveAuthorityResolver } from './effective-authority.resolver';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * The shadow must be an observer and nothing else.
 *
 * The legacy guard answer stays authoritative through cutover, so these tests care
 * about one property above all: no input, and no resolver behaviour including throwing,
 * may change what the guard decides. A shadow that can fail the request it observes is
 * a second point of failure in the authority path, not evidence.
 */

const BUSINESS = 'biz_1';

function prismaWith(membership: any): PrismaService {
  return {
    client: {
      membership: {
        findUnique: vi.fn(async () => membership),
        findMany: vi.fn(async () => []),
      },
      user: { findUnique: vi.fn(async () => ({ id: 'user_1', role: 'USER' })) },
      orgAssignment: { findMany: vi.fn(async () => []) },
      authorityGrant: { findMany: vi.fn(async () => []) },
      delegationRule: { findMany: vi.fn(async () => []) },
    },
  } as unknown as PrismaService;
}

function ctxFor(handler: () => void) {
  return {
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => ({ user: { id: 'user_1' }, params: { businessId: BUSINESS } }) }),
  } as any;
}

class Shadowed {
  @RequireModuleScope('operations', 'read')
  @ShadowEffectiveAuthority()
  handler() {}
}

class NotShadowed {
  @RequireModuleScope('operations', 'read')
  handler() {}
}

async function run(guard: ModuleScopeGuard, handler: () => void) {
  try {
    return { allowed: await guard.canActivate(ctxFor(handler)) };
  } catch (e) {
    return { allowed: false, error: e };
  }
}

describe('shadow/compare is observation only', () => {
  it('records a mismatch without changing an ALLOW', async () => {
    // Legacy: no explicit map -> OWNER role default -> operations admin -> ALLOW.
    // Resolver: narrowed by nothing here, so force disagreement via a stub.
    const prisma = prismaWith({ id: 'mem_1', role: 'OWNER', permissionScopes: null, maxApprovalTier: 0 });
    const resolver = {
      resolve: vi.fn(async () => ({
        modules: { operations: { module: 'operations', level: 'none', reason: 'explicit_deny', explicitDeny: true, sources: [] } },
        positions: [],
        validity: { truncated: false },
      })),
    } as unknown as EffectiveAuthorityResolver;

    const warn = vi.fn();
    const guard = new ModuleScopeGuard(prisma, new Reflector(), resolver);
    (guard as any).logger = { warn, debug: vi.fn(), error: vi.fn() };

    const r = await run(guard, Shadowed.prototype.handler);

    expect(r.allowed).toBe(true); // legacy answer wins
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/MISMATCH.*legacy=ALLOW.*resolver=DENY/);
  });

  it('records a mismatch without changing a DENY', async () => {
    // A shadow that only reports on requests that passed would miss exactly the
    // mismatches a cutover most needs to see.
    const prisma = prismaWith({ id: 'mem_1', role: 'STAFF', permissionScopes: {}, maxApprovalTier: 0 });
    const resolver = {
      resolve: vi.fn(async () => ({
        modules: { operations: { module: 'operations', level: 'admin', reason: 'role_default', explicitDeny: false, sources: [] } },
        positions: [],
        validity: { truncated: false },
      })),
    } as unknown as EffectiveAuthorityResolver;

    const warn = vi.fn();
    const guard = new ModuleScopeGuard(prisma, new Reflector(), resolver);
    (guard as any).logger = { warn, debug: vi.fn(), error: vi.fn() };

    const r = await run(guard, Shadowed.prototype.handler);

    expect(r.allowed).toBe(false);
    expect(r.error).toBeInstanceOf(ForbiddenException);
    expect(warn.mock.calls[0][0]).toMatch(/MISMATCH.*legacy=DENY.*resolver=ALLOW/);
  });

  it('stays silent when the two agree', async () => {
    const prisma = prismaWith({ id: 'mem_1', role: 'OWNER', permissionScopes: null, maxApprovalTier: 0 });
    const warn = vi.fn();
    const guard = new ModuleScopeGuard(prisma, new Reflector(), new EffectiveAuthorityResolver(prisma));
    (guard as any).logger = { warn, debug: vi.fn(), error: vi.fn() };

    const r = await run(guard, Shadowed.prototype.handler);

    expect(r.allowed).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not fail the request when the resolver throws', async () => {
    const prisma = prismaWith({ id: 'mem_1', role: 'OWNER', permissionScopes: null, maxApprovalTier: 0 });
    const resolver = { resolve: vi.fn(async () => { throw new Error('resolver exploded'); }) } as unknown as EffectiveAuthorityResolver;
    const warn = vi.fn();
    const guard = new ModuleScopeGuard(prisma, new Reflector(), resolver);
    (guard as any).logger = { warn, debug: vi.fn(), error: vi.fn() };

    const r = await run(guard, Shadowed.prototype.handler);

    expect(r.allowed).toBe(true);
    expect(warn.mock.calls[0][0]).toMatch(/failed, legacy answer unaffected/);
  });

  it('never runs on a route that did not opt in', async () => {
    const prisma = prismaWith({ id: 'mem_1', role: 'OWNER', permissionScopes: null, maxApprovalTier: 0 });
    const resolve = vi.fn();
    const guard = new ModuleScopeGuard(prisma, new Reflector(), { resolve } as unknown as EffectiveAuthorityResolver);

    await run(guard, NotShadowed.prototype.handler);

    expect(resolve).not.toHaveBeenCalled();
  });

  it('works with no resolver injected at all', async () => {
    // The provider is @Optional so that direct constructions — tests, and any module
    // Nest resolves before AuthorityModule — keep working with shadowing inert.
    const prisma = prismaWith({ id: 'mem_1', role: 'OWNER', permissionScopes: null, maxApprovalTier: 0 });
    const guard = new ModuleScopeGuard(prisma, new Reflector());
    const r = await run(guard, Shadowed.prototype.handler);
    expect(r.allowed).toBe(true);
  });

  it('never logs the scope map itself', async () => {
    // permissionScopes is security configuration. A mismatch report that leaks the
    // permission set is a worse problem than the mismatch it describes.
    const prisma = prismaWith({
      id: 'mem_1',
      role: 'STAFF',
      permissionScopes: { operations: 'none', crm: 'admin', secret_flag: 'yes' },
      maxApprovalTier: 0,
    });
    const resolver = {
      resolve: vi.fn(async () => ({
        modules: { operations: { module: 'operations', level: 'admin', reason: 'role_default', explicitDeny: false, sources: [] } },
        positions: [],
        validity: { truncated: false },
      })),
    } as unknown as EffectiveAuthorityResolver;

    const warn = vi.fn();
    const guard = new ModuleScopeGuard(prisma, new Reflector(), resolver);
    (guard as any).logger = { warn, debug: vi.fn(), error: vi.fn() };

    await run(guard, Shadowed.prototype.handler);

    const logged = warn.mock.calls.map((c) => String(c[0])).join(' ');
    expect(logged).toMatch(/MISMATCH/);
    expect(logged).not.toMatch(/secret_flag/);
    expect(logged).not.toMatch(/crm/);
  });

  it('a mismatch is counted', async () => {
    const { securitySignals } = await import('../observability/security-signals');
    securitySignals.reset();

    // Direction 1: legacy ALLOW vs resolver DENY
    const allowPrisma = prismaWith({ id: 'mem_1', role: 'OWNER', permissionScopes: null, maxApprovalTier: 0 });
    const denyResolver = {
      resolve: vi.fn(async () => ({
        modules: { operations: { module: 'operations', level: 'none', reason: 'explicit_deny', explicitDeny: true, sources: [] } },
        positions: [],
        validity: { truncated: false },
      })),
    } as unknown as EffectiveAuthorityResolver;

    const warnAllow = vi.fn();
    const allowGuard = new ModuleScopeGuard(allowPrisma, new Reflector(), denyResolver);
    (allowGuard as any).logger = { warn: warnAllow, debug: vi.fn(), error: vi.fn() };

    const rAllow = await run(allowGuard, Shadowed.prototype.handler);
    expect(rAllow.allowed).toBe(true);
    expect(warnAllow).toHaveBeenCalledTimes(1);

    const snap1 = securitySignals.snapshot();
    expect(snap1.counts.authority_shadow_mismatch).toBe(1);
    expect(snap1.byLabel.authority_shadow_mismatch['operations:explicit_deny']).toBe(1);

    // Direction 2: legacy DENY vs resolver ALLOW
    const denyPrisma = prismaWith({ id: 'mem_2', role: 'STAFF', permissionScopes: {}, maxApprovalTier: 0 });
    const allowResolver = {
      resolve: vi.fn(async () => ({
        modules: { operations: { module: 'operations', level: 'admin', reason: 'role_default', explicitDeny: false, sources: [] } },
        positions: [],
        validity: { truncated: false },
      })),
    } as unknown as EffectiveAuthorityResolver;

    const warnDeny = vi.fn();
    const denyGuard = new ModuleScopeGuard(denyPrisma, new Reflector(), allowResolver);
    (denyGuard as any).logger = { warn: warnDeny, debug: vi.fn(), error: vi.fn() };

    const rDeny = await run(denyGuard, Shadowed.prototype.handler);
    expect(rDeny.allowed).toBe(false);
    expect(rDeny.error).toBeInstanceOf(ForbiddenException);
    expect(warnDeny).toHaveBeenCalledTimes(1);

    const snap2 = securitySignals.snapshot();
    expect(snap2.counts.authority_shadow_mismatch).toBe(2);
    expect(snap2.byLabel.authority_shadow_mismatch['operations:explicit_deny']).toBe(1);
    expect(snap2.byLabel.authority_shadow_mismatch['operations:role_default']).toBe(1);

    const serialized = JSON.stringify(snap2);
    expect(serialized).not.toContain(BUSINESS);
    expect(serialized).not.toContain('user_1');
    expect(serialized).not.toContain('mem_1');
    expect(serialized).not.toContain('mem_2');
  });

  it('does not increment authority_shadow_mismatch when legacy and resolver agree', async () => {
    const { securitySignals } = await import('../observability/security-signals');
    securitySignals.reset();

    const prisma = prismaWith({ id: 'mem_1', role: 'OWNER', permissionScopes: null, maxApprovalTier: 0 });
    const warn = vi.fn();
    const guard = new ModuleScopeGuard(prisma, new Reflector(), new EffectiveAuthorityResolver(prisma));
    (guard as any).logger = { warn, debug: vi.fn(), error: vi.fn() };

    const r = await run(guard, Shadowed.prototype.handler);

    expect(r.allowed).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    expect(securitySignals.snapshot().counts.authority_shadow_mismatch).toBe(0);
  });
});

describe('the shadowed family is exactly one controller', () => {
  it('opts in only through AiSettingsController', async () => {
    const { execSync } = await import('node:child_process');
    const path = await import('node:path');
    const src = path.resolve(__dirname, '../..');
    const files = execSync(
      `grep -rl "@ShadowEffectiveAuthority()" ${src} --include=*.ts | grep -v module-scope.guard.ts | grep -v authority-shadow.spec.ts || true`,
      { encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
      .map((f) => path.basename(f));

    // Keeps the selected shadow family from creeping outward without a decision.
    expect(files).toEqual(['ai-settings.controller.ts']);
  });
});
