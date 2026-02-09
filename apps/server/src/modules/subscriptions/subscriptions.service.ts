import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PLANS, TRIAL_DURATION_DAYS, PlanDefinition } from './plans';

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

  async checkLimit(businessId: string, resource: string): Promise<{ allowed: boolean; limit: number; current: number }> {
    const { limits } = await this.getActiveSubscription(businessId);

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    switch (resource) {
      case 'contacts': {
        const count = await this.db.contact.count({ where: { businessId, deletedAt: null } });
        const limit = limits.contacts;
        return { allowed: limit === -1 || count < limit, limit, current: count };
      }
      case 'staff': {
        const count = await this.db.staffMember.count({ where: { businessId, deletedAt: null } });
        const limit = limits.staffMembers;
        return { allowed: limit === -1 || count < limit, limit, current: count };
      }
      case 'products': {
        const count = await this.db.product.count({ where: { businessId, deletedAt: null } });
        const limit = limits.products;
        return { allowed: limit === -1 || count < limit, limit, current: count };
      }
      case 'bookings': {
        const count = await this.db.booking.count({
          where: { businessId, deletedAt: null, createdAt: { gte: startOfMonth } },
        });
        const limit = limits.bookingsPerMonth;
        return { allowed: limit === -1 || count < limit, limit, current: count };
      }
      case 'invoices': {
        const count = await this.db.invoice.count({
          where: { businessId, createdAt: { gte: startOfMonth } },
        });
        const limit = limits.invoicesPerMonth;
        return { allowed: limit === -1 || count < limit, limit, current: count };
      }
      default:
        return { allowed: true, limit: -1, current: 0 };
    }
  }
}
