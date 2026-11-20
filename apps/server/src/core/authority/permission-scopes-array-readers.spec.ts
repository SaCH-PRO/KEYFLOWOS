/**
 * TOF-GRAPH-SCOPE-ARRAY review repair (SEC-TGSA-1, COR-TOFGSA-1; owner rulings D-71, D-114, D-140): no reader of a
 * membership's permissionScopes reads a stored JSON array as "use the role's defaults".
 *
 * permissionScopes is a Json column, and the owner's team route stores an array without complaint
 * (PATCH identity/businesses/:businessId/team/:memberId/permissions { scopes: [] }: validateScopesPayload walks
 * Object.entries([]), which is empty). ModuleScopeGuard (memberModuleLevel, since the PR195 port's review
 * SEC-P195-2) reads any non-null object, an ARRAY INCLUDED, as an explicit map in which every module is absent
 * (none), so it refuses such a member every module route. The packet moved KEY's graph actions to that rule; the
 * review found the KEY cortex readers still testing `typeof === 'object' && !Array.isArray(...)` and falling back to
 * the role's defaults for an array:
 *   - KeyCortexPlannerService.assertMemberSteps and assertRevenueWrite (POST api/v1/cortex/plans/:planId/execute):
 *     an ADMIN stored as [] ran a plan's money steps, invoice writes included, and a STAFF member stored as [] ran
 *     expenses and analytics reads;
 *   - CortexMemberAuthorityGuard (POST api/v1/cortex/execute, POST api/v1/cortex/query) and
 *     KeyCortexQueryPipelineService.memberAuthority (the KEY chat's commands): the same members' direct commands;
 *   - KeyInboxController.requireModuleScope and ProjectsService.assertMayGovernPlans, which read the same way.
 * Each now reads memberScopeMap (module-vocabulary.ts): the explicit map ModuleScopeGuard reads, an array as the
 * empty map, else the role's defaults. The real-DB proof over the HTTP routes is in
 * test/owner-role-key.integration.test.ts (TOF-GRAPH-SCOPE-ARRAY review repair section).
 *
 * The census below scans every source file, so a reader added later with the old predicate is caught here.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import * as vocabulary from './module-vocabulary';

const SRC = path.resolve(__dirname, '../..');

/** Every .ts source file under src (tests excluded). */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      out.push(...sourceFiles(full));
    } else if (name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * A reader that refuses an array the explicit-map arm (`!Array.isArray(x)`) and falls back to the role's defaults
 * in the same expression (within a few lines): it reads a stored array as the role's defaults.
 */
const ARRAY_READ_AS_DEFAULTS = /!\s*Array\.isArray\([^)]*\)[\s\S]{0,240}?defaultScopesForRole\(/g;
/** isJsonObject (an array excluded) asked of a stored permissionScopes. */
const JSON_OBJECT_SCOPES = /isJsonObject\(\s*[\w.]*permissionScopes\s*\)/g;

function offenders(pattern: RegExp): string[] {
  const found: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(pattern)) {
      const line = text.slice(0, match.index ?? 0).split('\n').length;
      found.push(`${path.relative(SRC, file)}:${line}`);
    }
  }
  return found.sort();
}

describe('census: no reader of permissionScopes reads a stored array as the role defaults', () => {
  it('self-check: the census pattern catches the reader shape it is for, and not ModuleScopeGuard\'s own reading', () => {
    const before =
      "const scopes = explicit && typeof explicit === 'object' && !Array.isArray(explicit)\n" +
      '  ? (explicit as Record<string, string>)\n' +
      '  : defaultScopesForRole(membership.role);';
    const nullArm =
      "const explicitScopes = explicit && typeof explicit === 'object' && !Array.isArray(explicit) ? (explicit as Record<string, string>) : null;\n" +
      'const scopes = explicitScopes ?? defaultScopesForRole(membership.role);';
    const guardReading =
      "stored && typeof stored === 'object' ? (Array.isArray(stored) ? {} : (stored as Record<string, unknown>)) : defaultScopesForRole(membership.role);";
    expect(before.match(ARRAY_READ_AS_DEFAULTS)).toHaveLength(1);
    expect(nullArm.match(ARRAY_READ_AS_DEFAULTS)).toHaveLength(1);
    expect(guardReading.match(ARRAY_READ_AS_DEFAULTS)).toBeNull();
    expect('isJsonObject(membership.permissionScopes)'.match(JSON_OBJECT_SCOPES)).toHaveLength(1);
  });

  it('RED-BEFORE: no source file reads a stored array as the role defaults (the KEY cortex planner, CortexMemberAuthorityGuard, the KEY chat, the KEY inbox and the projects plan door did)', () => {
    expect(offenders(ARRAY_READ_AS_DEFAULTS)).toEqual([]);
  });

  it('no source file asks isJsonObject (an array excluded) of a stored permissionScopes', () => {
    expect(offenders(JSON_OBJECT_SCOPES)).toEqual([]);
  });
});

describe('memberScopeMap / explicitScopeMap (module-vocabulary): the whole map ModuleScopeGuard reads', () => {
  const explicitScopeMap = (value: unknown) => (vocabulary as any).explicitScopeMap(value) as Record<string, string> | null;
  const memberScopeMap = (m: { role: string; permissionScopes: unknown }) => (vocabulary as any).memberScopeMap(m) as Record<string, string>;

  it('RED-BEFORE: a stored array, empty or not, is the explicit map that names no module; an object map is itself; nothing stored is no explicit map', () => {
    expect(explicitScopeMap([])).toEqual({});
    expect(explicitScopeMap(['revenue', 'operations'])).toEqual({});
    expect(explicitScopeMap([{ revenue: 'admin' }])).toEqual({});
    const map = { revenue: 'read' };
    expect(explicitScopeMap(map)).toBe(map);
    expect(explicitScopeMap({})).toEqual({});
    for (const v of [null, undefined, 'admin', '', 0, true]) expect(explicitScopeMap(v), JSON.stringify(v) ?? 'undefined').toBeNull();
  });

  it('RED-BEFORE: memberScopeMap is the explicit map when one is stored (an ADMIN or OWNER stored as [] holds no module), else the role defaults', () => {
    expect(memberScopeMap({ role: 'ADMIN', permissionScopes: [] })).toEqual({});
    expect(memberScopeMap({ role: 'OWNER', permissionScopes: [] })).toEqual({});
    expect(memberScopeMap({ role: 'STAFF', permissionScopes: { revenue: 'read' } })).toEqual({ revenue: 'read' });
    expect(memberScopeMap({ role: 'STAFF', permissionScopes: null })).toEqual(vocabulary.defaultScopesForRole('STAFF'));
    expect(memberScopeMap({ role: 'ADMIN', permissionScopes: null })).toEqual(vocabulary.defaultScopesForRole('ADMIN'));
  });

  it('RED-BEFORE (agreement): for every stored shape and role, memberScopeMap names each module at the level ModuleScopeGuard reads (memberModuleLevel)', () => {
    const shapes: unknown[] = [[], ['revenue'], [{ revenue: 'admin' }], {}, { revenue: 'read', crm: 'write' }, { revenue: 'none' }, null, undefined, 'admin', 0];
    for (const role of ['OWNER', 'ADMIN', 'STAFF', 'SOMETHING_ELSE']) {
      for (const permissionScopes of shapes) {
        const map = memberScopeMap({ role, permissionScopes });
        for (const module of vocabulary.CANONICAL_MODULES) {
          expect(map[module] || 'none', `${role} ${JSON.stringify(permissionScopes) ?? 'undefined'} ${module}`).toBe(
            vocabulary.memberModuleLevel({ role, permissionScopes }, module),
          );
        }
      }
    }
  });
});
