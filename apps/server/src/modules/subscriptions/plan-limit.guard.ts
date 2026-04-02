import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SubscriptionsService } from './subscriptions.service';

export const PLAN_LIMIT_KEY = 'plan_limit_resource';

export const RequirePlanLimit = (resource: string) => SetMetadata(PLAN_LIMIT_KEY, resource);

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
    const businessId = req.params?.businessId || req.body?.businessId;
    if (!businessId) return true;

    const result = await this.subscriptions.checkLimit(businessId, resource);

    if (!result.allowed) {
      const limitLabel = result.limit === -1 ? 'unlimited' : String(result.limit);
      throw new ForbiddenException({
        statusCode: 403,
        error: 'PLAN_LIMIT_REACHED',
        message: `You have reached the ${resource} limit for your current plan (${result.current}/${limitLabel}). Please upgrade to add more.`,
        resource,
        current: result.current,
        limit: result.limit,
        upgradeTo: result.upgradeTo,
      });
    }

    return true;
  }
}
