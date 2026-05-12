import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

const TICK_INTERVAL_MS = 60 * 60 * 1000; // hourly
const DEFAULT_TARGET_HOUR_UTC = 4; // run at 04:00 UTC

interface LeadScoreInput {
  relationshipHealth: string | null;
  lastInteractionAt: Date | null;
  lastContactedAt: Date | null;
  lifetimeValue: number;
  openDealsCount: number;
  eventCount: number;
  status: string | null;
}

/**
 * Deterministic lead scoring scheduler.
 * Recomputes `leadScore` (0-100) for all contacts nightly using a
 * heuristic that balances recency, revenue, engagement, and pipeline.
 *
 * The AI prompt (`buildLeadScoringPrompt`) is available for on-demand
 * deep-dive scoring; this scheduler uses fast heuristics so it can
 * process thousands of contacts without API costs.
 */
@Injectable()
export class LeadScoringScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LeadScoringScheduler.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastRunDay: string | null = null;
  private readonly targetHourUtc: number;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    const env = Number(process.env.LEAD_SCORE_SCHEDULER_HOUR_UTC ?? '');
    this.targetHourUtc = Number.isFinite(env) && env >= 0 && env < 24 ? Math.floor(env) : DEFAULT_TARGET_HOUR_UTC;
  }

  onModuleInit() {
    if (process.env.LEAD_SCORE_SCHEDULER_DISABLED === '1') {
      this.logger.log('Lead-scoring scheduler disabled via env');
      return;
    }
    this.intervalRef = setInterval(() => {
      this.tick().catch((err) => this.logger.error('Tick failed', err));
    }, TICK_INTERVAL_MS);
    this.logger.log(`Lead-scoring scheduler started (daily at ${this.targetHourUtc}:00 UTC)`);
  }

  onModuleDestroy() {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
    }
  }

  async tick(now: Date = new Date()): Promise<{ ran: boolean; updated: number }> {
    if (this.running) return { ran: false, updated: 0 };
    if (now.getUTCHours() < this.targetHourUtc) return { ran: false, updated: 0 };
    const day = now.toISOString().slice(0, 10);
    if (this.lastRunDay === day) return { ran: false, updated: 0 };
    this.running = true;
    this.lastRunDay = day;
    try {
      const updated = await this.recomputeAll();
      this.logger.log(`Daily lead scoring done: updated=${updated}`);
      return { ran: true, updated };
    } finally {
      this.running = false;
    }
  }

  private async recomputeAll(): Promise<number> {
    const db = this.prisma.client as any;
    const businesses = await db.business.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });

    let totalUpdated = 0;
    for (const business of businesses) {
      const contacts = await db.contact.findMany({
        where: { businessId: business.id, deletedAt: null },
        select: {
          id: true,
          relationshipHealth: true,
          lastInteractionAt: true,
          lastContactedAt: true,
          status: true,
        },
      });

      if (contacts.length === 0) continue;

      // Batch aggregate data
      const contactIds = contacts.map((c: any) => c.id);
      const [dealsAgg, invoicesAgg, eventsAgg] = await Promise.all([
        db.deal.groupBy({
          by: ['contactId'],
          where: { businessId: business.id, contactId: { in: contactIds }, deletedAt: null },
          _sum: { value: true },
          _count: { _all: true },
        }) as Promise<Array<{ contactId: string; _sum: { value: number | null }; _count: { _all: number } }>>,
        db.invoice.groupBy({
          by: ['contactId'],
          where: { businessId: business.id, contactId: { in: contactIds }, deletedAt: null, status: 'PAID' },
          _sum: { total: true },
        }) as Promise<Array<{ contactId: string; _sum: { total: number | null } }>>,
        db.contactEvent.groupBy({
          by: ['contactId'],
          where: { businessId: business.id, contactId: { in: contactIds } },
          _count: { _all: true },
        }) as Promise<Array<{ contactId: string; _count: { _all: number } }>>,
      ]);

      const dealMap = new Map(dealsAgg.map((d) => [d.contactId, { value: d._sum.value ?? 0, count: d._count._all }]));
      const invoiceMap = new Map(invoicesAgg.map((i) => [i.contactId, i._sum.total ?? 0]));
      const eventMap = new Map(eventsAgg.map((e) => [e.contactId, e._count._all]));

      for (const contact of contacts) {
        const lifetimeValue = (dealMap.get(contact.id)?.value ?? 0) + (invoiceMap.get(contact.id) ?? 0);
        const openDealsCount = (dealMap.get(contact.id)?.count ?? 0);
        const eventCount = eventMap.get(contact.id) ?? 0;

        const score = this.computeScore({
          relationshipHealth: contact.relationshipHealth,
          lastInteractionAt: contact.lastInteractionAt,
          lastContactedAt: contact.lastContactedAt,
          lifetimeValue,
          openDealsCount,
          eventCount,
          status: contact.status,
        });

        await db.contact.update({
          where: { id: contact.id },
          data: { leadScore: score },
        });
        totalUpdated++;
      }
    }
    return totalUpdated;
  }

  private computeScore(input: LeadScoreInput): number {
    let score = 50; // start neutral

    // Recency factor (0-30 pts)
    const lastTouch = input.lastInteractionAt ?? input.lastContactedAt;
    const days = lastTouch ? Math.floor((Date.now() - lastTouch.getTime()) / 86_400_000) : 365;
    if (days <= 7) score += 30;
    else if (days <= 14) score += 20;
    else if (days <= 30) score += 10;
    else if (days <= 60) score += 0;
    else if (days <= 90) score -= 10;
    else score -= 20;

    // Relationship health factor (-20 to +20 pts)
    switch (input.relationshipHealth) {
      case 'HOT': score += 20; break;
      case 'WARM': score += 10; break;
      case 'COLD': score -= 10; break;
      case 'DORMANT': score -= 20; break;
      case 'AT_RISK': score -= 15; break;
      default: break;
    }

    // Revenue factor (0-20 pts)
    if (input.lifetimeValue >= 10_000) score += 20;
    else if (input.lifetimeValue >= 5_000) score += 15;
    else if (input.lifetimeValue >= 1_000) score += 10;
    else if (input.lifetimeValue >= 100) score += 5;

    // Pipeline factor (0-15 pts)
    if (input.openDealsCount >= 3) score += 15;
    else if (input.openDealsCount === 2) score += 10;
    else if (input.openDealsCount === 1) score += 5;

    // Engagement factor (0-10 pts)
    if (input.eventCount >= 20) score += 10;
    else if (input.eventCount >= 10) score += 7;
    else if (input.eventCount >= 5) score += 4;
    else if (input.eventCount >= 2) score += 2;

    // Status bonus/penalty
    if (input.status === 'CUSTOMER') score += 5;
    if (input.status === 'LOST') score -= 10;

    return Math.max(0, Math.min(100, Math.round(score)));
  }
}
