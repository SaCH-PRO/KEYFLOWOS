import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../../core/prisma/prisma.service';
import { GenomeSignalService } from '../business-genome/key-genome/genome-signal.service';
import { runGuarded } from '../../core/scheduling/safe-interval';

const PATTERNS = [
  {
    key: 'whatsapp_lead_channel',
    section: 'marketing',
    domain: 'acquisition',
    field: 'primary_lead_channel',
    signalType: 'CUSTOMER_PATTERN',
    sourceFilter: (source: string, type: string) => source === 'whatsapp' && type.includes('lead'),
    threshold: 3,
  },
  {
    key: 'instagram_dm_engagement',
    section: 'marketing',
    domain: 'audience',
    field: 'engagement_channel',
    signalType: 'CUSTOMER_PATTERN',
    sourceFilter: (source: string, type: string) => source === 'instagram_dm' && type === 'key_inbox.message_received',
    threshold: 5,
  },
  {
    key: 'email_invoice_requests',
    section: 'sales',
    domain: 'requests',
    field: 'common_request_type',
    signalType: 'REVENUE_PATTERN',
    sourceFilter: (source: string, type: string, payload: unknown) =>
      source === 'email' && (type.includes('invoice') || (payload && typeof payload === 'object' && (payload as any).intent === 'invoice_request')),
    threshold: 3,
  },
  {
    key: 'booking_request_channel',
    section: 'operations',
    domain: 'bookings',
    field: 'booking_intent_source',
    signalType: 'OPERATIONS_PATTERN',
    sourceFilter: (source: string, type: string, payload: unknown) =>
      type.includes('booking') || (payload && typeof payload === 'object' && (payload as any).intent === 'booking_request'),
    threshold: 5,
  },
  {
    key: 'complaint_risk',
    section: 'risk',
    domain: 'reputation',
    field: 'complaint_volume',
    signalType: 'RISK_PATTERN',
    sourceFilter: (source: string, type: string, payload: unknown) =>
      type.includes('complaint') || (payload && typeof payload === 'object' && (payload as any).intent === 'complaint'),
    threshold: 2,
  },
  {
    key: 'repeated_invoice_complaints',
    section: 'risk',
    domain: 'revenue',
    field: 'invoice_complaint_pattern',
    signalType: 'RISK_PATTERN',
    sourceFilter: (_source: string, type: string, payload: unknown) =>
      type.includes('invoice') && (type.includes('complaint') || (payload && typeof payload === 'object' && (payload as any).sentiment === 'negative')),
    threshold: 2,
  },
  {
    key: 'booking_request_spike',
    section: 'operations',
    domain: 'demand',
    field: 'booking_request_volume',
    signalType: 'OPERATIONS_PATTERN',
    sourceFilter: (_source: string, type: string, payload: unknown) =>
      type.includes('booking_request') || (payload && typeof payload === 'object' && (payload as any).intent === 'booking_request'),
    threshold: 5,
  },
  {
    key: 'late_payment_follow_ups',
    section: 'sales',
    domain: 'collections',
    field: 'late_payment_pattern',
    signalType: 'REVENUE_PATTERN',
    sourceFilter: (_source: string, type: string, payload: unknown) =>
      type.includes('overdue') || type.includes('late_payment') || (payload && typeof payload === 'object' && (payload as any).topic === 'collections'),
    threshold: 3,
  },
];

@Injectable()
export class TemporalFlowGenomeBridgeService implements OnModuleInit {
  private readonly logger = new Logger(TemporalFlowGenomeBridgeService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(GenomeSignalService) private readonly genomeSignalService: GenomeSignalService,
  ) {}

  onModuleInit() {
    this.logger.log('TemporalFlowGenomeBridgeService initialized; pattern detection scheduled every 15 minutes');
  }

  async detectPatterns(businessId: string): Promise<void> {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const events = await this.prisma.client.temporalFlowEvent.findMany({
      where: { businessId, occurredAt: { gte: since } },
      orderBy: { occurredAt: 'desc' },
      take: 500,
    });

    for (const pattern of PATTERNS) {
      const matched = events.filter((e) => pattern.sourceFilter(e.source, e.type, e.payload));
      if (matched.length >= pattern.threshold) {
        const confidence = Math.min(0.5 + matched.length / 20, 0.95);
        try {
          await this.genomeSignalService.createSignal({
            businessId,
            sourceModule: 'temporal_flow',
            sourceEntityType: 'TemporalFlowEvent',
            sourceEntityId: matched[0].id,
            signalType: pattern.signalType,
            section: pattern.section,
            domain: pattern.domain,
            field: pattern.field,
            proposedValue: { pattern: pattern.key, eventCount: matched.length, latestAt: matched[0].occurredAt },
            reason: `${matched.length} events match pattern "${pattern.key}" in the last 30 days.`,
            evidence: matched.slice(0, 5).map((e) => ({
              sourceModule: 'temporal_flow',
              sourceEntityType: 'TemporalFlowEvent',
              sourceEntityId: e.id,
              summary: e.title + (e.summary ? ` — ${e.summary}` : ''),
              evidenceStrength: confidence,
              occurredAt: e.occurredAt?.toISOString(),
            })),
            confidence,
          });
        } catch (err: any) {
          this.logger.warn(`Failed to create genome signal ${pattern.key}: ${(err as Error).message}`);
        }
      }
    }
  }

  /**
   * Lightweight scheduled pattern sweep across all businesses with recent events.
   * Runs every 15 minutes. Individual business jobs can still be enqueued via
   * TemporalFlowMemoryQueueService for higher priority detection.
   */
  @Interval(15 * 60 * 1000)
  // Nest's SchedulerOrchestrator mounts @Interval with a raw
  // `setInterval(target, ms)` — no wrapper — so an async handler that rejects
  // becomes an unhandled rejection, and main.ts exits(1) on those. (@Cron is
  // NOT affected: the cron library catches both paths itself. Verified
  // empirically, not assumed.) The work stays in detectPatternsForAll() so callers and
  // tests are unchanged; only the scheduled entry point is guarded.
  detectPatternsForAllTick(): void {
    runGuarded('TemporalFlowGenomeBridgeService', () => this.detectPatternsForAll(), this.logger);
  }

  async detectPatternsForAll(): Promise<void> {
    try {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const rows = await this.prisma.client.temporalFlowEvent.findMany({
        where: { occurredAt: { gte: since } },
        select: { businessId: true },
        distinct: ['businessId'],
        take: 1000,
      });

      for (const row of rows) {
        try {
          await this.detectPatterns(row.businessId);
        } catch (err: unknown) {
          this.logger.warn(`Pattern detection failed for ${row.businessId}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch (err: unknown) {
      this.logger.error(`detectPatternsForAll failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
