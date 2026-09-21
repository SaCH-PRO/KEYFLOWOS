import { Global, Module } from '@nestjs/common';
import { EffectiveAuthorityResolver } from './effective-authority.resolver';

/**
 * Global, for the same reason PrismaModule is.
 *
 * The resolver is consumed by ModuleScopeGuard, which is applied via `@UseGuards` in
 * 35 controllers across as many modules. Nest resolves guard dependencies from the
 * module the guard is USED in, so a non-global provider would mean adding an import to
 * every one of those modules — and every future one, silently breaking at runtime when
 * somebody forgets. A binding law for this packet is "do not create route-local bespoke
 * resolvers per controller"; making the one resolver awkward to reach is how that
 * happens anyway.
 */
@Global()
@Module({
  providers: [EffectiveAuthorityResolver],
  exports: [EffectiveAuthorityResolver],
})
export class AuthorityModule {}

/**
 * `AuthorityInventoryService` is deliberately NOT provided here.
 *
 * It is an operator tool with no request path: nothing injects it, no decorator drives
 * it, and registering it would have Nest construct it on every boot for nobody — the
 * exact shape `unreachable-provider.spec.ts` exists to catch. It is a plain class,
 * constructed directly by `scripts/authority-inventory.ts` and by its tests, which is
 * the same arrangement KF-EXEC-TENANT-001 used for FoundingMembershipService.
 */
