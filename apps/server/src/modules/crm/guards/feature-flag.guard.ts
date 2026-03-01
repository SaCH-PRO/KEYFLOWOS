import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../../core/prisma/prisma.service';

export const FEATURE_FLAG_KEY = 'CRM_FEATURE_FLAG';

export type CrmFeature = 'ai_tools' | 'sequences' | 'autopilot' | 'insights';

export const RequireFeature = (...features: CrmFeature[]) =>
  SetMetadata(FEATURE_FLAG_KEY, features);

@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredFeatures = this.reflector.get<CrmFeature[]>(FEATURE_FLAG_KEY, context.getHandler());
    if (!requiredFeatures || requiredFeatures.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const businessId = req.params?.businessId;
    if (!businessId) return true;

    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { metaData: true },
    });

    if (!business) return true;

    const meta = (business.metaData as Record<string, unknown>) ?? {};
    const features = meta.features as Record<string, boolean> | undefined;

    if (!features) return true;

    for (const feature of requiredFeatures) {
      if (features[feature] === false) {
        throw new HttpException(
          { code: 'FEATURE_DISABLED', message: 'Upgrade to access this feature' },
          HttpStatus.FORBIDDEN,
        );
      }
    }

    return true;
  }
}
