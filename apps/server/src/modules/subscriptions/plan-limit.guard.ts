import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SubscriptionsService } from './subscriptions.service';

export const PLAN_LIMIT_KEY = 'plan_limit_resource';

export const RequirePlanLimit = (resource: string) => SetMetadata(PLAN_LIMIT_KEY, resource);

export const PLAN_LIMIT_REPLAY_KEY = 'plan_limit_replay';

/**
 * V1-45b (D-15; V1-45 review SEC-V45-2): the route answers a request carrying
 * an Idempotency-Key with the document that key already created (a replay),
 * which is not a new use of the plan. At the limit, such a request is let
 * through with the refusal attached instead of refused here; the handler
 * throws it (deferredPlanLimitDenial) unless the key answers an existing
 * document, so nothing new is ever created past the limit.
 */
export const AllowPlanLimitReplay = () => SetMetadata(PLAN_LIMIT_REPLAY_KEY, true);

/** Where the guard leaves the refusal it deferred for the handler. */
const PLAN_LIMIT_DENIAL = Symbol('planLimitDenial');

/** The refusal the guard deferred on a keyed request at the limit, or null when the plan allowed it. */
export function deferredPlanLimitDenial(req: object): ForbiddenException | null {
  return (req as { [PLAN_LIMIT_DENIAL]?: ForbiddenException })[PLAN_LIMIT_DENIAL] ?? null;
}

function carriesIdempotencyKey(req: { headers?: Record<string, unknown> }): boolean {
  const header = req.headers?.['idempotency-key'];
  return typeof header === 'string' && header.trim().length > 0;
}

@Injectable()
export class PlanLimitGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SubscriptionsService) private readonly subscriptions: SubscriptionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const resource = this.reflector.get<string>(PLAN_LIMIT_KEY, context.getHandler());
    if (!resource) return true;

    const req = context.switchToHttp().getRequest();
    const businessId = req.params?.businessId || req.body?.businessId || req.query?.businessId;
    if (!businessId) return true;

    const result = await this.subscriptions.checkLimit(businessId, resource);

    if (!result.allowed) {
      const limitLabel = result.limit === -1 ? 'unlimited' : String(result.limit);
      const denial = new ForbiddenException({
        statusCode: 403,
        error: 'PLAN_LIMIT_REACHED',
        message: `You have reached the ${resource} limit for your current plan (${result.current}/${limitLabel}). Please upgrade to add more.`,
        resource,
        current: result.current,
        limit: result.limit,
        upgradeTo: result.upgradeTo,
      });
      if (this.reflector.get<boolean>(PLAN_LIMIT_REPLAY_KEY, context.getHandler()) && carriesIdempotencyKey(req)) {
        req[PLAN_LIMIT_DENIAL] = denial;
        return true;
      }
      throw denial;
    }

    return true;
  }
}
