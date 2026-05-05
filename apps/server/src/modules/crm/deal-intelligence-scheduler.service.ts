import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AutopilotService } from '../autopilot/autopilot.service';
import { DealHealthService } from './deal-health.service';
import { DealVelocityService } from './deal-velocity.service';

const TICK_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_TARGET_HOUR_UTC = 4;
const MS_PER_DAY = 86_400_000;
const BOTTLENECK_RECENT_TOUCH_DAYS = 7;
const BOTTLENECK_TASK_COOLDOWN_HOURS = 24;

interface DealStageChangedPayload {
  businessId: string;
  dealId: string;
  contactId?: string;
}

interface ContactEventLoggedPayload {
  businessId: string;
  contactId: string;
  type: string;
}

@Injectable()
export class DealIntelligenceSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DealIntelligenceSchedulerService.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastRunDay: string | null = null;
  private readonly targetHourUtc: number;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(DealHealthService) private readonly health: DealHealthService,
    @Inject(DealVelocityService) private readonly velocity: DealVelocityService,
    @Inject(AutopilotService) private readonly autopilot: AutopilotService,
  ) {
    const env = Number(process.env.DEAL_INTEL_SCHEDULER_HOUR_UTC ?? '');
    this.targetHourUtc = Number.isFinite(env) && env >= 0 && env < 24 ? Math.floor(env) : DEFAULT_TARGET_HOUR_UTC;
  }

  onModuleInit() {
    if (process.env.DEAL_INTEL_SCHEDULER_DISABLED === '1') {
      this.logger.log('Deal-intelligence scheduler disabled via env');
      return;
    }
    this.intervalRef = setInterval(() => {
      this.tick().catch((err) => this.logger.error('Tick failed', err));
    }, TICK_INTERVAL_MS);
    this.logger.log(`Deal-intelligence scheduler started (daily at ${this.targetHourUtc}:00 UTC)`);
  }

  onModuleDestroy() {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
    }
  }

  async tick(now: Date = new Date()): Promise<{ ran: boolean }> {
    if (this.running) return { ran: false };
    if (now.getUTCHours() < this.targetHourUtc) return { ran: false };
    const day = now.toISOString().slice(0, 10);
    if (this.lastRunDay === day) return { ran: false };
    this.running = true;
    this.lastRunDay = day;
    try {
      const businesses = await this.prisma.client.business.findMany({ select: { id: true } });
      let totalUpdated = 0;
      let totalBottlenecks = 0;
      for (const b of businesses) {
        try {
          const r = await this.runForBusiness(b.id);
          totalUpdated += r.healthUpdated;
          totalBottlenecks += r.bottlenecksFlagged;
        } catch (err) {
          this.logger.warn(`Daily intel run failed for business=${b.id}: ${(err as Error).message}`);
        }
      }
      this.logger.log(
        `Daily deal intelligence: businesses=${businesses.length} healthUpdated=${totalUpdated} bottlenecks=${totalBottlenecks}`,
      );
      return { ran: true };
    } finally {
      this.running = false;
    }
  }

  /** Recompute health and detect bottlenecks for a single business. Exposed for tests + manual triggering. */
  async runForBusiness(businessId: string): Promise<{ healthUpdated: number; bottlenecksFlagged: number }> {
    const healthRes = await this.health.recomputeForBusiness(businessId);
    const bottleneckRes = await this.detectBottlenecks(businessId);
    return { healthUpdated: healthRes.updated, bottlenecksFlagged: bottleneckRes.flagged };
  }

  /**
   * Mark deals as bottlenecks when they sit in a stage > 1.5× business avg
   * with no recent touch. Creates an AutopilotTask via the existing engine.
   */
  async detectBottlenecks(businessId: string): Promise<{ scanned: number; flagged: number; cleared: number }> {
    const stageAverages = await this.velocity.getStageAverages(businessId);
    const deals = await this.prisma.client.deal.findMany({
      where: { businessId, deletedAt: null, status: 'OPEN' },
      include: {
        stage: { select: { id: true, name: true, slug: true } },
        contact: { select: { id: true, lastContactedAt: true, displayName: true, firstName: true, lastName: true, companyName: true } },
      },
    });

    const now = Date.now();
    let flagged = 0;
    let cleared = 0;
    for (const d of deals) {
      const avg = stageAverages.get(d.stageId) ?? 0;
      const start = (d.lastStageChangedAt ?? d.createdAt).getTime();
      const days = Math.floor((now - start) / MS_PER_DAY);
      const lastTouch = d.contact?.lastContactedAt
        ? Math.floor((now - new Date(d.contact.lastContactedAt).getTime()) / MS_PER_DAY)
        : null;

      const threshold = Math.max(7, Math.round(avg * 1.5));
      const isBottleneck = avg > 0
        ? days >= threshold && (lastTouch == null || lastTouch >= BOTTLENECK_RECENT_TOUCH_DAYS)
        : days >= 30 && (lastTouch == null || lastTouch >= BOTTLENECK_RECENT_TOUCH_DAYS);

      if (isBottleneck && !d.bottleneckFlag) {
        await this.prisma.client.deal.update({
          where: { id: d.id },
          data: { bottleneckFlag: true, bottleneckAt: new Date() },
        });
        flagged += 1;
        await this.maybeCreateBottleneckTask(businessId, d, days);
      } else if (!isBottleneck && d.bottleneckFlag) {
        await this.prisma.client.deal.update({
          where: { id: d.id },
          data: { bottleneckFlag: false, bottleneckAt: null },
        });
        cleared += 1;
      }
    }
    return { scanned: deals.length, flagged, cleared };
  }

  private async maybeCreateBottleneckTask(
    businessId: string,
    deal: { id: string; title: string; companyName: string | null; stage: { name: string }; contact: { displayName?: string | null; firstName?: string | null; lastName?: string | null; companyName?: string | null } | null },
    days: number,
  ) {
    const cooldownSince = new Date(Date.now() - BOTTLENECK_TASK_COOLDOWN_HOURS * 60 * 60 * 1000);
    const existing = await this.prisma.client.autopilotTask.findFirst({
      where: {
        businessId,
        relatedType: 'DEAL',
        relatedId: deal.id,
        category: 'SALES',
        status: { in: ['PENDING', 'IN_PROGRESS', 'AWAITING_APPROVAL'] },
        createdAt: { gte: cooldownSince },
      },
      select: { id: true },
    });
    if (existing) return;

    const who = deal.companyName
      ?? deal.contact?.companyName
      ?? deal.contact?.displayName
      ?? `${deal.contact?.firstName ?? ''} ${deal.contact?.lastName ?? ''}`.trim()
      ?? 'this contact';

    try {
      await this.autopilot.createTask({
        businessId,
        title: `Nudge ${who} — stuck in ${deal.stage.name} ${days}d`,
        description: `Deal "${deal.title}" has been in ${deal.stage.name} for ${days} days with no recent contact. Consider a follow-up.`,
        category: 'SALES',
        priority: 'HIGH',
        relatedType: 'DEAL',
        relatedId: deal.id,
        aiContext: { source: 'deal_bottleneck', daysInStage: days, stageName: deal.stage.name },
      });
    } catch (err) {
      // Daily task limit (3/day) is the most common reason — log and continue.
      this.logger.debug(`Skipped bottleneck task for deal=${deal.id}: ${(err as Error).message}`);
    }
  }

  // ---- event listeners --------------------------------------------------

  @OnEvent('crm.deal.stage_changed', { async: true })
  async onDealStageChanged(payload: DealStageChangedPayload) {
    if (!payload?.businessId || !payload?.dealId) return;
    try {
      await this.health.recomputeDeal({ businessId: payload.businessId, dealId: payload.dealId });
      // Stage just changed — clear any stale bottleneck flag.
      await this.prisma.client.deal.updateMany({
        where: { id: payload.dealId, businessId: payload.businessId, bottleneckFlag: true },
        data: { bottleneckFlag: false, bottleneckAt: null },
      });
    } catch (err) {
      this.logger.warn(`onDealStageChanged failed for deal=${payload.dealId}: ${(err as Error).message}`);
    }
  }

  @OnEvent('crm.deal.created', { async: true })
  async onDealCreated(payload: DealStageChangedPayload) {
    if (!payload?.businessId || !payload?.dealId) return;
    try {
      await this.health.recomputeDeal({ businessId: payload.businessId, dealId: payload.dealId });
    } catch (err) {
      this.logger.warn(`onDealCreated health recompute failed for deal=${payload.dealId}: ${(err as Error).message}`);
    }
  }

  @OnEvent('crm.contact_event.logged', { async: true })
  async onContactEvent(payload: ContactEventLoggedPayload) {
    if (!payload?.businessId || !payload?.contactId) return;
    // Recompute health for the contact's open deals when they get touched.
    if (!payload.type?.startsWith('communication.') && payload.type !== 'email.sent' && payload.type !== 'whatsapp.sent' && payload.type !== 'sms.sent') {
      return;
    }
    try {
      const openDeals = await this.prisma.client.deal.findMany({
        where: { businessId: payload.businessId, contactId: payload.contactId, status: 'OPEN', deletedAt: null },
        select: { id: true },
      });
      for (const d of openDeals) {
        await this.health.recomputeDeal({ businessId: payload.businessId, dealId: d.id }).catch(() => null);
      }
    } catch (err) {
      this.logger.warn(`onContactEvent health refresh failed: ${(err as Error).message}`);
    }
  }
}
