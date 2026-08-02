import { Inject, Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CrmService } from '../crm/crm.service';
import { PublicEventsService } from '../public-events/public-events.service';

export interface QualificationAnswer {
  questionId: string;
  answer: string;
  tags?: string[];
}

export interface QualificationRecommendation {
  productId: string;
  productName: string;
  score: number;
  executionModel?: string;
  price: number;
  currency: string;
  matchReasons: string[];
}

@Injectable()
export class QualificationService {
  private readonly logger = new Logger(QualificationService.name);
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CrmService) private readonly crm: CrmService,
    @Inject(PublicEventsService) private readonly publicEvents: PublicEventsService,
  ) {}

  async getQualificationConfig(businessId: string) {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { metaData: true },
    });
    const meta = (business?.metaData as Record<string, any>) ?? {};
    return meta.qualificationFlow ?? null;
  }

  async updateQualificationConfig(businessId: string, config: Record<string, any>) {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { metaData: true },
    });
    const meta = (business?.metaData as Record<string, any>) ?? {};
    const updated = { ...meta, qualificationFlow: config };
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: { metaData: updated },
    });
    return config;
  }

  async getPublicQualificationFlow(slug: string) {
    let business = await this.prisma.client.business.findFirst({
      where: { slug },
      select: { id: true, metaData: true, storeEnabled: true },
    });
    if (!business) {
      business = await this.prisma.client.business.findFirst({
        where: { id: slug },
        select: { id: true, metaData: true, storeEnabled: true },
      });
    }
    if (!business) throw new NotFoundException('Store not found');
    if (!business.storeEnabled) throw new NotFoundException('Store is currently unavailable');

    const meta = (business.metaData as Record<string, any>) ?? {};
    const flow = meta.qualificationFlow;
    if (!flow || !flow.enabled) return { enabled: false, questions: [] };

    return {
      enabled: true,
      questions: flow.questions ?? [],
      settings: {
        title: flow.title ?? 'Find Your Perfect Package',
        subtitle: flow.subtitle ?? 'Answer a few questions and we\'ll recommend the best fit for you.',
        showBudgetQuestion: flow.showBudgetQuestion ?? true,
        showUrgencyQuestion: flow.showUrgencyQuestion ?? true,
        showExecutionPreference: flow.showExecutionPreference ?? true,
      },
    };
  }

  async scoreAndRecommend(slug: string, answers: QualificationAnswer[]) {
    let business = await this.prisma.client.business.findFirst({
      where: { slug },
      select: { id: true, metaData: true },
    });
    if (!business) {
      business = await this.prisma.client.business.findFirst({
        where: { id: slug },
        select: { id: true, metaData: true },
      });
    }
    if (!business) throw new NotFoundException('Store not found');

    const meta = (business.metaData as Record<string, any>) ?? {};
    const flow = meta.qualificationFlow ?? {};
    const mappings: Record<string, any>[] = flow.packageMappings ?? [];

    const products = await this.prisma.client.product.findMany({
      where: { businessId: business.id, deletedAt: null, isActive: true },
      select: {
        id: true, name: true, price: true, currency: true, category: true,
        description: true, imageUrl: true, duration: true,
        executionModel: true, executionMeta: true,
      },
    });

    const answerMap = new Map(answers.map(a => [a.questionId, a]));
    const budgetAnswer = answerMap.get('budget');
    const urgencyAnswer = answerMap.get('urgency');
    const executionPref = answerMap.get('execution_preference');

    const scored: QualificationRecommendation[] = products.map(product => {
      let score = 50;
      const matchReasons: string[] = [];

      const productMapping = mappings.find(m => m.productId === product.id);
      if (productMapping?.answerWeights) {
        for (const [qId, weights] of Object.entries(productMapping.answerWeights as Record<string, Record<string, number>>)) {
          const answer = answerMap.get(qId);
          if (answer && weights[answer.answer]) {
            score += weights[answer.answer];
            matchReasons.push(`Matches your ${qId.replace(/_/g, ' ')} preference`);
          }
        }
      }

      if (budgetAnswer) {
        const budgetVal = parseBudgetRange(budgetAnswer.answer);
        if (budgetVal) {
          if (product.price <= budgetVal.max && product.price >= budgetVal.min) {
            score += 20;
            matchReasons.push('Within your budget range');
          } else if (product.price <= budgetVal.max * 1.2) {
            score += 5;
            matchReasons.push('Close to your budget');
          } else if (product.price > budgetVal.max * 1.5) {
            score -= 15;
          }
        }
      }

      if (executionPref && product.executionModel) {
        if (product.executionModel === executionPref.answer) {
          score += 25;
          matchReasons.push('Matches your preferred execution style');
        } else if (
          (executionPref.answer === 'HYBRID' && ['AI_ASSISTED', 'FULL_SERVICE'].includes(product.executionModel)) ||
          (executionPref.answer === 'AI_ASSISTED' && product.executionModel === 'HYBRID')
        ) {
          score += 10;
          matchReasons.push('Similar execution approach');
        }
      }

      if (urgencyAnswer?.answer === 'urgent' && product.duration && product.duration <= 60) {
        score += 10;
        matchReasons.push('Quick turnaround available');
      }

      for (const answer of answers) {
        if (answer.tags) {
          const desc = (product.description ?? '').toLowerCase();
          const name = product.name.toLowerCase();
          for (const tag of answer.tags) {
            if (desc.includes(tag.toLowerCase()) || name.includes(tag.toLowerCase())) {
              score += 5;
              matchReasons.push(`Relevant to ${tag}`);
            }
          }
        }
      }

      if (matchReasons.length === 0) {
        matchReasons.push('Available option');
      }

      return {
        productId: product.id,
        productName: product.name,
        score: Math.max(0, Math.min(100, score)),
        executionModel: product.executionModel ?? undefined,
        price: product.price,
        currency: product.currency,
        matchReasons: [...new Set(matchReasons)],
      };
    });

    scored.sort((a, b) => b.score - a.score);
    const recommendations = scored.slice(0, 3);

    const journey = await this.prisma.client.qualificationJourney.create({
      data: {
        businessId: business.id,
        // Crypto-random. The previous form was
        //   session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}
        // — a timestamp plus ~31 bits of Math.random, which is neither
        // unpredictable nor collision-safe, so it could never be used to
        // authorize access to a journey.
        sessionId: `session_${randomUUID()}`,
        answers: answers as any,
        scores: scored.slice(0, 5) as any,
        recommendedProductIds: recommendations.map(r => r.productId),
        status: 'recommended',
        source: 'guided_flow',
      },
    });

    return {
      journeyId: journey.id,
      recommendations,
      allProducts: products.map(p => ({
        id: p.id,
        name: p.name,
        price: p.price,
        currency: p.currency,
        category: p.category,
        description: p.description,
        imageUrl: p.imageUrl,
        executionModel: p.executionModel,
        executionMeta: p.executionMeta,
      })),
    };
  }

  async selectPackage(
    journeyId: string,
    productId: string,
    executionModel?: string,
    customer?: { name?: string; email?: string; visitorId?: string; referralCode?: string },
  ) {
    const journey = await this.prisma.client.qualificationJourney.findUnique({ where: { id: journeyId } });
    if (!journey) throw new NotFoundException('Journey not found');

    const updated = await this.prisma.client.qualificationJourney.update({
      where: { id: journeyId },
      data: {
        selectedProductId: productId,
        executionModelChosen: executionModel ?? null,
        customerName: customer?.name ?? journey.customerName,
        customerEmail: customer?.email ?? journey.customerEmail,
        status: 'package_selected',
      },
    });

    const customerEmail = customer?.email ?? journey.customerEmail ?? null;
    const customerName = customer?.name ?? journey.customerName ?? null;
    if (customerEmail || customerName) {
      try {
        const nameParts = (customerName ?? '').trim().split(/\s+/).filter(Boolean);
        const sourceDetail = `qualification:${journey.id}`;
        const contact = await this.crm.findOrCreateContact(journey.businessId, {
          firstName: nameParts[0] ?? null,
          lastName: nameParts.length > 1 ? nameParts.slice(1).join(' ') : null,
          email: customerEmail,
          source: 'storefront',
          sourceDetail,
          ...(customer?.referralCode ? { custom: { referralCode: customer.referralCode } } : {}),
        });
        if (contact?.id) {
          if (customer?.visitorId) {
            await this.publicEvents.backstitchVisitor({
              businessId: journey.businessId,
              visitorId: customer.visitorId,
              contactId: contact.id,
              sourceDetail,
            }).catch(() => undefined);
          }
          await this.publicEvents.logStorefrontEvent({
            businessId: journey.businessId,
            contactId: contact.id,
            type: 'quote.requested',
            sourceDetail,
            data: {
              journeyId: journey.id,
              productId,
              executionModel: executionModel ?? null,
            },
          });
        }
      } catch (err: any) {
          this.logger.warn(`Silent catch: ${err instanceof Error ? err.message : err}`);
        }
    }

    return updated;
  }

  async submitAssetIntake(journeyId: string, intakeData: Record<string, any>) {
    const journey = await this.prisma.client.qualificationJourney.findUnique({ where: { id: journeyId } });
    if (!journey) throw new NotFoundException('Journey not found');

    // Return only what the storefront renders. The full row carries
    // customerEmail, customerName, answers, scores and businessId, none of
    // which the caller needs back from an intake submission.
    return this.prisma.client.qualificationJourney.update({
      where: { id: journeyId },
      data: {
        intakeData: intakeData as any,
        intakeStatus: 'submitted',
        intakeCompleted: true,
        status: 'intake_completed',
      },
      select: {
        id: true,
        status: true,
        intakeStatus: true,
        intakeCompleted: true,
      },
    });
  }

  async getJourneyAnalytics(businessId: string) {
    const [total, byStatus, recent] = await Promise.all([
      this.prisma.client.qualificationJourney.count({ where: { businessId } }),
      this.prisma.client.qualificationJourney.groupBy({
        by: ['status'],
        where: { businessId },
        _count: true,
      }),
      this.prisma.client.qualificationJourney.findMany({
        where: { businessId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true, status: true, customerName: true, customerEmail: true,
          selectedProductId: true, executionModelChosen: true,
          intakeCompleted: true, source: true, createdAt: true,
          recommendedProductIds: true,
        },
      }),
    ]);

    const statusCounts: Record<string, number> = {};
    for (const row of byStatus) {
      statusCounts[row.status] = row._count;
    }

    const started = statusCounts['started'] ?? 0;
    const recommended = statusCounts['recommended'] ?? 0;
    const selected = statusCounts['package_selected'] ?? 0;
    const intakeComplete = statusCounts['intake_completed'] ?? 0;
    const converted = statusCounts['converted'] ?? 0;

    return {
      total,
      statusCounts,
      conversionFunnel: {
        started: started + recommended + selected + intakeComplete + converted,
        recommended: recommended + selected + intakeComplete + converted,
        packageSelected: selected + intakeComplete + converted,
        intakeCompleted: intakeComplete + converted,
        converted,
      },
      completionRate: total > 0 ? Math.round(((intakeComplete + converted) / total) * 100) : 0,
      recentJourneys: recent,
    };
  }
}

function parseBudgetRange(answer: string): { min: number; max: number } | null {
  const ranges: Record<string, { min: number; max: number }> = {
    'under_500': { min: 0, max: 500 },
    '500_1000': { min: 500, max: 1000 },
    '1000_2500': { min: 1000, max: 2500 },
    '2500_5000': { min: 2500, max: 5000 },
    '5000_plus': { min: 5000, max: 50000 },
    'flexible': { min: 0, max: 100000 },
  };
  return ranges[answer] ?? null;
}
