/**
 * TOF-GRAPH-SCOPE-ARRAY (tie-off follow-up; owner rulings D-71, D-119, D-125): KEY's graph actions read a
 * membership's permissionScopes as ModuleScopeGuard reads it.
 *
 * permissionScopes is a Json column, so an array can be stored in it. ModuleScopeGuard (memberModuleLevel,
 * since the PR195 port's review SEC-P195-2 / CR-P195-2) reads any non-null object, an ARRAY INCLUDED, as an
 * explicit scope map in which every module is absent (EXPLICIT_MAP_MISSING_KEY: none), so such a member is
 * refused every module route. At the packet's base the KEY graph-action readers tested isJsonObject, which is
 * false for an array, and so read the role's defaults instead:
 *   - assertMayRunGraphAction (POST actions/.../execute, the action queue's approved steps, the plan queue and
 *     approved proposals through memberToolRunAuthority): a STAFF member stored as [] ran a revenue read (STAFF
 *     defaults: revenue read) and an ADMIN stored as [] ran anything (ADMIN defaults);
 *   - graphPlanReadScope (GET actions/.../queue, GET ai/plans, GET ai/plans/:planId, GET cortex/plans/:planId):
 *     the same member was shown the steps of every module its role's defaults read;
 *   - isExplicitScopeMap (memberToolRunAuthority's owner arm, W11A-SEAM-REPAIR): an OWNER membership stored as
 *     [] was not held to its map, so it ran every KEY organ tool, and assertMayRunGraphAction read the OWNER
 *     defaults for every mapped FLOW tool; ModuleScopeGuard refuses that OWNER every module route.
 * Now each reads memberModuleLevel's rule, and an object map is read exactly as before.
 *
 * Cases tagged RED-BEFORE fail at the packet's base (27173988). The prisma stand-in serves the membership and
 * user rows these functions read; the real-DB proof over the HTTP routes is in
 * test/owner-role-key.integration.test.ts (TOF-GRAPH-SCOPE-ARRAY section).
 */
import { describe, it, expect, vi } from 'vitest';
import { assertMayRunGraphAction, graphActionRequirement, graphPlanReadScope, isExplicitScopeMap } from './graph-actions.controller';
import { memberToolRunAuthority } from './plan-step-authority';
import { memberModuleLevel } from '../../core/authority/module-vocabulary';

const BIZ = 'tofga_biz';
/** A plain revenue read (no owner-only rule, no CRM sub-permission). */
const REVENUE_READ = 'commerce_list_invoices';
/** A plain operations write. */
const OPERATIONS_WRITE = 'helpdesk_create_ticket';
/** A KEY organ (dotted) tool the authority map maps to ai write (D-131). */
const ORGAN_AI_WRITE = 'cortex.create_task';
/** A dotted organ tool the authority map does not map (D-119: the business owner's only). */
const UNMAPPED_ORGAN = 'cortex.execute_tool';

const REVENUE_READ_NONE = 'Insufficient permissions: revenue requires read access (you have none)';
const OPERATIONS_WRITE_NONE = 'Insufficient permissions: operations requires write access (you have none)';
const OPERATIONS_WRITE_READ = 'Insufficient permissions: operations requires write access (you have read)';
const AI_WRITE_NONE = 'Insufficient permissions: ai requires write access (you have none)';

type Member = { role: string; permissionScopes: unknown };
const MEMBERS: Record<string, Member> = {
  staffEmpty: { role: 'STAFF', permissionScopes: [] },
  staffNames: { role: 'STAFF', permissionScopes: ['revenue', 'operations'] },
  adminEmpty: { role: 'ADMIN', permissionScopes: [] },
  ownerEmpty: { role: 'OWNER', permissionScopes: [] },
  // Controls: object maps and no map.
  staffMap: { role: 'STAFF', permissionScopes: { revenue: 'read', operations: 'write' } },
  staffNarrow: { role: 'STAFF', permissionScopes: { revenue: 'none', operations: 'read' } },
  staffEmptyObject: { role: 'STAFF', permissionScopes: {} },
  staffDefaults: { role: 'STAFF', permissionScopes: null },
  adminDefaults: { role: 'ADMIN', permissionScopes: null },
  ownerDefaults: { role: 'OWNER', permissionScopes: null },
  ownerAiMap: { role: 'OWNER', permissionScopes: { ai: 'write' } },
};

function prismaStandIn() {
  return {
    client: {
      membership: {
        findUnique: vi.fn(async ({ where }: any) => {
          const { userId, businessId } = where.userId_businessId;
          const m = businessId === BIZ ? MEMBERS[userId] : undefined;
          return m ? { id: `m_${userId}`, userId, businessId, role: m.role, permissionScopes: m.permissionScopes } : null;
        }),
      },
      user: { findUnique: vi.fn(async ({ where }: any) => (MEMBERS[where.id] ? { id: where.id, role: 'USER' } : null)) },
    },
  } as any;
}

/** assertMayRunGraphAction for a member's own plan step: the refusal message, or null when admitted. */
async function runRefusal(userId: string, toolName: string): Promise<string | null> {
  try {
    await assertMayRunGraphAction(prismaStandIn(), BIZ, { id: userId, role: 'USER' }, toolName, userId, { flowDispatch: true });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

describe('fixture sanity', () => {
  it('the tools carry the requirements the cases rely on', () => {
    expect(graphActionRequirement(REVENUE_READ)).toEqual({ scopes: [{ module: 'revenue', minLevel: 'read' }] });
    expect(graphActionRequirement(OPERATIONS_WRITE)).toEqual({ scopes: [{ module: 'operations', minLevel: 'write' }] });
    expect(graphActionRequirement(ORGAN_AI_WRITE)).toEqual({ scopes: [{ module: 'ai', minLevel: 'write' }] });
    expect(graphActionRequirement(UNMAPPED_ORGAN)).toBeNull();
  });

  it('ModuleScopeGuard (memberModuleLevel) reads every stored array as an explicit map with every module absent, and no map as the role defaults', () => {
    for (const id of ['staffEmpty', 'staffNames', 'adminEmpty', 'ownerEmpty']) {
      for (const module of ['revenue', 'operations', 'ai', 'crm']) expect(memberModuleLevel(MEMBERS[id], module), `${id} ${module}`).toBe('none');
    }
    expect(memberModuleLevel(MEMBERS.staffDefaults, 'revenue')).toBe('read');
    expect(memberModuleLevel(MEMBERS.adminDefaults, 'operations')).toBe('admin');
    expect(memberModuleLevel(MEMBERS.ownerDefaults, 'ai')).toBe('admin');
  });
});

describe('isExplicitScopeMap: an explicit map exactly when ModuleScopeGuard reads one', () => {
  it('RED-BEFORE: a stored JSON array, empty or not, is an explicit map (was not: isJsonObject)', () => {
    expect(isExplicitScopeMap([])).toBe(true);
    expect(isExplicitScopeMap(['revenue', 'operations'])).toBe(true);
    expect(isExplicitScopeMap([{ revenue: 'admin' }])).toBe(true);
  });

  it('control: an object map, empty or not, is explicit; null, undefined and a scalar are not', () => {
    expect(isExplicitScopeMap({})).toBe(true);
    expect(isExplicitScopeMap({ revenue: 'read' })).toBe(true);
    for (const v of [null, undefined, 'admin', '', 0, 1, true, false]) expect(isExplicitScopeMap(v), JSON.stringify(v)).toBe(false);
  });

  it('agreement: for every stored shape, isExplicitScopeMap holds exactly when memberModuleLevel does not read the role defaults', () => {
    // The OWNER defaults are admin everywhere but connect; no shape below grants revenue admin explicitly.
    const shapes: unknown[] = [[], ['revenue'], [{ revenue: 'admin' }], {}, { crm: 'read' }, { revenue: 'none' }, null, undefined, 'admin', '', 0, 1, true, false];
    for (const permissionScopes of shapes) {
      const readsDefaults = memberModuleLevel({ role: 'OWNER', permissionScopes }, 'revenue') === 'admin';
      expect(isExplicitScopeMap(permissionScopes), JSON.stringify(permissionScopes) ?? 'undefined').toBe(!readsDefaults);
    }
  });
});

describe('assertMayRunGraphAction (POST actions/.../execute, the queue\'s approved steps, the plan queue, approved proposals): a stored array binds the member as ModuleScopeGuard reads it', () => {
  it('RED-BEFORE: a STAFF member stored as [] is refused a revenue-read graph action (was admitted: the STAFF defaults read revenue)', async () => {
    expect(await runRefusal('staffEmpty', REVENUE_READ)).toBe(REVENUE_READ_NONE);
  });

  it('RED-BEFORE: a STAFF member stored as [] is refused an operations-write graph action on its explicit map, with none (was refused on the STAFF defaults: you have read)', async () => {
    expect(await runRefusal('staffEmpty', OPERATIONS_WRITE)).toBe(OPERATIONS_WRITE_NONE);
  });

  it('RED-BEFORE: a STAFF member stored as an array of module names is held to the same explicit map (an array names no level)', async () => {
    expect(await runRefusal('staffNames', REVENUE_READ)).toBe(REVENUE_READ_NONE);
    expect(await runRefusal('staffNames', OPERATIONS_WRITE)).toBe(OPERATIONS_WRITE_NONE);
  });

  it('RED-BEFORE: an ADMIN stored as [] is refused the revenue read and the operations write (was admitted: the ADMIN defaults)', async () => {
    expect(await runRefusal('adminEmpty', REVENUE_READ)).toBe(REVENUE_READ_NONE);
    expect(await runRefusal('adminEmpty', OPERATIONS_WRITE)).toBe(OPERATIONS_WRITE_NONE);
  });

  it('control (object maps unchanged): a map granting revenue read and operations write runs both; a narrower map and an empty object map are refused at their stored level', async () => {
    expect(await runRefusal('staffMap', REVENUE_READ)).toBeNull();
    expect(await runRefusal('staffMap', OPERATIONS_WRITE)).toBeNull();
    expect(await runRefusal('staffNarrow', REVENUE_READ)).toBe(REVENUE_READ_NONE);
    expect(await runRefusal('staffNarrow', OPERATIONS_WRITE)).toBe(OPERATIONS_WRITE_READ);
    expect(await runRefusal('staffEmptyObject', REVENUE_READ)).toBe(REVENUE_READ_NONE);
    expect(await runRefusal('staffEmptyObject', OPERATIONS_WRITE)).toBe(OPERATIONS_WRITE_NONE);
  });

  it('control (no map: the role defaults, unchanged): STAFF reads revenue and is refused the operations write at read; an ADMIN runs both', async () => {
    expect(await runRefusal('staffDefaults', REVENUE_READ)).toBeNull();
    expect(await runRefusal('staffDefaults', OPERATIONS_WRITE)).toBe(OPERATIONS_WRITE_READ);
    expect(await runRefusal('adminDefaults', REVENUE_READ)).toBeNull();
    expect(await runRefusal('adminDefaults', OPERATIONS_WRITE)).toBeNull();
  });
});

describe('graphPlanReadScope (GET actions/.../queue, GET ai/plans, GET ai/plans/:planId, GET cortex/plans/:planId): a stored array binds the viewer\'s step reads', () => {
  const scopeOf = (userId: string) => graphPlanReadScope(prismaStandIn(), BIZ, { id: userId, role: 'USER' });

  it('RED-BEFORE: a STAFF viewer stored as [] is shown no revenue or operations step, registry or KEY-cortex (was shown them: the STAFF defaults read both)', async () => {
    const scope = await scopeOf('staffEmpty');
    expect(scope.step(REVENUE_READ)).toBe(false);
    expect(scope.step(OPERATIONS_WRITE)).toBe(false);
    expect(scope.cortexStep('commerce')).toBe(false);
    expect(scope.cortexStep('inbox')).toBe(false);
    expect(scope.cortexStep('revenue')).toBe(false);
    expect(scope.seesEveryPlan).toBe(false);
  });

  it('RED-BEFORE: an ADMIN viewer stored as [] still sees every member\'s plans (a role rule) but none of their revenue or operations steps', async () => {
    const scope = await scopeOf('adminEmpty');
    expect(scope.seesEveryPlan).toBe(true);
    expect(scope.step(REVENUE_READ)).toBe(false);
    expect(scope.step(OPERATIONS_WRITE)).toBe(false);
    expect(scope.cortexStep('commerce')).toBe(false);
  });

  it('control (object maps and no map, unchanged): a revenue-read map shows the revenue step and not the operations one; the STAFF defaults show both', async () => {
    const narrow = await scopeOf('staffNarrow');
    expect(narrow.step(REVENUE_READ)).toBe(false);
    expect(narrow.step(OPERATIONS_WRITE)).toBe(true);
    const map = await scopeOf('staffMap');
    expect(map.step(REVENUE_READ)).toBe(true);
    expect(map.cortexStep('commerce')).toBe(true);
    const defaults = await scopeOf('staffDefaults');
    expect(defaults.step(REVENUE_READ)).toBe(true);
    expect(defaults.step(OPERATIONS_WRITE)).toBe(true);
    expect(defaults.cortexStep('commerce')).toBe(true);
  });
});

describe('memberToolRunAuthority (KEY chat\'s tool calls, the plan queue, approved proposals): an OWNER membership stored as [] is held to its explicit map', () => {
  it('RED-BEFORE: the OWNER stored as [] is refused the mapped FLOW tools and the mapped KEY organ tool, with or without the principal (was admitted: null)', async () => {
    for (const asPrincipal of [false, true]) {
      for (const [tool, refusal] of [[REVENUE_READ, REVENUE_READ_NONE], [OPERATIONS_WRITE, OPERATIONS_WRITE_NONE], [ORGAN_AI_WRITE, AI_WRITE_NONE]] as const) {
        expect(await memberToolRunAuthority(prismaStandIn(), BIZ, 'ownerEmpty', tool, { asPrincipal }), `${tool} asPrincipal ${asPrincipal}`).toEqual({ refusal, principal: false });
      }
    }
  });

  // W11-OWNER-MAP-UNMAPPED-TOOLS (owner ruling D-140): this was a D-119 control (the OWNER stored as [] ran the unmapped
  // dotted tool). D-140 binds an OWNER membership's explicit map on the unmapped tools too, an array included (the
  // explicit map naming no module, as ModuleScopeGuard and isExplicitScopeMap read it). RED at e4e3b35b: admitted (null).
  it('RED-BEFORE (D-140): the OWNER stored as [] is refused the unmapped dotted tool, with or without the principal, with the refusal naming the business owner\'s unrestricted access (was admitted: null)', async () => {
    const refusal = `Tool "${UNMAPPED_ORGAN}" needs the business owner's unrestricted access (it is mapped to no module scope), and this OWNER membership is bound by its explicit scope map (D-140)`;
    expect(await memberToolRunAuthority(prismaStandIn(), BIZ, 'ownerEmpty', UNMAPPED_ORGAN)).toEqual({ refusal, principal: false });
    expect(await memberToolRunAuthority(prismaStandIn(), BIZ, 'ownerEmpty', UNMAPPED_ORGAN, { asPrincipal: true })).toEqual({ refusal, principal: false });
    // An object map binds it the same way (ownerAiMap: ai write alone).
    expect(await memberToolRunAuthority(prismaStandIn(), BIZ, 'ownerAiMap', UNMAPPED_ORGAN)).toEqual({ refusal, principal: false });
  });

  it('control (unchanged): an OWNER with no map runs all four; an OWNER whose object map grants ai write runs the organ tool and is refused the revenue read', async () => {
    for (const tool of [REVENUE_READ, OPERATIONS_WRITE, ORGAN_AI_WRITE, UNMAPPED_ORGAN]) {
      expect(await memberToolRunAuthority(prismaStandIn(), BIZ, 'ownerDefaults', tool), tool).toEqual({ refusal: null, principal: false });
    }
    expect(await memberToolRunAuthority(prismaStandIn(), BIZ, 'ownerAiMap', ORGAN_AI_WRITE)).toEqual({ refusal: null, principal: false });
    expect(await memberToolRunAuthority(prismaStandIn(), BIZ, 'ownerAiMap', REVENUE_READ)).toEqual({ refusal: REVENUE_READ_NONE, principal: false });
  });
});

/**
 * TOF-GRAPH-SCOPE-ARRAY review repair (SEC-TGSA-3; owner rulings D-140, D-125): graphPlanReadScope returned every
 * plan, every step and every step output to any OWNER membership before it read the map, so an OWNER membership
 * with an explicit map (stored as [], or an object map a JobRole position copy can write onto it) read the steps
 * and stored outputs that assertMayRunGraphAction refuses it to run. D-140 binds such an OWNER on KEY as on REST:
 * it now reads the steps of the modules its map reads. It still sees every member's plans (PLAN_APPROVER_ROLES, a
 * role rule) and every contact (the OWNER's visibility, D-37 and D-74); an OWNER with no map reads everything.
 */
describe('graphPlanReadScope: an OWNER membership with an explicit map reads only the steps its map reads (review SEC-TGSA-3, D-140)', () => {
  const scopeOf = (userId: string) => graphPlanReadScope(prismaStandIn(), BIZ, { id: userId, role: 'USER' });

  it('RED-BEFORE: the OWNER stored as [] still sees every member\'s plans but no revenue, operations or ai step, registry or KEY-cortex (was shown every step: the OWNER arm returned before the map was read)', async () => {
    const scope = await scopeOf('ownerEmpty');
    expect(scope.seesEveryPlan).toBe(true);
    expect(scope.step(REVENUE_READ)).toBe(false);
    expect(scope.step(OPERATIONS_WRITE)).toBe(false);
    expect(scope.step(ORGAN_AI_WRITE)).toBe(false);
    expect(scope.cortexStep('commerce')).toBe(false);
    expect(scope.cortexStep('inbox')).toBe(false);
    expect(scope.cortexStep('revenue')).toBe(false);
  });

  it('RED-BEFORE: an OWNER whose object map grants ai write alone reads the ai step and not the revenue or operations step', async () => {
    const scope = await scopeOf('ownerAiMap');
    expect(scope.seesEveryPlan).toBe(true);
    expect(scope.step(ORGAN_AI_WRITE)).toBe(true);
    expect(scope.cortexStep('temporal')).toBe(true);
    expect(scope.step(REVENUE_READ)).toBe(false);
    expect(scope.step(OPERATIONS_WRITE)).toBe(false);
    expect(scope.cortexStep('commerce')).toBe(false);
  });

  it('control (the OWNER\'s contact sight is a role rule, unchanged): an OWNER with a map still sees every contact and every output of a step it reads', async () => {
    const scope = await scopeOf('ownerAiMap');
    expect(scope.seesEveryContact).toBe(true);
    expect(scope.hiddenContacts).toBeNull();
    expect(scope.stepOutput(ORGAN_AI_WRITE)).toBe(true);
  });

  it('control (unchanged): an OWNER with no map reads every step and every output, contacts included', async () => {
    const scope = await scopeOf('ownerDefaults');
    expect(scope.seesEveryPlan).toBe(true);
    for (const tool of [REVENUE_READ, OPERATIONS_WRITE, ORGAN_AI_WRITE]) expect(scope.step(tool), tool).toBe(true);
    for (const module of ['commerce', 'inbox', 'temporal', 'revenue']) expect(scope.cortexStep(module), module).toBe(true);
    expect(scope.stepOutput('crm_list_contacts')).toBe(true);
    expect(scope.seesEveryContact).toBe(true);
    expect(scope.hiddenContacts).toBeNull();
  });
});
