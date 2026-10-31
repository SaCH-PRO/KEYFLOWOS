import { Inject, Injectable, Logger, BadRequestException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PLANS, TRIAL_DURATION_DAYS, PlanDefinition, FEATURE_REGISTRY, FEATURE_CATEGORIES, AI_OVERAGE_RATE_TTD, AI_OVERAGE_RATE_USD } from './plans';

/** The authenticated user changing a plan, as AuthMiddleware attaches it. */
export interface SubscriptionActor {
  id: string;
  role?: string;
}

/** Who may change the plan, and as what; the standing is recorded on the audit row. */
interface PlanChangeAuthority {
  actor: SubscriptionActor;
  standing: 'SUPER_ADMIN' | 'OWNER';
}

type PrismaTx = Parameters<Parameters<PrismaService['client']['$transaction']>[0]>[0];

/** The answer every member who is not the owner gets from a plan-change route (R0-08c). */
export const SUBSCRIPTION_OWNER_ONLY = 'SUBSCRIPTION_OWNER_ONLY';
export const SUBSCRIPTION_OWNER_ONLY_MESSAGE = 'Only the business owner can change the plan.';

/**
 * Prefix of the text hashed into the advisory lock key, so a business's
 * plan-change lock never shares a key with another advisory lock that hashes
 * a bare id.
 */
export const PLAN_CHANGE_LOCK_NAMESPACE = 'subscriptions:plan-change:';

/**
 * A plan change that waits on the business's lock spends that wait inside its
 * transaction, so Prisma's 5 s interactive-transaction default would turn a
 * short queue of concurrent changes into a 500. The change itself is a few
 * statements; the budget only covers the queue in front of it.
 */
const PLAN_CHANGE_TX_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

/** The subscription statuses that count as the business's live plan. */
const LIVE_STATUSES = ['ACTIVE', 'TRIALING'] as const;

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  getPlans() {
    return Object.values(PLANS);
  }

  /**
   * R0-08 / R0-08c-SUBSCRIPTION-AUTHORITY: changing the plan (trial, activate,
   * cancel, checkout, manual record-payment) is OWNER only, the rule owner
   * ruling D-11 set for the business profile. BusinessGuard admits any member,
   * and R0-08 made /app/settings/billing the one-click destination of every
   * plan-limit prompt any member sees, so a STAFF member with every scope
   * 'none' could move the tenant to the top plan or cancel it (ST-R008-1).
   *
   * The owner is the OWNER membership or the distinguished owner
   * (Business.ownerId), the two arms IdentityService.assertBusinessOwner and
   * BusinessGuard admit an owner by. SUPER_ADMIN keeps the platform bypass
   * BusinessGuard already grants. It runs before the body is read, so a refused
   * member learns nothing about plans or state. The rule is restated here rather
   * than imported: IdentityModule imports AiModule, which imports this module.
   */
  async assertPlanChangeAuthority(businessId: string, actor: SubscriptionActor | undefined): Promise<PlanChangeAuthority> {
    if (!actor?.id) throw new UnauthorizedException('Authentication required');
    if (actor.role === 'SUPER_ADMIN') return { actor, standing: 'SUPER_ADMIN' };
    const membership = await this.db.membership.findUnique({
      where: { userId_businessId: { userId: actor.id, businessId } },
      select: { role: true },
    });
    if (membership?.role === 'OWNER') return { actor, standing: 'OWNER' };
    const owned = await this.db.business.findFirst({
      where: { id: businessId, ownerId: actor.id },
      select: { id: true },
    });
    if (owned) return { actor, standing: 'OWNER' };
    throw new ForbiddenException({ code: SUBSCRIPTION_OWNER_ONLY, message: SUBSCRIPTION_OWNER_ONLY_MESSAGE });
  }

  /**
   * One team_activity_logs row per successful plan change, naming the acting
   * user: the mechanism IdentityService.logTeamActivity and the onboarding
   * completion already write. It is written in the change's own transaction,
   * so no plan change commits without its actor row.
   */
  private async auditPlanChange(
    tx: PrismaTx,
    businessId: string,
    { actor, standing }: PlanChangeAuthority,
    change: { action: string; title: string; entityId: string | null; meta: Record<string, unknown> },
  ) {
    await tx.teamActivityLog.create({
      data: {
        businessId,
        userId: actor.id,
        module: 'billing',
        action: change.action,
        entityType: 'subscription',
        entityId: change.entityId,
        title: change.title,
        meta: { ...change.meta, actorStanding: standing } as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * ST-R008c-1: every plan change runs in one transaction, and that
   * transaction first takes a transaction-scoped advisory lock keyed on the
   * business. Under READ COMMITTED alone, two concurrent changes each cancelled
   * only the rows their own snapshot saw and each added an ACTIVE row (N
   * parallel record-payments left N ACTIVE subscriptions), and a trial's
   * existing-subscription check ran outside any transaction. With the lock the
   * plan changes for one business commit one after another, and each one's
   * reads see every change committed before it, so its audit row states what it
   * really replaced. Postgres releases the lock at commit or rollback.
   */
  private planChangeTransaction<T>(businessId: string, change: (tx: PrismaTx) => Promise<T>): Promise<T> {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${PLAN_CHANGE_LOCK_NAMESPACE + businessId}))`;
      return change(tx);
    }, PLAN_CHANGE_TX_OPTIONS);
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

  async startTrial(businessId: string, actor: SubscriptionActor | undefined, planId: string, currency: string = 'TTD') {
    const authority = await this.assertPlanChangeAuthority(businessId, actor);
    const plan = PLANS[planId];
    if (!plan) throw new BadRequestException('Invalid plan');
    if (planId === 'FREE') throw new BadRequestException('Free plan does not require a trial');

    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + TRIAL_DURATION_DAYS);

    const price = currency === 'USD' ? plan.priceUSD : plan.priceTTD;

    const sub = await this.planChangeTransaction(businessId, async (tx) => {
      // Checked under the lock, so concurrent trial starts cannot all pass it.
      const existing = await tx.subscription.findFirst({
        where: {
          businessId,
          status: { in: [...LIVE_STATUSES] },
          plan: { not: 'FREE' },
        },
      });
      if (existing) throw new BadRequestException('Business already has an active subscription');

      const created = await tx.subscription.create({
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
      await this.auditPlanChange(tx, businessId, authority, {
        action: 'subscription_trial_started',
        title: `Started a ${planId} trial`,
        entityId: created.id,
        meta: { plan: planId, currency, trialEndsAt: trialEnd.toISOString() },
      });
      return created;
    });

    this.logger.log(`Started ${TRIAL_DURATION_DAYS}-day trial for business ${businessId} on ${planId} plan`);
    return sub;
  }

  /**
   * OPEN POLICY QUESTION (D-33, not decided by R0-08c): like a manual payment,
   * this activates a paid plan for whatever gateway string the owner sends,
   * with no payment verified.
   */
  async activateSubscription(
    businessId: string,
    actor: SubscriptionActor | undefined,
    planId: string,
    currency: string,
    gateway: string,
    gatewaySubId?: string,
  ) {
    const authority = await this.assertPlanChangeAuthority(businessId, actor);
    const plan = PLANS[planId];
    if (!plan) throw new BadRequestException('Invalid plan');

    const sub = await this.planChangeTransaction(businessId, async (tx) => {
      const { created, replacedIds } = await this.writeActivation(tx, businessId, plan, planId, currency, gateway, gatewaySubId);
      await this.auditPlanChange(tx, businessId, authority, {
        action: 'subscription_activated',
        title: `Activated the ${planId} plan`,
        entityId: created.id,
        meta: { plan: planId, currency, gateway, replacedSubscriptions: replacedIds.length, replacedSubscriptionIds: replacedIds },
      });
      return created;
    });

    this.logger.log(`Activated ${planId} subscription for business ${businessId} via ${gateway}`);
    return sub;
  }

  /**
   * Cancels every active and trialing subscription and creates the new ACTIVE
   * one, in the caller's plan-change transaction (which holds the business's
   * lock). Returns the ids it cancelled, for the audit row.
   */
  private async writeActivation(
    tx: PrismaTx,
    businessId: string,
    plan: PlanDefinition,
    planId: string,
    currency: string,
    gateway: string,
    gatewaySubId?: string,
  ) {
    const replacedIds = await this.cancelLiveSubscriptions(tx, businessId);

    const periodEnd = new Date();
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    const price = currency === 'USD' ? plan.priceUSD : plan.priceTTD;

    const created = await tx.subscription.create({
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
    return { created, replacedIds };
  }

  /**
   * Cancels every ACTIVE and TRIALING subscription of the business, oldest
   * first, and returns their ids. Only called under the plan-change lock, so
   * the rows read are the rows cancelled.
   */
  private async cancelLiveSubscriptions(tx: PrismaTx, businessId: string, live?: Array<{ id: string }>): Promise<string[]> {
    const rows = live ?? await tx.subscription.findMany({
      where: { businessId, status: { in: [...LIVE_STATUSES] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    const ids = rows.map((r) => r.id);
    if (ids.length > 0) {
      await tx.subscription.updateMany({
        where: { id: { in: ids }, businessId },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
    }
    return ids;
  }

  /**
   * Cancels the plan: every ACTIVE and TRIALING subscription, not only the
   * first one found, so a business left with more than one live row (the state
   * the pre-lock race left behind) reverts to Free. The audit row names the
   * newest live paid subscription and lists every id it cancelled.
   */
  async cancelSubscription(businessId: string, actor: SubscriptionActor | undefined) {
    const authority = await this.assertPlanChangeAuthority(businessId, actor);

    await this.planChangeTransaction(businessId, async (tx) => {
      const live = await tx.subscription.findMany({
        where: { businessId, status: { in: [...LIVE_STATUSES] } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, plan: true, status: true },
      });
      const sub = [...live].reverse().find((s) => s.plan !== 'FREE');
      if (!sub) throw new NotFoundException('No active subscription found');

      const cancelledIds = await this.cancelLiveSubscriptions(tx, businessId, live);
      await this.auditPlanChange(tx, businessId, authority, {
        action: 'subscription_cancelled',
        title: `Cancelled the ${sub.plan} plan`,
        entityId: sub.id,
        meta: { plan: sub.plan, previousStatus: sub.status, cancelledSubscriptionIds: cancelledIds },
      });
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

  async createCheckout(businessId: string, actor: SubscriptionActor | undefined, planId: string, currency: string, gateway: string) {
    const authority = await this.assertPlanChangeAuthority(businessId, actor);
    const plan = PLANS[planId];
    if (!plan) throw new BadRequestException('Invalid plan');
    if (planId === 'FREE') throw new BadRequestException('Free plan does not require payment');
    if (!['wipay', 'paypal', 'stripe'].includes(gateway)) throw new BadRequestException('Invalid gateway');

    const price = currency === 'USD' ? plan.priceUSD : plan.priceTTD;

    // A checkout writes nothing else; the row records who started a paid plan change.
    await this.planChangeTransaction(businessId, async (tx) => {
      await this.auditPlanChange(tx, businessId, authority, {
        action: 'subscription_checkout_started',
        title: `Started a ${planId} checkout`,
        entityId: null,
        meta: { plan: planId, currency, gateway, amount: price },
      });
    });

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

  /**
   * OPEN POLICY QUESTION (D-33, not decided by R0-08c): the owner's
   * self-declared payment activates the paid plan and is recorded COMPLETED with
   * no money moving. Whether manual recording should instead create a PENDING
   * payment that platform staff confirm is a new owner decision.
   */
  async recordManualPayment(
    businessId: string,
    actor: SubscriptionActor | undefined,
    planId: string,
    currency: string,
    method: string,
    reference?: string,
    notes?: string,
  ) {
    const authority = await this.assertPlanChangeAuthority(businessId, actor);
    const plan = PLANS[planId];
    if (!plan) throw new BadRequestException('Invalid plan');

    // The activation, its payment and one audit row commit together, under the business's plan-change lock.
    const sub = await this.planChangeTransaction(businessId, async (tx) => {
      const { created, replacedIds } = await this.writeActivation(tx, businessId, plan, planId, currency, method);
      const payment = await tx.subscriptionPayment.create({
        data: {
          subscriptionId: created.id,
          businessId,
          amount: created.priceMonthly,
          currency,
          method,
          status: 'COMPLETED',
          reference: reference || null,
          notes: notes || null,
          periodStart: created.currentPeriodStart,
          periodEnd: created.currentPeriodEnd,
        },
      });
      await this.auditPlanChange(tx, businessId, authority, {
        action: 'subscription_payment_recorded',
        title: `Recorded a manual ${method} payment for the ${planId} plan`,
        entityId: created.id,
        meta: {
          plan: planId, currency, method, amount: created.priceMonthly, paymentId: payment.id,
          replacedSubscriptions: replacedIds.length, replacedSubscriptionIds: replacedIds,
        },
      });
      return created;
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
