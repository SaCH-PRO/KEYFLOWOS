import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class GuidanceAssessmentService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getAssessment(businessId: string) {
    const profile = await this.prisma.client.businessGuidanceProfile.findUnique({
      where: { businessId },
    });

    if (!profile) {
      throw new NotFoundException('Guidance profile not found.');
    }

    const latest = await this.prisma.client.assessmentResult.findFirst({
      where: { guidanceProfileId: profile.id },
      orderBy: { createdAt: 'desc' },
    });

    return { assessment: latest ?? null, profileStatus: profile.status };
  }

  async getDashboard(businessId: string) {
    const profile = await this.prisma.client.businessGuidanceProfile.findUnique({
      where: { businessId },
      include: {
        assessmentResults: { orderBy: { createdAt: 'desc' }, take: 1 },
        recommendations: { where: { status: { not: 'DISMISSED' } }, orderBy: { priority: 'desc' }, take: 5 },
        roadmapItems: { where: { status: { not: 'SKIPPED' } }, orderBy: { sequenceOrder: 'asc' }, take: 5 },
        progressSnapshots: { orderBy: { snapshotDate: 'desc' }, take: 10 },
      },
    });

    if (!profile) {
      throw new NotFoundException('Guidance profile not found.');
    }

    return {
      status: profile.status,
      latestAssessment: profile.assessmentResults[0] ?? null,
      topRecommendations: profile.recommendations,
      nextRoadmapItems: profile.roadmapItems,
      progressHistory: profile.progressSnapshots,
    };
  }

  async getProgress(businessId: string) {
    const profile = await this.prisma.client.businessGuidanceProfile.findUnique({
      where: { businessId },
    });

    if (!profile) {
      throw new NotFoundException('Guidance profile not found.');
    }

    const snapshots = await this.prisma.client.progressSnapshot.findMany({
      where: { guidanceProfileId: profile.id },
      orderBy: { snapshotDate: 'desc' },
      take: 30,
    });

    const [recommendations, roadmapItems] = await Promise.all([
      this.prisma.client.guidanceRecommendation.groupBy({
        by: ['status'],
        where: { guidanceProfileId: profile.id },
        _count: true,
      }),
      this.prisma.client.roadmapItem.groupBy({
        by: ['status'],
        where: { guidanceProfileId: profile.id },
        _count: true,
      }),
    ]);

    return {
      snapshots,
      recommendationsByStatus: recommendations.map((r) => ({ status: r.status, count: r._count })),
      roadmapByStatus: roadmapItems.map((r) => ({ status: r.status, count: r._count })),
    };
  }
}
