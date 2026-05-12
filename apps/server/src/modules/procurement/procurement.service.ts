import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TimelineService } from '../timeline/timeline.service';
import { CreateProcurementRequestDto } from './dto/create-procurement-request.dto';
import { UpdateProcurementRequestDto } from './dto/update-procurement-request.dto';

@Injectable()
export class ProcurementService {
  private readonly logger = new Logger(ProcurementService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TimelineService) private readonly timeline: TimelineService,
  ) {}

  async list(businessId: string) {
    return (this.prisma.client as any).procurementRequest.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(businessId: string, dto: CreateProcurementRequestDto, userId?: string) {
    // Simple AI interpretation (replace with LLM when quota available)
    const interpretedNeed = {
      category: this.inferCategory(dto.userPrompt),
      urgency: dto.priority ?? 'NORMAL',
      scope: 'business_support',
    };

    const recommendedPackages = this.generatePackages(dto.userPrompt);

    const req = await (this.prisma.client as any).procurementRequest.create({
      data: {
        businessId,
        requestedByUserId: userId ?? null,
        userPrompt: dto.userPrompt,
        interpretedNeed: interpretedNeed as any,
        recommendedPackages: recommendedPackages as any,
        priority: dto.priority,
        estimatedBudget: dto.estimatedBudget as any,
      },
    });

    // Write to unified Activity ledger (Wave 1)
    this.timeline.recordEvent({
      businessId,
      module: 'procurement',
      action: 'request.created',
      entityType: 'procurement_request',
      entityId: req.id,
      title: 'Procurement request created',
      detail: dto.userPrompt.slice(0, 200),
      category: 'SYSTEM',
      actorType: 'USER',
      actorId: userId,
      priority: dto.priority as any,
      data: { interpretedCategory: interpretedNeed.category },
      occurredAt: new Date(),
    }).catch((err) => {
      this.logger.warn(`[UnifiedLedger] failed to record procurement activity: ${(err as Error).message}`);
    });

    return req;
  }

  async get(businessId: string, id: string) {
    const req = await (this.prisma.client as any).procurementRequest.findFirst({
      where: { id, businessId },
    });
    if (!req) throw new NotFoundException('Request not found');
    return req;
  }

  async update(businessId: string, id: string, dto: UpdateProcurementRequestDto) {
    await this.get(businessId, id);
    return (this.prisma.client as any).procurementRequest.update({
      where: { id },
      data: {
        status: dto.status,
        priority: dto.priority,
        internalNotes: dto.internalNotes,
        brief: dto.brief as any,
      },
    });
  }

  async submitForReview(businessId: string, id: string) {
    const req = await this.get(businessId, id);
    const brief = this.generateBrief(req);
    const updated = await (this.prisma.client as any).procurementRequest.update({
      where: { id },
      data: {
        status: 'SUBMITTED',
        submittedAt: new Date(),
        brief: brief as any,
      },
    });

    // Write to unified Activity ledger (Wave 1)
    this.timeline.recordEvent({
      businessId,
      module: 'procurement',
      action: 'request.submitted',
      entityType: 'procurement_request',
      entityId: id,
      title: 'Procurement request submitted for review',
      detail: `Status: SUBMITTED · ${req.userPrompt.slice(0, 150)}`,
      category: 'SYSTEM',
      actorType: 'USER',
      status: 'COMPLETED',
      data: { brief },
      occurredAt: new Date(),
    }).catch((err) => {
      this.logger.warn(`[UnifiedLedger] failed to record procurement activity: ${(err as Error).message}`);
    });

    return updated;
  }

  private inferCategory(prompt: string): string {
    const p = prompt.toLowerCase();
    if (p.includes('brand')) return 'branding';
    if (p.includes('store') || p.includes('website')) return 'storefront';
    if (p.includes('crm') || p.includes('customer')) return 'crm';
    if (p.includes('booking') || p.includes('appointment')) return 'bookings';
    if (p.includes('invoice') || p.includes('payment')) return 'commerce';
    if (p.includes('price')) return 'pricing';
    if (p.includes('follow') || p.includes('lead')) return 'sales';
    if (p.includes('inventory') || p.includes('stock')) return 'inventory';
    return 'general';
  }

  private generatePackages(prompt: string): unknown[] {
    const category = this.inferCategory(prompt);
    const packages: Record<string, unknown[]> = {
      branding: [
        { name: 'Brand Identity Refresh', description: 'Logo, colors, and brand guidelines', estimatedCost: { min: 500, max: 2000 }, timeline: '2-4 weeks' },
        { name: 'Brand Strategy Session', description: 'Positioning and messaging workshop', estimatedCost: { min: 300, max: 800 }, timeline: '1 week' },
      ],
      storefront: [
        { name: 'Storefront Optimization', description: 'Layout, copy, and conversion improvements', estimatedCost: { min: 400, max: 1500 }, timeline: '1-2 weeks' },
        { name: 'Full Storefront Build', description: 'Complete redesign with SEO', estimatedCost: { min: 1000, max: 5000 }, timeline: '3-6 weeks' },
      ],
      crm: [
        { name: 'CRM Cleanup', description: 'Contact deduplication and segmentation', estimatedCost: { min: 200, max: 800 }, timeline: '3-5 days' },
        { name: 'CRM Automation Setup', description: 'Sequences and follow-up workflows', estimatedCost: { min: 500, max: 1500 }, timeline: '1-2 weeks' },
      ],
      general: [
        { name: 'Business Operations Audit', description: 'Full system review with recommendations', estimatedCost: { min: 300, max: 1000 }, timeline: '1 week' },
        { name: 'Growth Strategy Session', description: '90-day action plan', estimatedCost: { min: 400, max: 1200 }, timeline: '3-5 days' },
      ],
    };
    return packages[category] || packages.general;
  }

  private generateBrief(req: any): Record<string, unknown> {
    return {
      businessGoal: req.userPrompt,
      interpretedCategory: (req.interpretedNeed as any)?.category,
      recommendedPackages: req.recommendedPackages,
      suggestedNextStep: 'Review packages and approve preferred option',
      aiConfidence: 75,
      missingInfo: [],
    };
  }
}
