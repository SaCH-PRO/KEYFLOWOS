import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class GuidanceRoadmapService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getRoadmap(businessId: string) {
    const profile = await this.prisma.client.businessGuidanceProfile.findUnique({
      where: { businessId },
    });

    if (!profile) {
      return { items: [] };
    }

    const items = await this.prisma.client.roadmapItem.findMany({
      where: { guidanceProfileId: profile.id },
      orderBy: { sequenceOrder: 'asc' },
    });

    return { items };
  }
}
