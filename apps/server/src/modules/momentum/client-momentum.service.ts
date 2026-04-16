import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AutopilotService } from '../autopilot/autopilot.service';
import { AiUsageService } from '../ai/ai-usage.service';

interface ContactMomentumData {
  contactId: string;
  score: number;
  previousScore: number | null;
  trend: 'rising' | 'falling' | 'stable';
  recencyScore: number;
  frequencyScore: number;
  monetaryScore: number;
  engagementScore: number;
  tenureScore: number;
}

interface MomentumRecommendationInput {
  businessId: string;
  contactId: string;
  type: string;
  title: string;
  description: string;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  triggerReason: string;
  momentumScore: number;
  scheduledFor?: Date;
}

const BATCH_SIZE = 100;

@Injectable()
export class ClientMomentumService {
  private readonly logger = new Logger(ClientMomentumService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(forwardRef(() => AutopilotService)) private readonly autopilotService: AutopilotService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  async calculateMomentumScore(businessId: string, contactId: string): Promise<ContactMomentumData> {
    const now = new Date();

    const [contact, bookings, invoices, events, existingMomentum] = await Promise.all([
      this.db.contact.findFirst({
        where: { id: contactId, businessId, deletedAt: null },
        select: {
          id: true, createdAt: true, lastInteractionAt: true, status: true,
        },
      }),
      this.db.booking.findMany({
        where: { contactId, businessId },
        orderBy: { startTime: 'desc' },
        take: 50,
        select: { startTime: true, status: true, createdAt: true },
      }),
      this.db.invoice.findMany({
        where: { contactId, businessId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { total: true, status: true, createdAt: true, paidAt: true },
      }),
      this.db.contactEvent.findMany({
        where: { contactId, businessId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: { type: true, createdAt: true },
      }),
      this.db.contactMomentum.findUnique({
        where: { businessId_contactId: { businessId, contactId } },
        select: { score: true },
      }),
    ]);

    if (!contact) {
      return {
        contactId,
        score: 0,
        previousScore: existingMomentum?.score ?? null,
        trend: 'stable',
        recencyScore: 0,
        frequencyScore: 0,
        monetaryScore: 0,
        engagementScore: 0,
        tenureScore: 0,
      };
    }

    const recencyScore = this.calcRecencyScore(contact.lastInteractionAt, now);
    const frequencyScore = this.calcFrequencyScore(bookings, now);
    const monetaryScore = this.calcMonetaryScore(invoices);
    const engagementScore = this.calcEngagementScore(events, now);
    const tenureScore = this.calcTenureScore(contact.createdAt, now);

    const weightedScore = Math.round(
      recencyScore * 0.30 +
      frequencyScore * 0.25 +
      monetaryScore * 0.20 +
      engagementScore * 0.15 +
      tenureScore * 0.10
    );

    const score = Math.max(0, Math.min(100, weightedScore));
    const previousScore = existingMomentum?.score ?? null;

    let trend: 'rising' | 'falling' | 'stable' = 'stable';
    if (previousScore !== null) {
      const diff = score - previousScore;
      if (diff >= 5) trend = 'rising';
      else if (diff <= -5) trend = 'falling';
    }

    return {
      contactId,
      score,
      previousScore,
      trend,
      recencyScore,
      frequencyScore,
      monetaryScore,
      engagementScore,
      tenureScore,
    };
  }

  private calcRecencyScore(lastInteraction: Date | null, now: Date): number {
    if (!lastInteraction) return 0;
    const daysSince = (now.getTime() - lastInteraction.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince <= 3) return 100;
    if (daysSince <= 7) return 85;
    if (daysSince <= 14) return 70;
    if (daysSince <= 30) return 50;
    if (daysSince <= 60) return 30;
    if (daysSince <= 90) return 15;
    return 5;
  }

  private calcFrequencyScore(bookings: { startTime: Date; status: string; createdAt: Date }[], now: Date): number {
    if (bookings.length === 0) return 0;

    const recent90 = bookings.filter(b =>
      (now.getTime() - b.startTime.getTime()) < 90 * 24 * 60 * 60 * 1000
    );
    const older90 = bookings.filter(b =>
      (now.getTime() - b.startTime.getTime()) >= 90 * 24 * 60 * 60 * 1000 &&
      (now.getTime() - b.startTime.getTime()) < 180 * 24 * 60 * 60 * 1000
    );

    const recentRate = recent90.length;
    const olderRate = older90.length;

    let base = Math.min(100, recentRate * 20);

    if (recentRate > olderRate && olderRate > 0) {
      base = Math.min(100, base + 15);
    } else if (recentRate < olderRate && olderRate > 0) {
      base = Math.max(0, base - 10);
    }

    return base;
  }

  private calcMonetaryScore(invoices: { total: number; status: string; createdAt: Date; paidAt: Date | null }[]): number {
    const paidInvoices = invoices.filter(i => i.status === 'PAID');
    if (paidInvoices.length === 0) return 0;

    const totalRevenue = paidInvoices.reduce((s, i) => s + Number(i.total ?? 0), 0);
    const overdueCount = invoices.filter(i => i.status === 'OVERDUE').length;

    let base = 0;
    if (totalRevenue > 50000) base = 100;
    else if (totalRevenue > 20000) base = 80;
    else if (totalRevenue > 10000) base = 65;
    else if (totalRevenue > 5000) base = 50;
    else if (totalRevenue > 1000) base = 35;
    else if (totalRevenue > 0) base = 20;

    const paymentReliability = paidInvoices.length / Math.max(1, invoices.length);
    base = Math.round(base * (0.5 + 0.5 * paymentReliability));

    if (overdueCount > 0) {
      base = Math.max(0, base - overdueCount * 5);
    }

    return Math.min(100, base);
  }

  private calcEngagementScore(events: { type: string; createdAt: Date }[], now: Date): number {
    if (events.length === 0) return 0;

    const recent30 = events.filter(e =>
      (now.getTime() - e.createdAt.getTime()) < 30 * 24 * 60 * 60 * 1000
    );
    const older30 = events.filter(e =>
      (now.getTime() - e.createdAt.getTime()) >= 30 * 24 * 60 * 60 * 1000 &&
      (now.getTime() - e.createdAt.getTime()) < 60 * 24 * 60 * 60 * 1000
    );

    const eventTypes = new Set(recent30.map(e => e.type));
    const diversityBonus = Math.min(20, eventTypes.size * 5);

    let base = Math.min(80, recent30.length * 8);
    base += diversityBonus;

    if (recent30.length > older30.length) {
      base = Math.min(100, base + 10);
    } else if (recent30.length < older30.length && older30.length > 0) {
      base = Math.max(0, base - 10);
    }

    return Math.min(100, base);
  }

  private calcTenureScore(createdAt: Date, now: Date): number {
    const daysSince = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > 365) return 100;
    if (daysSince > 180) return 80;
    if (daysSince > 90) return 60;
    if (daysSince > 30) return 40;
    if (daysSince > 7) return 20;
    return 10;
  }

  private parseHour(value: unknown): number | null {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const parts = value.split(':');
      const hour = parseInt(parts[0], 10);
      return Number.isFinite(hour) ? hour : null;
    }
    return null;
  }

  private isInQuietHours(quietHoursStart: unknown, quietHoursEnd: unknown): boolean {
    const start = this.parseHour(quietHoursStart) ?? 22;
    const end = this.parseHour(quietHoursEnd) ?? 7;
    const nowHour = new Date().getHours();
    if (start > end) {
      return nowHour >= start || nowHour < end;
    }
    return nowHour >= start && nowHour < end;
  }

  async runDailySweep(businessId: string): Promise<{
    contactsProcessed: number;
    recommendationsGenerated: number;
    snapshotsSaved: number;
  }> {
    const start = Date.now();
    this.logger.log(`[Momentum] Starting daily sweep for business ${businessId}`);

    let recommendationsGenerated = 0;
    let snapshotsSaved = 0;
    let totalProcessed = 0;
    let cursor: string | undefined;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    while (true) {
      const contacts = await this.db.contact.findMany({
        where: { businessId, deletedAt: null, status: { not: 'LOST' } },
        select: { id: true, firstName: true, lastName: true, custom: true },
        take: BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
      });

      if (contacts.length === 0) break;

      for (const contact of contacts) {
        try {
          const momentum = await this.calculateMomentumScore(businessId, contact.id);

          await this.db.contactMomentum.upsert({
            where: { businessId_contactId: { businessId, contactId: contact.id } },
            create: {
              businessId,
              contactId: contact.id,
              score: momentum.score,
              previousScore: momentum.previousScore,
              trend: momentum.trend,
              recencyScore: momentum.recencyScore,
              frequencyScore: momentum.frequencyScore,
              monetaryScore: momentum.monetaryScore,
              engagementScore: momentum.engagementScore,
              tenureScore: momentum.tenureScore,
            },
            update: {
              score: momentum.score,
              previousScore: momentum.previousScore,
              trend: momentum.trend,
              recencyScore: momentum.recencyScore,
              frequencyScore: momentum.frequencyScore,
              monetaryScore: momentum.monetaryScore,
              engagementScore: momentum.engagementScore,
              tenureScore: momentum.tenureScore,
              calculatedAt: new Date(),
            },
          });

          await this.db.contactMomentumSnapshot.upsert({
            where: {
              businessId_contactId_snapshotDate: {
                businessId,
                contactId: contact.id,
                snapshotDate: today,
              },
            },
            create: {
              businessId,
              contactId: contact.id,
              score: momentum.score,
              trend: momentum.trend,
              recencyScore: momentum.recencyScore,
              frequencyScore: momentum.frequencyScore,
              monetaryScore: momentum.monetaryScore,
              engagementScore: momentum.engagementScore,
              tenureScore: momentum.tenureScore,
              snapshotDate: today,
            },
            update: {
              score: momentum.score,
              trend: momentum.trend,
              recencyScore: momentum.recencyScore,
              frequencyScore: momentum.frequencyScore,
              monetaryScore: momentum.monetaryScore,
              engagementScore: momentum.engagementScore,
              tenureScore: momentum.tenureScore,
            },
          });
          snapshotsSaved++;

          const contactName = `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || 'Unnamed';
          const recs = await this.generateRecommendations(businessId, contact.id, contactName, momentum);
          recommendationsGenerated += recs.length;

          const custom = contact.custom as Record<string, unknown> | null;
          const birthday = custom?.birthday as string | null;
          if (birthday) {
            const birthdayRec = this.checkBirthday(businessId, contact.id, contactName, birthday, momentum.score);
            if (birthdayRec) {
              await this.saveRecommendation(birthdayRec);
              recommendationsGenerated++;
            }
          }
        } catch (err) {
          this.logger.warn(`[Momentum] Failed to process contact ${contact.id}: ${(err as Error).message}`);
        }
      }

      totalProcessed += contacts.length;
      cursor = contacts[contacts.length - 1].id;

      if (contacts.length < BATCH_SIZE) break;
    }

    await this.autoExecuteLowRisk(businessId);

    const duration = Date.now() - start;
    this.logger.log(`[Momentum] Daily sweep complete for ${businessId}: ${totalProcessed} contacts, ${recommendationsGenerated} recs, ${snapshotsSaved} snapshots, ${duration}ms`);

    return {
      contactsProcessed: totalProcessed,
      recommendationsGenerated,
      snapshotsSaved,
    };
  }

  private async generateRecommendations(
    businessId: string,
    contactId: string,
    contactName: string,
    momentum: ContactMomentumData,
  ): Promise<MomentumRecommendationInput[]> {
    const recs: MomentumRecommendationInput[] = [];

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const existingToday = await this.db.momentumRecommendation.count({
      where: {
        businessId,
        contactId,
        createdAt: { gte: today, lt: tomorrow },
        status: { in: ['pending', 'snoozed'] },
      },
    });

    if (existingToday > 0) return recs;

    if (momentum.score < 30 && momentum.previousScore !== null && momentum.previousScore >= 30) {
      recs.push({
        businessId,
        contactId,
        type: 'churn_risk',
        title: `${contactName} is losing momentum`,
        description: `${contactName}'s engagement has dropped from ${momentum.previousScore} to ${momentum.score}. They may be at risk of churning — consider reaching out.`,
        priority: 'high',
        triggerReason: `Score dropped from ${momentum.previousScore} to ${momentum.score}`,
        momentumScore: momentum.score,
      });
    }

    if (momentum.recencyScore <= 15 && momentum.monetaryScore > 30) {
      recs.push({
        businessId,
        contactId,
        type: 'check_in',
        title: `Check in with ${contactName}`,
        description: `${contactName} hasn't interacted recently but has been a valuable client. A check-in could re-engage them.`,
        priority: 'medium',
        triggerReason: 'High monetary value but low recency',
        momentumScore: momentum.score,
      });
    }

    if (momentum.trend === 'rising' && momentum.score >= 70) {
      recs.push({
        businessId,
        contactId,
        type: 'upsell',
        title: `${contactName} is on a hot streak`,
        description: `${contactName}'s engagement is rising (score: ${momentum.score}). This is a great time to offer a package or upsell.`,
        priority: 'medium',
        triggerReason: 'Rising momentum with high score',
        momentumScore: momentum.score,
      });
    }

    if (momentum.frequencyScore >= 60 && momentum.monetaryScore >= 50) {
      const recentPackageRec = await this.db.momentumRecommendation.findFirst({
        where: {
          businessId,
          contactId,
          type: 'package_offer',
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
      });
      if (!recentPackageRec) {
        recs.push({
          businessId,
          contactId,
          type: 'package_offer',
          title: `Offer ${contactName} a package deal`,
          description: `${contactName} books frequently and pays well. Consider offering a discounted package to lock in their loyalty.`,
          priority: 'medium',
          triggerReason: 'High frequency and monetary scores',
          momentumScore: momentum.score,
        });
      }
    }

    if (momentum.score <= 10 && momentum.previousScore !== null && momentum.previousScore > 10) {
      recs.push({
        businessId,
        contactId,
        type: 're_engage',
        title: `Re-engage ${contactName}`,
        description: `${contactName}'s momentum has flatlined (score: ${momentum.score}). Consider a special offer or personalized outreach.`,
        priority: 'high',
        triggerReason: 'Near-zero momentum score',
        momentumScore: momentum.score,
      });
    }

    for (const rec of recs) {
      await this.enrichRecommendationWithAi(rec, contactName);
      await this.saveRecommendation(rec);
    }

    return recs;
  }

  private async enrichRecommendationWithAi(rec: MomentumRecommendationInput, contactName: string): Promise<void> {
    try {
      const result = await this.aiUsage.callAi({
        businessId: rec.businessId,
        feature: 'momentum_recommendation',
        model: 'gpt-4o-mini',
        maxTokens: 200,
        temperature: 0.5,
        outputCategory: 'messages',
        messages: [
          {
            role: 'system',
            content: [
              'You are a CRM assistant for a Caribbean business. Generate a brief, actionable recommendation.',
              'Respond with JSON: {"title":"<concise title>","description":"<2-3 sentence actionable description>","draftMessage":"<short outreach message for the contact>"}',
              'Keep the tone warm and Caribbean-friendly. Use TTD for currency.',
            ].join('\n'),
          },
          {
            role: 'user',
            content: [
              `Contact: ${contactName}`,
              `Recommendation type: ${rec.type.replace(/_/g, ' ')}`,
              `Momentum score: ${rec.momentumScore}/100`,
              `Trigger: ${rec.triggerReason}`,
              `Current description: ${rec.description}`,
            ].join('\n'),
          },
        ],
      });

      const match = result.content.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (parsed.title) rec.title = parsed.title;
        if (parsed.description) rec.description = parsed.description;
      }
    } catch (err) {
      this.logger.debug(`[Momentum] AI enrichment skipped for ${rec.type}: ${(err as Error).message}`);
    }
  }

  private checkBirthday(
    businessId: string,
    contactId: string,
    contactName: string,
    birthday: string,
    momentumScore: number,
  ): MomentumRecommendationInput | null {
    try {
      const bday = new Date(birthday);
      if (isNaN(bday.getTime())) return null;

      const now = new Date();
      const thisYearBday = new Date(now.getFullYear(), bday.getMonth(), bday.getDate());
      const nextYearBday = new Date(now.getFullYear() + 1, bday.getMonth(), bday.getDate());

      const candidates = [thisYearBday, nextYearBday];
      for (const candidate of candidates) {
        const diffDays = Math.ceil((candidate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        if (diffDays >= 0 && diffDays <= 7) {
          const dayLabel = diffDays === 0 ? 'today' : diffDays === 1 ? 'tomorrow' : `in ${diffDays} days`;
          return {
            businessId,
            contactId,
            type: 'birthday',
            title: `${contactName}'s birthday is ${dayLabel}!`,
            description: `Send a birthday greeting to ${contactName}. A personal touch goes a long way!`,
            priority: diffDays <= 1 ? 'high' : 'medium',
            triggerReason: `Birthday on ${candidate.toISOString().split('T')[0]}`,
            momentumScore,
            scheduledFor: diffDays === 0 ? undefined : candidate,
          };
        }
      }
    } catch {
      // ignore invalid dates
    }
    return null;
  }

  private async saveRecommendation(rec: MomentumRecommendationInput) {
    await this.db.momentumRecommendation.create({
      data: {
        businessId: rec.businessId,
        contactId: rec.contactId,
        type: rec.type,
        title: rec.title,
        description: rec.description,
        priority: rec.priority,
        triggerReason: rec.triggerReason,
        momentumScore: rec.momentumScore,
        scheduledFor: rec.scheduledFor,
      },
    });
  }

  async getDailyRecommendations(businessId: string, limit = 5) {
    const now = new Date();

    const recs = await this.db.momentumRecommendation.findMany({
      where: {
        businessId,
        status: { in: ['pending', 'snoozed'] },
        AND: [
          { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] },
          { OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }] },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: limit * 5,
      include: {
        contact: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            status: true,
            companyName: true,
          },
        },
      },
    });

    const priorityRank: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
    return recs
      .filter(r => {
        if (r.snoozedUntil && r.snoozedUntil > now) return false;
        if (r.scheduledFor && r.scheduledFor > now) return false;
        return true;
      })
      .sort((a, b) => {
        const pa = priorityRank[a.priority] ?? 3;
        const pb = priorityRank[b.priority] ?? 3;
        if (pa !== pb) return pa - pb;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      })
      .slice(0, limit);
  }

  async actionRecommendation(businessId: string, recommendationId: string) {
    return this.db.momentumRecommendation.update({
      where: { id: recommendationId, businessId },
      data: { status: 'actioned', actionedAt: new Date() },
    });
  }

  async snoozeRecommendation(businessId: string, recommendationId: string, days = 7) {
    const snoozedUntil = new Date();
    snoozedUntil.setDate(snoozedUntil.getDate() + days);
    return this.db.momentumRecommendation.update({
      where: { id: recommendationId, businessId },
      data: { status: 'snoozed', snoozedUntil },
    });
  }

  async dismissRecommendation(businessId: string, recommendationId: string) {
    return this.db.momentumRecommendation.update({
      where: { id: recommendationId, businessId },
      data: { status: 'dismissed', dismissedAt: new Date() },
    });
  }

  async getContactMomentum(businessId: string, contactId: string) {
    const momentum = await this.db.contactMomentum.findUnique({
      where: { businessId_contactId: { businessId, contactId } },
    });

    if (!momentum) {
      const fresh = await this.calculateMomentumScore(businessId, contactId);
      await this.db.contactMomentum.upsert({
        where: { businessId_contactId: { businessId, contactId } },
        create: {
          businessId,
          contactId,
          score: fresh.score,
          previousScore: fresh.previousScore,
          trend: fresh.trend,
          recencyScore: fresh.recencyScore,
          frequencyScore: fresh.frequencyScore,
          monetaryScore: fresh.monetaryScore,
          engagementScore: fresh.engagementScore,
          tenureScore: fresh.tenureScore,
        },
        update: {
          score: fresh.score,
          previousScore: fresh.previousScore,
          trend: fresh.trend,
          recencyScore: fresh.recencyScore,
          frequencyScore: fresh.frequencyScore,
          monetaryScore: fresh.monetaryScore,
          engagementScore: fresh.engagementScore,
          tenureScore: fresh.tenureScore,
          calculatedAt: new Date(),
        },
      });
      return fresh;
    }

    return momentum;
  }

  async getContactMomentumHistory(businessId: string, contactId: string, days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const snapshots = await this.db.contactMomentumSnapshot.findMany({
      where: {
        businessId,
        contactId,
        snapshotDate: { gte: since },
      },
      orderBy: { snapshotDate: 'asc' },
      select: {
        score: true,
        trend: true,
        snapshotDate: true,
        recencyScore: true,
        frequencyScore: true,
        monetaryScore: true,
        engagementScore: true,
        tenureScore: true,
      },
    });

    return snapshots.map(s => ({
      score: s.score,
      trend: s.trend,
      calculatedAt: s.snapshotDate,
      recencyScore: s.recencyScore,
      frequencyScore: s.frequencyScore,
      monetaryScore: s.monetaryScore,
      engagementScore: s.engagementScore,
      tenureScore: s.tenureScore,
    }));
  }

  async getMomentumSummary(businessId: string) {
    const [total, rising, falling, stable, avgScore] = await Promise.all([
      this.db.contactMomentum.count({ where: { businessId } }),
      this.db.contactMomentum.count({ where: { businessId, trend: 'rising' } }),
      this.db.contactMomentum.count({ where: { businessId, trend: 'falling' } }),
      this.db.contactMomentum.count({ where: { businessId, trend: 'stable' } }),
      this.db.contactMomentum.aggregate({
        where: { businessId },
        _avg: { score: true },
      }),
    ]);

    const atRisk = await this.db.contactMomentum.count({
      where: { businessId, score: { lte: 30 }, trend: 'falling' },
    });

    const hotLeads = await this.db.contactMomentum.count({
      where: { businessId, score: { gte: 70 }, trend: 'rising' },
    });

    return {
      total,
      averageScore: Math.round(avgScore._avg.score ?? 0),
      rising,
      falling,
      stable,
      atRisk,
      hotLeads,
    };
  }

  async autoExecuteLowRisk(businessId: string): Promise<number> {
    let settings: Awaited<ReturnType<typeof this.autopilotService.getSettings>>;
    try {
      settings = await this.autopilotService.getSettings(businessId);
    } catch {
      return 0;
    }

    if (!settings.enabled) return 0;

    const quietStart = (settings as Record<string, unknown>).quietHoursStart;
    const quietEnd = (settings as Record<string, unknown>).quietHoursEnd;
    if (this.isInQuietHours(quietStart, quietEnd)) {
      this.logger.log(`[Momentum] Skipping auto-execute during quiet hours for ${businessId}`);
      return 0;
    }

    const pausedUntil = (settings as Record<string, unknown>).pausedUntil as string | undefined;
    if (pausedUntil && new Date(pausedUntil) > new Date()) {
      this.logger.log(`[Momentum] Autopilot is paused until ${pausedUntil} for ${businessId}`);
      return 0;
    }

    const autoApproveTypes = settings.autoApproveTypes || [];
    if (autoApproveTypes.length === 0) return 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const rawLimit = (settings as Record<string, unknown>).dailyTaskLimit;
    const dailyLimit = typeof rawLimit === 'number' && Number.isFinite(rawLimit) ? rawLimit : 3;
    const todayAutoExecuted = await this.db.momentumRecommendation.count({
      where: {
        businessId,
        autoExecuted: true,
        actionedAt: { gte: today, lt: tomorrow },
      },
    });

    const remaining = Math.max(0, dailyLimit - todayAutoExecuted);
    if (remaining === 0) {
      this.logger.log(`[Momentum] Daily auto-execute limit reached for ${businessId}`);
      return 0;
    }

    const lowRiskRecs = await this.db.momentumRecommendation.findMany({
      where: {
        businessId,
        status: 'pending',
        type: { in: autoApproveTypes },
        priority: { in: ['low', 'medium'] },
      },
      take: remaining,
    });

    let executed = 0;
    for (const rec of lowRiskRecs) {
      await this.db.momentumRecommendation.update({
        where: { id: rec.id },
        data: { status: 'actioned', autoExecuted: true, actionedAt: new Date() },
      });
      executed++;
    }

    if (executed > 0) {
      this.logger.log(`[Momentum] Auto-executed ${executed} low-risk recommendations for ${businessId}`);
    }

    return executed;
  }
}
