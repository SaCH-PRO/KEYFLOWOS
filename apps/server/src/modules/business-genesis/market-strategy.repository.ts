import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { MarketStrategy, Competitor } from '@prisma/client';

export interface MarketStrategyData {
  swot: { strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[] };
  pestle: { political: string; economic: string; social: string; technological: string; legal: string; environmental: string };
  positioning: { tagline: string; valueProposition: string; keyMessages: string[]; differentiators: string[]; targetSegments: string[] };
  launchPlan: { summary: string; phases: { name: string; duration: string; actions: string[] }[] };
  analysisSummary: { marketOpportunityScore: number; keyInsight: string };
  generatedAt: string;
}

export interface CompetitorData {
  name: string;
  threatLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  strengths: string[];
  weaknesses: string[];
  positioning?: string | null;
}

@Injectable()
export class MarketStrategyRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async replaceStrategyAndCompetitors(
    businessId: string,
    data: MarketStrategyData,
    competitors: CompetitorData[],
  ): Promise<{ strategy: MarketStrategy; competitors: Competitor[] }> {
    return this.prisma.client.$transaction(async (tx) => {
      const strategy = await tx.marketStrategy.upsert({
        where: { businessId },
        create: {
          businessId,
          swot: data.swot as Record<string, unknown>,
          pestle: data.pestle as Record<string, unknown>,
          positioning: data.positioning as Record<string, unknown>,
          launchPlan: data.launchPlan as Record<string, unknown>,
          analysisSummary: data.analysisSummary as Record<string, unknown>,
          generatedAt: new Date(data.generatedAt),
        },
        update: {
          swot: data.swot as Record<string, unknown>,
          pestle: data.pestle as Record<string, unknown>,
          positioning: data.positioning as Record<string, unknown>,
          launchPlan: data.launchPlan as Record<string, unknown>,
          analysisSummary: data.analysisSummary as Record<string, unknown>,
          generatedAt: new Date(data.generatedAt),
        },
      });

      await tx.competitor.deleteMany({ where: { businessId } });

      const createdCompetitors = await tx.competitor.createManyAndReturn({
        data: competitors.map((c) => ({
          businessId,
          name: c.name,
          threatLevel: this.normalizeThreatLevel(c.threatLevel),
          strengths: c.strengths,
          weaknesses: c.weaknesses,
          positioning: c.positioning ?? null,
        })),
      });

      return { strategy, competitors: createdCompetitors };
    });
  }

  async findStrategyWithCompetitors(
    businessId: string,
  ): Promise<{ strategy: MarketStrategy | null; competitors: Competitor[] }> {
    const [strategy, competitors] = await Promise.all([
      this.prisma.client.marketStrategy.findUnique({ where: { businessId } }),
      this.prisma.client.competitor.findMany({ where: { businessId }, orderBy: { createdAt: 'asc' } }),
    ]);
    return { strategy, competitors };
  }

  private normalizeThreatLevel(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const upper = value.toUpperCase();
    if (upper === 'LOW' || upper === 'MEDIUM' || upper === 'HIGH') return upper;
    return null;
  }
}
