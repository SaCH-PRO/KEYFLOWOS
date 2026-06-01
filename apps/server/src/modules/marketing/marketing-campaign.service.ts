import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface CampaignPlanDto {
  id: string;
  name: string;
  goal: string;
  audience: string | null;
  offer: string | null;
  channel: string | null;
  status: string;
  budget: number | null;
  expectedRevenue: number | null;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class MarketingCampaignService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(businessId: string): Promise<CampaignPlanDto[]> {
    const plans = await (this.prisma.client as any).marketingCampaignPlan.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });
    return plans.map((p: any) => this.toDto(p));
  }

  async create(businessId: string, data: { name: string; goal?: string; audience?: string; offer?: string; channel?: string; budget?: number; expectedRevenue?: number; startsAt?: string; endsAt?: string }): Promise<CampaignPlanDto> {
    const plan = await (this.prisma.client as any).marketingCampaignPlan.create({
      data: {
        businessId,
        name: data.name,
        goal: data.goal || 'GROWTH',
        audience: data.audience || null,
        offer: data.offer || null,
        channel: data.channel || null,
        status: 'DRAFT',
        budget: data.budget ?? null,
        expectedRevenue: data.expectedRevenue ?? null,
        startsAt: data.startsAt ? new Date(data.startsAt) : null,
        endsAt: data.endsAt ? new Date(data.endsAt) : null,
      },
    });
    return this.toDto(plan);
  }

  async update(businessId: string, id: string, data: Partial<{ name: string; goal: string; audience: string; offer: string; channel: string; status: string; budget: number; expectedRevenue: number; startsAt: string; endsAt: string }>): Promise<CampaignPlanDto> {
    const existing = await (this.prisma.client as any).marketingCampaignPlan.findUnique({ where: { id } });
    if (!existing || existing.businessId !== businessId) throw new Error('Not found');
    const plan = await (this.prisma.client as any).marketingCampaignPlan.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.goal !== undefined && { goal: data.goal }),
        ...(data.audience !== undefined && { audience: data.audience }),
        ...(data.offer !== undefined && { offer: data.offer }),
        ...(data.channel !== undefined && { channel: data.channel }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.budget !== undefined && { budget: data.budget }),
        ...(data.expectedRevenue !== undefined && { expectedRevenue: data.expectedRevenue }),
        ...(data.startsAt !== undefined && { startsAt: data.startsAt ? new Date(data.startsAt) : null }),
        ...(data.endsAt !== undefined && { endsAt: data.endsAt ? new Date(data.endsAt) : null }),
      },
    });
    return this.toDto(plan);
  }

  async delete(businessId: string, id: string): Promise<void> {
    const existing = await (this.prisma.client as any).marketingCampaignPlan.findUnique({ where: { id } });
    if (!existing || existing.businessId !== businessId) throw new Error('Not found');
    await (this.prisma.client as any).marketingCampaignPlan.delete({ where: { id } });
  }

  private toDto(p: any): CampaignPlanDto {
    return {
      id: p.id,
      name: p.name,
      goal: p.goal,
      audience: p.audience,
      offer: p.offer,
      channel: p.channel,
      status: p.status,
      budget: p.budget ? Number(p.budget) : null,
      expectedRevenue: p.expectedRevenue ? Number(p.expectedRevenue) : null,
      startsAt: p.startsAt ? p.startsAt.toISOString() : null,
      endsAt: p.endsAt ? p.endsAt.toISOString() : null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }
}
