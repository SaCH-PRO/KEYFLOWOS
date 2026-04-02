import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PLANS, TRIAL_DURATION_DAYS, PlanDefinition, FEATURE_REGISTRY, FEATURE_CATEGORIES, AI_OVERAGE_RATE_TTD, AI_OVERAGE_RATE_USD } from './plans';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(private prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  getPlans() {
    return Object.values(PLANS);
  }

  getPlan(planId: string): PlanDefinition | null {
    return PLANS[planId] || null;
  }

  getFeatureRegistry() {
    return { features: FEATURE_REGISTRY, categories: FEATURE_CATEGORIES };
  }

  async getActiveSubscription(businessId: string) {
    const sub = await this.db.subscription.findFirst({
      where: {
        businessId,
        status: { in: ['ACTIVE', 'TRIALING'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!sub) {
      return {
        plan: 'FREE',
        status: 'ACTIVE',
        limits: PLANS.FREE.limits,
        subscription: null,
      };
    }

    if (sub.status === 'TRIALING' && sub.trialEndsAt && new Date() > sub.trialEndsAt) {
      await this.db.subscription.update({
        where: { id: sub.id },
        data: { status: 'EXPIRED' },
      });
      return {
        plan: 'FREE',
        status: 'ACTIVE',
        limits: PLANS.FREE.limits,
        subscription: null,
        trialExpired: true,
      };
    }

    const plan = PLANS[sub.plan] || PLANS.FREE;
    return {
      plan: sub.plan,
      status: sub.status,
      limits: plan.limits,
      subscription: sub,
    };
  }

  async startTrial(businessId: string, planId: string, currency: string = 'TTD') {
    const plan = PLANS[planId];
    if (!plan) throw new BadRequestException('Invalid plan');
    if (planId === 'FREE') throw new BadRequestException('Free plan does not require a trial');

    const existing = await this.db.subscription.findFirst({
      where: {
        businessId,
        status: { in: ['ACTIVE', 'TRIALING'] },
        plan: { not: 'FREE' },
      },
    });
    if (existing) throw new BadRequestException('Business already has an active subscription');

    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + TRIAL_DURATION_DAYS);

    const price = currency === 'USD' ? plan.priceUSD : plan.priceTTD;

    const sub = await this.db.subscription.create({
      data: {
        businessId,
        plan: planId,
        status: 'TRIALING',
        currency,
        priceMonthly: price,
        trialEndsAt: trialEnd,
        currentPeriodStart: new Date(),
        currentPeriodEnd: trialEnd,
      },
    });

    this.logger.log(`Started ${TRIAL_DURATION_DAYS}-day trial for business ${businessId} on ${planId} plan`);
    return sub;
  }

  async activateSubscription(
    businessId: string,
    planId: string,
    currency: string,
    gateway: string,
    gatewaySubId?: string,
  ) {
    const plan = PLANS[planId];
    if (!plan) throw new BadRequestException('Invalid plan');

    await this.db.subscription.updateMany({
      where: {
        businessId,
        status: { in: ['ACTIVE', 'TRIALING'] },
      },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });

    const periodEnd = new Date();
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    const price = currency === 'USD' ? plan.priceUSD : plan.priceTTD;

    const sub = await this.db.subscription.create({
      data: {
        businessId,
        plan: planId,
        status: 'ACTIVE',
        currency,
        priceMonthly: price,
        gateway,
        gatewaySubId: gatewaySubId || null,
        currentPeriodStart: new Date(),
        currentPeriodEnd: periodEnd,
      },
    });

    this.logger.log(`Activated ${planId} subscription for business ${businessId} via ${gateway}`);
    return sub;
  }

  async cancelSubscription(businessId: string) {
    const sub = await this.db.subscription.findFirst({
      where: {
        businessId,
        status: { in: ['ACTIVE', 'TRIALING'] },
        plan: { not: 'FREE' },
      },
    });
    if (!sub) throw new NotFoundException('No active subscription found');

    await this.db.subscription.update({
      where: { id: sub.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });

    this.logger.log(`Cancelled subscription for business ${businessId}`);
    return { message: 'Subscription cancelled. You will revert to the Free plan.' };
  }

  async getSubscriptionHistory(businessId: string) {
    return this.db.subscription.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  async checkLimit(businessId: string, resource: string): Promise<{ allowed: boolean; limit: number; current: number; upgradeTo: string }> {
    const { plan, limits } = await this.getActiveSubscription(businessId);
    const upgradeTo = plan === 'FREE' ? 'FLOW' : plan === 'FLOW' ? 'KEYFLOW' : 'KEYFLOW';

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    switch (resource) {
      case 'contacts': {
        const count = await this.db.contact.count({ where: { businessId, deletedAt: null } });
        const limit = limits.contacts;
        return { allowed: limit === -1 || count < limit, limit, current: count, upgradeTo };
      }
      case 'staff': {
        const count = await this.db.staffMember.count({ where: { businessId, deletedAt: null } });
        const limit = limits.staffMembers;
        return { allowed: limit === -1 || count < limit, limit, current: count, upgradeTo };
      }
      case 'products': {
        const count = await this.db.product.count({ where: { businessId, deletedAt: null } });
        const limit = limits.products;
        return { allowed: limit === -1 || count < limit, limit, current: count, upgradeTo };
      }
      case 'bookings': {
        const count = await this.db.booking.count({
          where: { businessId, deletedAt: null, createdAt: { gte: startOfMonth } },
        });
        const limit = limits.bookingsPerMonth;
        return { allowed: limit === -1 || count < limit, limit, current: count, upgradeTo };
      }
      case 'invoices': {
        const count = await this.db.invoice.count({
          where: { businessId, createdAt: { gte: startOfMonth } },
        });
        const limit = limits.invoicesPerMonth;
        return { allowed: limit === -1 || count < limit, limit, current: count, upgradeTo };
      }
      case 'marketplace_listings': {
        const count = await this.db.marketplaceListing.count({ where: { businessId } });
        const limit = (limits as any).marketplaceListings ?? 0;
        return { allowed: limit === -1 || count < limit, limit, current: count, upgradeTo };
      }
      case 'warehouses': {
        const count = await this.db.warehouse.count({ where: { businessId } });
        const limit = (limits as any).warehouses ?? 0;
        return { allowed: limit === -1 || count < limit, limit, current: count, upgradeTo };
      }
      case 'automations': {
        const count = await this.db.automation.count({ where: { businessId } });
        const limit = limits.automations;
        return { allowed: limit === -1 || count < limit, limit, current: count, upgradeTo };
      }
      case 'social_posts': {
        const count = await this.db.socialPost.count({
          where: { businessId, createdAt: { gte: startOfMonth } },
        });
        const limit = limits.socialPosts;
        return { allowed: limit === -1 || count < limit, limit, current: count, upgradeTo };
      }
      case 'email_campaigns': {
        const count = await this.db.emailCampaign.count({
          where: { businessId, createdAt: { gte: startOfMonth } },
        });
        const limit = (limits as any).emailCampaigns ?? 0;
        return { allowed: limit === -1 || count < limit, limit, current: count, upgradeTo };
      }
      case 'lead_forms': {
        const count = await this.db.leadForm.count({ where: { businessId } });
        const limit = (limits as any).leadForms ?? 1;
        return { allowed: limit === -1 || count < limit, limit, current: count, upgradeTo };
      }
      case 'expenses': {
        const count = await this.db.expense.count({
          where: { businessId, createdAt: { gte: startOfMonth } },
        });
        const limit = (limits as any).expenses ?? 10;
        return { allowed: limit === -1 || count < limit, limit, current: count, upgradeTo };
      }
      case 'webhooks': {
        const count = await this.db.webhook.count({ where: { businessId } });
        const limit = (limits as any).webhooks ?? 0;
        return { allowed: limit === -1 || count < limit, limit, current: count, upgradeTo };
      }
      case 'reports': {
        const count = await this.db.aiUsageLog.count({
          where: { businessId, feature: 'report_narrative', createdAt: { gte: startOfMonth } },
        });
        const limit = (limits as any).reports ?? 2;
        return { allowed: limit === -1 || count < limit, limit, current: count, upgradeTo };
      }
      default:
        return { allowed: true, limit: -1, current: 0, upgradeTo };
    }
  }

  async createCheckout(businessId: string, planId: string, currency: string, gateway: string) {
    const plan = PLANS[planId];
    if (!plan) throw new BadRequestException('Invalid plan');
    if (planId === 'FREE') throw new BadRequestException('Free plan does not require payment');
    if (!['wipay', 'paypal'].includes(gateway)) throw new BadRequestException('Invalid gateway');

    const price = currency === 'USD' ? plan.priceUSD : plan.priceTTD;

    return {
      plan: planId,
      planName: plan.name,
      amount: price,
      currency,
      gateway,
      description: `${plan.name} Plan - Monthly Subscription`,
      checkoutReady: true,
    };
  }

  async recordManualPayment(
    businessId: string,
    planId: string,
    currency: string,
    method: string,
    reference?: string,
    notes?: string,
  ) {
    const plan = PLANS[planId];
    if (!plan) throw new BadRequestException('Invalid plan');

    const sub = await this.activateSubscription(businessId, planId, currency, method);

    await this.db.subscriptionPayment.create({
      data: {
        subscriptionId: sub.id,
        businessId,
        amount: sub.priceMonthly,
        currency,
        method,
        status: 'COMPLETED',
        reference: reference || null,
        notes: notes || null,
        periodStart: sub.currentPeriodStart,
        periodEnd: sub.currentPeriodEnd,
      },
    });

    this.logger.log(`Recorded manual ${method} payment for business ${businessId} on ${planId} plan`);
    return sub;
  }

  async getPaymentHistory(businessId: string) {
    return this.db.subscriptionPayment.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        subscription: {
          select: { plan: true, status: true },
        },
      },
    });
  }

  async getBillingDashboard(businessId: string) {
    const subInfo = await this.getActiveSubscription(businessId);
    const plan = PLANS[subInfo.plan] || PLANS.FREE;
    const currency = subInfo.subscription?.currency || 'TTD';

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const endOfMonth = new Date(startOfMonth);
    endOfMonth.setMonth(endOfMonth.getMonth() + 1);
    endOfMonth.setMilliseconds(-1);

    const [
      contactCount, invoiceCount, bookingCount,
      staffCount, productCount, automationCount,
      socialPostCount, emailCampaignCount, leadFormCount,
      expenseCount, webhookCount, listingCount,
      warehouseCount, reportCount, aiUsageAgg, aiByFeature,
    ] = await Promise.all([
      this.db.contact.count({ where: { businessId, deletedAt: null } }),
      this.db.invoice.count({ where: { businessId, createdAt: { gte: startOfMonth } } }),
      this.db.booking.count({ where: { businessId, deletedAt: null, createdAt: { gte: startOfMonth } } }),
      this.db.staffMember.count({ where: { businessId, deletedAt: null } }),
      this.db.product.count({ where: { businessId, deletedAt: null } }),
      this.db.automation.count({ where: { businessId } }),
      this.db.socialPost.count({ where: { businessId, createdAt: { gte: startOfMonth } } }),
      this.db.emailCampaign.count({ where: { businessId, createdAt: { gte: startOfMonth } } }),
      this.db.leadForm.count({ where: { businessId } }),
      this.db.expense.count({ where: { businessId, createdAt: { gte: startOfMonth } } }),
      this.db.webhook.count({ where: { businessId } }),
      this.db.marketplaceListing.count({ where: { businessId } }),
      this.db.warehouse.count({ where: { businessId } }),
      this.db.aiUsageLog.count({
        where: { businessId, feature: 'report_narrative', createdAt: { gte: startOfMonth } },
      }),
      this.db.aiUsageLog.aggregate({
        where: { businessId, createdAt: { gte: startOfMonth } },
        _sum: { creditsUsed: true, estimatedCost: true },
      }),
      this.db.aiUsageLog.groupBy({
        by: ['feature'],
        where: { businessId, createdAt: { gte: startOfMonth } },
        _sum: { creditsUsed: true, estimatedCost: true },
        _count: true,
      }),
    ]);

    const aiCreditsUsed = aiUsageAgg._sum.creditsUsed ?? 0;
    const aiCostEstimate = aiUsageAgg._sum.estimatedCost ?? 0;
    const aiLimit = plan.limits.aiCreditsPerMonth;
    const isAiUnlimited = aiLimit === -1;
    const overageCredits = isAiUnlimited ? 0 : Math.max(0, aiCreditsUsed - aiLimit);
    const overageRate = currency === 'USD' ? AI_OVERAGE_RATE_USD : AI_OVERAGE_RATE_TTD;
    const overageCost = overageCredits * overageRate;

    const usageMap: Record<string, number> = {
      contacts: contactCount,
      invoices: invoiceCount,
      bookings: bookingCount,
      staff: staffCount,
      products: productCount,
      automations: automationCount,
      social_posts: socialPostCount,
      email_campaigns: emailCampaignCount,
      lead_forms: leadFormCount,
      expenses: expenseCount,
      webhooks: webhookCount,
      marketplace_listings: listingCount,
      warehouses: warehouseCount,
      reports: reportCount,
      ai_credits: aiCreditsUsed,
    };

    const resourceUsage = FEATURE_REGISTRY
      .filter(f => f.type === 'limit' && f.billable)
      .map(f => {
        const current = usageMap[f.key] ?? 0;
        const tierValue = f.tiers[subInfo.plan as keyof typeof f.tiers];
        const limit = tierValue === 'Unlimited' ? -1 : (typeof tierValue === 'number' ? tierValue : 0);
        const isUnlimited = limit === -1;
        const percent = isUnlimited ? 0 : (limit > 0 ? Math.min(100, Math.round((current / limit) * 100)) : 0);

        const nextTier = subInfo.plan === 'FREE' ? 'FLOW' : (subInfo.plan === 'FLOW' ? 'KEYFLOW' : null);
        let upgradeTo: string | null = null;
        if (nextTier) {
          const nextTierValue = f.tiers[nextTier as keyof typeof f.tiers];
          if (nextTierValue === 'Unlimited' || (typeof nextTierValue === 'number' && nextTierValue > (typeof tierValue === 'number' ? tierValue : 0))) {
            upgradeTo = nextTier;
          }
        }

        return {
          key: f.key,
          label: f.label,
          description: f.description,
          category: f.category,
          current,
          limit,
          isUnlimited,
          percent,
          atLimit: !isUnlimited && limit > 0 && current >= limit,
          nearLimit: !isUnlimited && limit > 0 && percent >= 80,
          upgradeTo,
        };
      });

    const featureAccess = FEATURE_REGISTRY
      .filter(f => f.type === 'boolean')
      .map(f => {
        const hasAccess = f.tiers[subInfo.plan as keyof typeof f.tiers];
        return {
          key: f.key,
          label: f.label,
          description: f.description,
          category: f.category,
          hasAccess: !!hasAccess,
          availableFrom: !f.tiers.FREE && f.tiers.FLOW ? 'FLOW' : (!f.tiers.FREE && !f.tiers.FLOW ? 'KEYFLOW' : 'FREE'),
        };
      });

    const featureMatrix = FEATURE_REGISTRY.map(f => ({
      key: f.key,
      label: f.label,
      description: f.description,
      category: f.category,
      type: f.type,
      FREE: f.tiers.FREE,
      FLOW: f.tiers.FLOW,
      KEYFLOW: f.tiers.KEYFLOW,
    }));

    const subscriptionCost = subInfo.subscription?.priceMonthly ?? 0;
    const totalMonthlyCost = subscriptionCost + overageCost;

    const breakdown: { item: string; amount: number; type: 'subscription' | 'overage' }[] = [
      { item: `${plan.name} Plan (${currency === 'USD' ? 'US' : 'TT'}$${subscriptionCost}/mo)`, amount: subscriptionCost, type: 'subscription' },
    ];
    if (overageCost > 0) {
      breakdown.push({ item: `AI Overage (${overageCredits} extra credits)`, amount: overageCost, type: 'overage' });
    }

    const aiUsageByFeature = aiByFeature.map(f => ({
      feature: f.feature,
      credits: f._sum.creditsUsed ?? 0,
      calls: f._count,
      cost: Math.round((f._sum.estimatedCost ?? 0) * 100) / 100,
    }));

    return {
      plan: {
        id: subInfo.plan,
        name: plan.name,
        tagline: plan.tagline,
        status: subInfo.status,
        trialExpired: (subInfo as any).trialExpired || false,
        subscription: subInfo.subscription ? {
          id: subInfo.subscription.id,
          currency,
          priceMonthly: subscriptionCost,
          trialEndsAt: subInfo.subscription.trialEndsAt,
          currentPeriodEnd: subInfo.subscription.currentPeriodEnd,
          gateway: subInfo.subscription.gateway,
          createdAt: subInfo.subscription.createdAt,
        } : null,
      },
      billing: {
        totalMonthlyCost,
        currency,
        breakdown,
        periodStart: startOfMonth,
        periodEnd: endOfMonth,
        nextBillingDate: subInfo.subscription?.currentPeriodEnd || null,
      },
      aiUsage: {
        creditsUsed: aiCreditsUsed,
        creditsLimit: aiLimit,
        creditsRemaining: isAiUnlimited ? -1 : Math.max(0, aiLimit - aiCreditsUsed),
        isUnlimited: isAiUnlimited,
        overageCredits,
        overageCost: Math.round(overageCost * 100) / 100,
        overageCurrency: currency,
        estimatedApiCost: Math.round(aiCostEstimate * 10000) / 10000,
        byFeature: aiUsageByFeature,
      },
      resourceUsage,
      featureAccess,
      featureMatrix,
      categories: FEATURE_CATEGORIES,
    };
  }
}
