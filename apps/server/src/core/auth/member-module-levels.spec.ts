/**
 * NAV-A1 (re-cut v1 plan, step 3; owner rulings D-150 'hubs', D-179 'legacyaccess'): the web shows a member a hub
 * only when the member's module scopes let that hub open (journey J5: a staff member's menu shows only the hubs they
 * may open). The web cannot read a STAFF member's own scope map (GET identity/businesses/:b/team needs team read),
 * and no read route checks the storefront scope, so a probe cannot learn it either. The server therefore answers
 * the caller's own levels, one per canonical module, read exactly as ModuleScopeGuard reads them:
 *
 *   GET identity/businesses/:businessId/my-access  (AuthGuard, BusinessGuard: a member of that business only)
 *   -> { modules: { crm: 'read', revenue: 'none', ... } }
 *
 * It grants nothing: every route is still guarded on the server. It names only the caller's own levels, which a
 * caller can already learn from the guard's refusals.
 *
 *   MML-01 an explicit map: its levels, every module it does not name none (EXPLICIT_MAP_MISSING_KEY).
 *   MML-02 no explicit map: the role's defaults (STAFF: settings, team, ai none; bookings write; the rest read).
 *   MML-03 a stored array is an explicit map naming nothing: every module none (SV-4).
 *   MML-04 a value that is not a level ranks none, as the guard ranks it.
 *   MML-05 SUPER_ADMIN admin everywhere; no membership, or no actor, none everywhere.
 *   MML-06 for every module and every case above, read access by this answer is exactly what ModuleScopeGuard admits.
 *   MML-07 the route is GET businesses/:businessId/my-access behind AuthGuard and BusinessGuard.
 */
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { GUARDS_METADATA, PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { memberModuleLevels } from './member-module-level';
import { ModuleScopeGuard, MODULE_SCOPE_KEY } from './module-scope.guard';
import { CANONICAL_MODULES, LEVEL_RANK } from '../authority/module-vocabulary';
import { AuthGuard } from './auth.guard';
import { BusinessGuard } from './business.guard';
import { IdentityController } from '../../modules/identity/identity.controller';

const BIZ = 'biz_nava1_mml';
const USER = 'usr_nava1_mml';

type Membership = { role: string; permissionScopes: unknown } | null;

function prismaWith(membership: Membership) {
  return {
    client: {
      membership: {
        findUnique: async () => membership,
      },
    },
  } as never;
}

const levelsOf = (membership: Membership, actor: { id?: string; role?: string } | null = { id: USER, role: 'USER' }) =>
  memberModuleLevels(prismaWith(membership), BIZ, actor);

describe('NAV-A1: a member reads their own module levels in a business', () => {
  it('MML-01 an explicit map answers its levels, and none for every module it does not name', async () => {
    const levels = await levelsOf({ role: 'STAFF', permissionScopes: { bookings: 'read', crm: 'read' } });
    expect(Object.keys(levels).sort()).toEqual([...CANONICAL_MODULES].sort());
    expect(levels.bookings).toBe('read');
    expect(levels.crm).toBe('read');
    for (const m of CANONICAL_MODULES.filter((x) => x !== 'bookings' && x !== 'crm')) expect(levels[m], m).toBe('none');
  });

  it('MML-02 no explicit map answers the role defaults', async () => {
    const staff = await levelsOf({ role: 'STAFF', permissionScopes: null });
    expect(staff.settings).toBe('none');
    expect(staff.team).toBe('none');
    expect(staff.bookings).toBe('write');
    expect(staff.revenue).toBe('read');
    const owner = await levelsOf({ role: 'OWNER', permissionScopes: null });
    expect(owner.settings).toBe('admin');
    expect(owner.storefront).toBe('admin');
  });

  it('MML-03 a stored array names no module: every module none', async () => {
    const levels = await levelsOf({ role: 'ADMIN', permissionScopes: [] });
    for (const m of CANONICAL_MODULES) expect(levels[m], m).toBe('none');
  });

  it('MML-04 a stored value that is not a level is none', async () => {
    const levels = await levelsOf({ role: 'STAFF', permissionScopes: { crm: 'superuser', revenue: 3 } });
    expect(levels.crm).toBe('none');
    expect(levels.revenue).toBe('none');
  });

  it('MML-05 SUPER_ADMIN is admin everywhere; no membership or no actor is none everywhere', async () => {
    const sa = await levelsOf(null, { id: USER, role: 'SUPER_ADMIN' });
    for (const m of CANONICAL_MODULES) expect(sa[m], m).toBe('admin');
    const stranger = await levelsOf(null);
    for (const m of CANONICAL_MODULES) expect(stranger[m], m).toBe('none');
    const nobody = await levelsOf({ role: 'OWNER', permissionScopes: null }, null);
    for (const m of CANONICAL_MODULES) expect(nobody[m], m).toBe('none');
  });

  it('MML-06 read access by the answer is exactly what ModuleScopeGuard admits, module by module', async () => {
    const cases: Membership[] = [
      { role: 'STAFF', permissionScopes: { bookings: 'read', crm: 'read' } },
      { role: 'STAFF', permissionScopes: null },
      { role: 'ADMIN', permissionScopes: null },
      { role: 'ADMIN', permissionScopes: [] },
      { role: 'OWNER', permissionScopes: null },
      { role: 'STAFF', permissionScopes: { crm: 'superuser', revenue: 'write', analytics: 'none' } },
    ];
    for (const membership of cases) {
      const levels = await levelsOf(membership);
      for (const module of CANONICAL_MODULES) {
        const reflector = { get: (key: string) => (key === MODULE_SCOPE_KEY ? { module, minLevel: 'read' } : undefined) };
        const guard = new ModuleScopeGuard(prismaWith(membership), reflector as never);
        const context = {
          getHandler: () => ({}),
          switchToHttp: () => ({ getRequest: () => ({ user: { id: USER, role: 'USER' }, params: { businessId: BIZ } }) }),
        };
        const admitted = await guard.canActivate(context as never).then(
          () => true,
          () => false,
        );
        expect(LEVEL_RANK[levels[module]] >= LEVEL_RANK.read, `${JSON.stringify(membership)} ${module}`).toBe(admitted);
      }
    }
  });

  it('MML-07 the route is GET identity/businesses/:businessId/my-access behind AuthGuard and BusinessGuard', () => {
    const handler = (IdentityController.prototype as unknown as Record<string, unknown>).myModuleAccess as object;
    expect(handler, 'IdentityController.myModuleAccess').toBeTypeOf('function');
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('businesses/:businessId/my-access');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
    const guards = (Reflect.getMetadata(GUARDS_METADATA, handler) ?? []) as unknown[];
    expect(guards).toContain(AuthGuard);
    expect(guards).toContain(BusinessGuard);
  });
});
