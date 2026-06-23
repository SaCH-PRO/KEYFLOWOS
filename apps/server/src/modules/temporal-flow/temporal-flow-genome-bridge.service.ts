import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { GenomeSignalService } from '../business-genome/key-genome/genome-signal.service';

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
];

@Injectable()
export class TemporalFlowGenomeBridgeService {
  private readonly logger = new Logger(TemporalFlowGenomeBridgeService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(GenomeSignalService) private readonly genomeSignalService: GenomeSignalService,
  ) {}

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
        } catch (err) {
          this.logger.warn(`Failed to create genome signal ${pattern.key}: ${(err as Error).message}`);
        }
      }
    }
  }
}
