import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BusinessGuard implements CanActivate {
  private readonly logger = new Logger(BusinessGuard.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest() as any;
    const user = req.user as { id?: string; role?: string } | undefined;
    if (!user?.id) {
      throw new UnauthorizedException('Authentication required');
    }

    if (user.role === 'SUPER_ADMIN') {
      return true;
    }

    const businessId = req.params?.businessId || req.body?.businessId;
    this.logger.debug(`BusinessGuard checking businessId: ${businessId} for userId: ${user.id}`);
    if (!businessId) {
      throw new ForbiddenException('businessId is required');
    }

    if (!this.prisma?.client) {
      this.logger.error('PrismaService not available, rejecting request');
      throw new ForbiddenException('Service unavailable');
    }

    try {
      const business = await this.prisma.client.business.findFirst({
        where: {
          id: businessId,
          OR: [
            { ownerId: user.id },
            { members: { some: { userId: user.id } } },
          ],
        },
      });

      if (!business) {
        throw new ForbiddenException('No access to this business');
      }
    } catch (err) {
      if (err instanceof ForbiddenException || err instanceof UnauthorizedException) {
        throw err;
      }
      this.logger.error(`BusinessGuard error: ${(err as Error).message}`);
      throw new ForbiddenException('Unable to verify business access');
    }

    return true;
  }
}
