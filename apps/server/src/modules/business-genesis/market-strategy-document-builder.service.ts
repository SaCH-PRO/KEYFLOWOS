import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { DocumentInstance } from '@prisma/client';
import type { MarketStrategyData, CompetitorData } from './market-strategy.repository';

interface SectionInput {
  sectionKey: string;
  sectionName: string;
  content: string;
  sortOrder: number;
}

@Injectable()
export class MarketStrategyDocumentBuilder {
  private readonly logger = new Logger(MarketStrategyDocumentBuilder.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  getInstanceId(businessId: string): string {
    return `market-strategy:${businessId}`;
  }

  async exists(businessId: string): Promise<boolean> {
    const instance = await this.prisma.client.documentInstance.findUnique({
      where: { id: this.getInstanceId(businessId) },
      select: { id: true },
    });
    return instance !== null;
  }

  async buildOrUpdate(
    businessId: string,
    strategy: MarketStrategyData,
    competitors: CompetitorData[],
  ): Promise<DocumentInstance> {
    const docType = await this.prisma.client.documentType.findUnique({
      where: { slug: 'market-strategy' },
    });
    if (!docType) {
      throw new NotFoundException('Document type market-strategy not found — run seed');
    }

    const instanceId = this.getInstanceId(businessId);
    const existing = await this.prisma.client.documentInstance.findUnique({
      where: { id: instanceId },
      select: { id: true, currentVersionNum: true },
    });

    const profileVersion = await this.getOrCreateProfileVersion(businessId);
    const sections = this.buildSections(strategy, competitors);

    if (!existing) {
      return this.prisma.client.documentInstance.create({
        data: {
          id: instanceId,
          businessId,
          documentTypeId: docType.id,
          profileVersionId: profileVersion.id,
          title: 'Market Strategy',
          status: 'DRAFT',
          healthStatus: 'CURRENT',
          currentVersionNum: 1,
          contextInputs: {},
          toneSettings: {},
          generationMeta: {
            generatedAt: new Date().toISOString(),
            sectionsGenerated: sections.length,
          },
          sections: {
            create: sections.map((s) => ({
              sectionKey: s.sectionKey,
              sectionName: s.sectionName,
              content: s.content,
              contentFormat: 'PLAIN',
              contentSource: 'AI_GENERATED',
              editableMode: 'GUIDED',
              riskScore: 'GREEN',
              sortOrder: s.sortOrder,
            })),
          },
          versions: {
            create: {
              versionNumber: 1,
              content: { sections: sections.map(({ sectionKey, sectionName, content }) => ({ sectionKey, sectionName, content })) },
              sectionSnapshots: sections.map(({ sectionKey, sectionName, content }) => ({ sectionKey, sectionName, content })),
              status: 'DRAFT',
              createdBy: 'system',
              basedOnProfile: profileVersion.versionNumber,
            },
          },
        },
      });
    }

    return this.prisma.client.$transaction(async (tx) => {
      await tx.documentSection.deleteMany({ where: { instanceId } });

      for (const s of sections) {
        await tx.documentSection.create({
          data: {
            instanceId,
            sectionKey: s.sectionKey,
            sectionName: s.sectionName,
            content: s.content,
            contentFormat: 'PLAIN',
            contentSource: 'AI_GENERATED',
            editableMode: 'GUIDED',
            riskScore: 'GREEN',
            sortOrder: s.sortOrder,
          },
        });
      }

      const nextVersion = existing.currentVersionNum + 1;
      await tx.documentVersion.create({
        data: {
          instanceId,
          versionNumber: nextVersion,
          content: { sections: sections.map(({ sectionKey, sectionName, content }) => ({ sectionKey, sectionName, content })) },
          sectionSnapshots: sections.map(({ sectionKey, sectionName, content }) => ({ sectionKey, sectionName, content })),
          status: 'DRAFT',
          createdBy: 'system',
          basedOnProfile: profileVersion.versionNumber,
        },
      });

      return tx.documentInstance.update({
        where: { id: instanceId },
        data: { currentVersionNum: nextVersion },
      });
    });
  }

  private buildSections(strategy: MarketStrategyData, competitors: CompetitorData[]): SectionInput[] {
    return [
      { sectionKey: 'swot', sectionName: 'SWOT Analysis', content: this.renderSwot(strategy.swot), sortOrder: 0 },
      { sectionKey: 'pestle', sectionName: 'PESTLE Analysis', content: this.renderPestle(strategy.pestle), sortOrder: 1 },
      { sectionKey: 'competitors', sectionName: 'Competitor Profile', content: this.renderCompetitors(competitors), sortOrder: 2 },
      { sectionKey: 'positioning', sectionName: 'Offer Positioning', content: this.renderPositioning(strategy.positioning), sortOrder: 3 },
      { sectionKey: 'launch-plan', sectionName: '90-Day Launch Plan', content: this.renderLaunchPlan(strategy.launchPlan), sortOrder: 4 },
    ];
  }

  private renderSwot(swot: MarketStrategyData['swot']): string {
    const sections = [
      { title: 'Strengths', items: swot.strengths },
      { title: 'Weaknesses', items: swot.weaknesses },
      { title: 'Opportunities', items: swot.opportunities },
      { title: 'Threats', items: swot.threats },
    ];
    return sections
      .map((s) => `## ${s.title}\n${s.items.length ? s.items.map((i) => `- ${i}`).join('\n') : '- None identified'}`)
      .join('\n\n');
  }

  private renderPestle(pestle: MarketStrategyData['pestle']): string {
    const mapping = [
      ['Political', pestle.political],
      ['Economic', pestle.economic],
      ['Social', pestle.social],
      ['Technological', pestle.technological],
      ['Legal', pestle.legal],
      ['Environmental', pestle.environmental],
    ] as const;
    return mapping.map(([title, text]) => `## ${title}\n${text || 'Not identified.'}`).join('\n\n');
  }

  private renderCompetitors(competitors: CompetitorData[]): string {
    if (!competitors.length) return 'No competitors identified.';
    return competitors
      .map((c) => {
        const lines = [`## Competitor: ${c.name}`];
        if (c.threatLevel) lines.push(`- Threat level: ${c.threatLevel}`);
        lines.push(`- Strengths: ${c.strengths.join(', ') || 'None noted'}`);
        lines.push(`- Weaknesses: ${c.weaknesses.join(', ') || 'None noted'}`);
        if (c.positioning) lines.push(`- Positioning: ${c.positioning}`);
        return lines.join('\n');
      })
      .join('\n\n');
  }

  private renderPositioning(positioning: MarketStrategyData['positioning']): string {
    const lines = [
      `## Tagline\n${positioning.tagline || 'Not set'}`,
      `## Value Proposition\n${positioning.valueProposition || 'Not set'}`,
      `## Key Messages\n${positioning.keyMessages.length ? positioning.keyMessages.map((m) => `- ${m}`).join('\n') : '- None identified'}`,
      `## Differentiators\n${positioning.differentiators.length ? positioning.differentiators.map((d) => `- ${d}`).join('\n') : '- None identified'}`,
      `## Target Segments\n${positioning.targetSegments.length ? positioning.targetSegments.map((s) => `- ${s}`).join('\n') : '- None identified'}`,
    ];
    return lines.join('\n\n');
  }

  private renderLaunchPlan(launchPlan: MarketStrategyData['launchPlan']): string {
    const lines = [`# Launch Plan\n\n${launchPlan.summary || 'No summary provided.'}`];
    if (launchPlan.phases.length) {
      for (const phase of launchPlan.phases) {
        lines.push(`\n## ${phase.name} (${phase.duration})`);
        for (const action of phase.actions) {
          lines.push(`- ${action}`);
        }
      }
    }
    return lines.join('\n');
  }

  private async getOrCreateProfileVersion(businessId: string) {
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException('Business not found');

    const latest = await this.prisma.client.businessProfileVersion.findFirst({
      where: { businessId },
      orderBy: { versionNumber: 'desc' },
    });

    const snapshot = {
      name: business.name,
      tagline: business.tagline,
      description: business.description,
      address: business.address,
      city: business.city,
      country: business.country,
      phone: business.phone,
      email: business.email,
      website: business.website,
      industry: business.industry,
      teamSize: business.teamSize,
      revenueModel: business.revenueModel,
      businessStage: business.businessStage,
      skills: business.skills,
    };

    if (latest) {
      const latestSnap = latest.snapshot as Record<string, unknown>;
      const changed = Object.keys(snapshot).filter(
        (k) => JSON.stringify(latestSnap[k]) !== JSON.stringify(snapshot[k as keyof typeof snapshot]),
      );
      if (changed.length === 0) return latest;
    }

    return this.prisma.client.businessProfileVersion.create({
      data: {
        businessId,
        versionNumber: (latest?.versionNumber ?? 0) + 1,
        snapshot,
      },
    });
  }
}
