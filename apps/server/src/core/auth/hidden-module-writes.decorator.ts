import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { V1HiddenModuleKey } from '@keyflow/shared';
import { isCanonicalModule, type CanonicalModule } from '../authority/module-vocabulary';
import { AuthGuard } from './auth.guard';
import { BusinessGuard } from './business.guard';
import { MODULE_SCOPE_KEY, ModuleScopeGuard, type ModuleScopeRequirement } from './module-scope.guard';

/**
 * SWP-CENSUS-HIDDEN (V1-62; owner ruling D-152, "hide"): one write gate for a controller of a module
 * v1 hides.
 *
 * WHY. Hiding a module's screens (NAV-B-HIDE) leaves its API where it was, and the REST scope census
 * (docs/reconstruction/REST-SCOPE-CENSUS-2026-11-13.md) found 296 member write routes of these
 * controllers that checked a business membership and nothing else: a STAFF member with every module
 * none created helpdesk tickets, community posts, retainers, campaigns and SOPs through them. They are
 * gated here once per controller instead of route by route.
 *
 * WHAT IT DOES. Put on a controller class as its OUTERMOST decorator (above @Controller and any
 * class-level @UseGuards, so that the class's routes and guards are already recorded when it runs):
 *
 *   @HiddenModuleWrites('helpdesk', 'operations')
 *   @Controller('helpdesk')
 *   @UseGuards(AuthGuard, BusinessGuard)
 *   export class HelpdeskController { ... }
 *
 * For every handler of the class whose verb is POST, PUT, PATCH or DELETE and whose guard chain (the
 * class's guards, then the handler's) runs AuthGuard or BusinessGuard, it
 *   - declares @RequireModuleScope(<scope>, 'write') on the handler, unless the handler declares its
 *     own scope (a handler's own declaration is its rule: settings admin on a credential write, D-181
 *     on a connector sync), and
 *   - appends ModuleScopeGuard to the handler's guards when the chain does not already run it, so it
 *     runs after AuthGuard and BusinessGuard (Nest runs the class's guards, then the handler's).
 * It does nothing else: GETs are untouched (reads are SWP-READ-SCOPE-CENSUS's), and a handler that
 * runs no member guard (a provider webhook, a public form, an OptionalAuthGuard route an anonymous
 * visitor may call) is left as it is, because there is no member whose module level could be read.
 *
 * THE TWO ARGUMENTS. `hiddenModule` names the module by its key in the one list of what v1 hides,
 * packages/shared/src/v1-modules.ts (rest-scope-census.spec.ts CEN-12 checks every key against that
 * list). `scope` is the permission scope its writes need, a canonical module key
 * (core/authority/module-vocabulary.ts): the hidden-module keys are not permission scopes (no
 * Membership.permissionScopes map holds `helpdesk`, so requiring one would refuse every member, the
 * owner included), and one hidden module can span two scopes (`connectors`: Google Drive files are
 * operations, the connection settings are settings). The list does not decide authority; this
 * decorator's second argument does.
 *
 * WHAT READS IT. ModuleScopeGuard reads the handler metadata this writes, exactly as it reads a
 * handwritten @RequireModuleScope. rest-scope-census.spec.ts reads the decorator from the source (its
 * route reader applies the rule above to a class carrying it, CEN-12 runs this function on a
 * controller of its own and compares) and census-hidden.integration.test.ts reads the metadata of the
 * real controllers. job-role-tool-families.spec.ts (a required Release 0 drift guard that derives
 * which KEY tools each module grants from handler-level @RequireModuleScope text) does not read it, so
 * KEY's tool grants are what they were: the KEY side of the hidden modules is KEY-TOOL-ALLOWLIST /
 * KEY-TOOL-DOMAIN-HIDE (recorded in the census doc).
 */
export const HIDDEN_MODULE_WRITES_KEY = 'hidden_module_writes';

export interface HiddenModuleWritesMetadata {
  hiddenModule: V1HiddenModuleKey;
  scope: CanonicalModule;
}

/** The verbs this gate covers, as the census counts write routes. */
const WRITE_METHODS: ReadonlySet<RequestMethod> = new Set([RequestMethod.POST, RequestMethod.PUT, RequestMethod.PATCH, RequestMethod.DELETE]);

/** A guard that admits only a signed-in member: the routes whose caller has a module level to read. */
const MEMBER_GUARDS: ReadonlySet<unknown> = new Set([AuthGuard, BusinessGuard]);

export function HiddenModuleWrites(hiddenModule: V1HiddenModuleKey, scope: CanonicalModule): ClassDecorator {
  if (!isCanonicalModule(scope)) {
    throw new Error(`@HiddenModuleWrites('${hiddenModule}', '${scope}'): '${scope}' is not a permission scope (core/authority/module-vocabulary.ts)`);
  }
  return (target) => {
    // @Controller has run when this runs last of the class decorators; anything else would read the
    // class before its routes and guards are recorded, and silently gate nothing.
    if (Reflect.getMetadata(PATH_METADATA, target) === undefined) {
      throw new Error(`@HiddenModuleWrites must be the outermost decorator of ${target.name}, above @Controller and @UseGuards`);
    }
    Reflect.defineMetadata(HIDDEN_MODULE_WRITES_KEY, { hiddenModule, scope } satisfies HiddenModuleWritesMetadata, target);
    const classGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, target) ?? [];
    const requirement: ModuleScopeRequirement = { module: scope, minLevel: 'write' };
    for (const name of Object.getOwnPropertyNames(target.prototype)) {
      if (name === 'constructor') continue;
      const handler = Object.getOwnPropertyDescriptor(target.prototype, name)?.value;
      if (typeof handler !== 'function' || Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
      if (!WRITE_METHODS.has(Reflect.getMetadata(METHOD_METADATA, handler))) continue;
      const methodGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, handler) ?? [];
      const chain = [...classGuards, ...methodGuards];
      if (!chain.some((guard) => MEMBER_GUARDS.has(guard))) continue;
      if (!Reflect.hasOwnMetadata(MODULE_SCOPE_KEY, handler)) Reflect.defineMetadata(MODULE_SCOPE_KEY, requirement, handler);
      if (!chain.includes(ModuleScopeGuard)) Reflect.defineMetadata(GUARDS_METADATA, [...methodGuards, ModuleScopeGuard], handler);
    }
  };
}
