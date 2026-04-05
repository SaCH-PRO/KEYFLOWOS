import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class GuidanceRecommendationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getRecommendations(businessId: string) {
    const profile = await this.prisma.client.businessGuidanceProfile.findUnique({
      where: { businessId },
    });

    if (!profile) {
      return { recommendations: [] };
    }

    const recommendations = await this.prisma.client.guidanceRecommendation.findMany({
      where: { guidanceProfileId: profile.id },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });

    return { recommendations };
  }
}
