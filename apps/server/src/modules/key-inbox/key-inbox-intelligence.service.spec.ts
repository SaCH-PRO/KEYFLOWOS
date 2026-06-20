import { describe, expect, it, vi } from 'vitest';
import { KeyInboxIntelligenceService } from './key-inbox-intelligence.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from '../ai/ai-usage.service';
import { KeyInboxTemporalEmitterService } from './key-inbox-temporal-emitter.service';
import type { GenerateKeyInboxIntelligenceDto } from './dto/generate-intelligence.dto';
import type { KeyInboxIntelligenceMetrics } from './key-inbox-intelligence.types';

describe('KeyInboxIntelligenceService', () => {
  function makeService(opts?: { aiResponse?: string; aiFail?: boolean }) {
    const prisma = {
      client: {
        keyInboxThread: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        keyInboxMessage: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        keyInboxInsight: {
          create: vi.fn().mockImplementation((args) =>
            Promise.resolve({
              id: 'insight_1',
              businessId: args.data.businessId,
              scope: args.data.scope,
              periodStart: args.data.periodStart,
              periodEnd: args.data.periodEnd,
              summary: args.data.summary,
              keyFindings: args.data.keyFindings,
              recommendations: args.data.recommendations,
              taskSuggestions: args.data.taskSuggestions,
              metrics: args.data.metrics,
              trends: args.data.trends,
              insights: args.data.insights,
              channelBreakdown: args.data.channelBreakdown,
              genomeSignals: args.data.genomeSignals,
              reportVersion: args.data.reportVersion,
              generatedBy: args.data.generatedBy,
              createdAt: new Date('2026-05-31T00:00:00Z'),
            }),
          ),
          findFirst: vi.fn().mockResolvedValue(null),
          findMany: vi.fn().mockResolvedValue([]),
        },
      },
    } as unknown as PrismaService;

    const aiUsage = {
      trackAndComplete: vi.fn().mockImplementation(() => {
        if (opts?.aiFail) throw new Error('AI failed');
        return Promise.resolve({ content: opts?.aiResponse ?? '{"executiveSummary":"ok","keyFindings":[],"recommendations":[],"taskSuggestions":[],"insights":[],"genomeSignals":[],"channelBreakdown":{}}' });
      }),
    } as unknown as AiUsageService;

    const temporalEmitter = {
      emitIntelligenceGenerated: vi.fn().mockResolvedValue(undefined),
      emitTrendDetected: vi.fn().mockResolvedValue(undefined),
      emitOpportunityDetected: vi.fn().mockResolvedValue(undefined),
      emitRiskDetected: vi.fn().mockResolvedValue(undefined),
      emitGenomeSignalDetected: vi.fn().mockResolvedValue(undefined),
    } as unknown as KeyInboxTemporalEmitterService;

    return { service: new KeyInboxIntelligenceService(prisma, aiUsage, temporalEmitter), prisma, aiUsage, temporalEmitter };
  }

  describe('resolvePeriod', () => {
    it('resolves DAILY to today start', () => {
      const { service } = makeService();
      const period = service.resolvePeriod('DAILY');
      const now = new Date();
      expect(period.start.getFullYear()).toBe(now.getFullYear());
      expect(period.start.getMonth()).toBe(now.getMonth());
      expect(period.start.getDate()).toBe(now.getDate());
      expect(period.start.getHours()).toBe(0);
      expect(period.end.getTime()).toBeGreaterThanOrEqual(period.start.getTime());
    });

    it('resolves CUSTOM from explicit dates', () => {
      const { service } = makeService();
      const period = service.resolvePeriod('CUSTOM', '2026-05-01T00:00:00Z', '2026-05-07T00:00:00Z');
      expect(period.start.toISOString()).toBe('2026-05-01T00:00:00.000Z');
      expect(period.end.toISOString()).toBe('2026-05-07T00:00:00.000Z');
    });

    it('throws for CUSTOM without dates', () => {
      const { service } = makeService();
      expect(() => service.resolvePeriod('CUSTOM')).toThrow('Custom scope requires start and end dates');
    });
  });

  describe('resolvePreviousPeriod', () => {
    it('returns equal-length window before start', () => {
      const { service } = makeService();
      const previous = service.resolvePreviousPeriod(new Date('2026-05-08T00:00:00Z'), new Date('2026-05-15T00:00:00Z'));
      expect(previous.start.toISOString()).toBe('2026-05-01T00:00:00.000Z');
      expect(previous.end.toISOString()).toBe('2026-05-08T00:00:00.000Z');
    });
  });

  describe('buildTrends', () => {
    it('calculates delta and direction', () => {
      const { service } = makeService();
      const current = { inboundMessages: 12 } as KeyInboxIntelligenceMetrics;
      const previous = { inboundMessages: 8 } as KeyInboxIntelligenceMetrics;
      const trends = service.buildTrends(current, previous);
      expect(trends.inboundMessages).toEqual({ current: 12, previous: 8, delta: 4, deltaPercent: 50, direction: 'up' });
    });

    it('handles zero previous', () => {
      const { service } = makeService();
      const current = { inboundMessages: 5 } as KeyInboxIntelligenceMetrics;
      const previous = { inboundMessages: 0 } as KeyInboxIntelligenceMetrics;
      const trends = service.buildTrends(current, previous);
      expect(trends.inboundMessages.deltaPercent).toBeNull();
      expect(trends.inboundMessages.direction).toBe('up');
    });
  });

  describe('generateReport', () => {
    it('persists report and emits event', async () => {
      const { service, temporalEmitter } = makeService();
      const dto: GenerateKeyInboxIntelligenceDto = { scope: 'WEEKLY' };
      const report = await service.generateReport('biz_1', dto, 'user_1');

      expect(report.businessId).toBe('biz_1');
      expect(report.scope).toBe('WEEKLY');
      expect(report.executiveSummary).toBe('ok');
      expect(temporalEmitter.emitIntelligenceGenerated).toHaveBeenCalled();
    });

    it('falls back when AI fails', async () => {
      const { service, aiUsage } = makeService({ aiFail: true });
      const dto: GenerateKeyInboxIntelligenceDto = { scope: 'WEEKLY' };
      const report = await service.generateReport('biz_1', dto);

      expect(aiUsage.trackAndComplete).toHaveBeenCalled();
      expect(report.generatedBy).toBe('fallback');
      expect(report.metrics.totalMessages).toBe(0);
    });
  });

  describe('aggregateMetrics', () => {
    it('counts threads and messages', async () => {
      const { service, prisma } = makeService();
      const now = new Date();
      const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const end = new Date(now.getTime() + 30 * 60000);

      prisma.client.keyInboxThread.findMany = vi.fn().mockResolvedValue([
        { id: 't1', status: 'OPEN', priority: 'URGENT', lastInboundAt: now, lastOutboundAt: new Date(now.getTime() + 10 * 60000), createdAt: now, aiTags: ['lead'], contactId: 'c1', channel: 'whatsapp', aiSummary: 'summary' },
      ]);
      prisma.client.keyInboxMessage.findMany = vi.fn().mockResolvedValue([
        { id: 'm1', threadId: 't1', direction: 'INBOUND', channel: 'whatsapp', sendStatus: null, contentText: 'hello', aiAnalysis: { intent: 'lead_inquiry', urgency: 'high', sentiment: 'positive' }, createdAt: now },
        { id: 'm2', threadId: 't1', direction: 'OUTBOUND', channel: 'whatsapp', sendStatus: 'SENT', contentText: 'reply', aiAnalysis: {}, createdAt: new Date(now.getTime() + 10 * 60000) },
      ]);

      const metrics = await service.aggregateMetrics('biz_1', { start, end });

      expect(metrics.totalThreads).toBe(1);
      expect(metrics.inboundMessages).toBe(1);
      expect(metrics.outboundMessages).toBe(1);
      expect(metrics.urgentThreads).toBe(1);
      expect(metrics.unansweredThreads).toBe(0);
      expect(metrics.leadInquiries).toBe(1);
      expect(metrics.topChannels[0]).toEqual({ channel: 'whatsapp', count: 2 });
      expect(metrics.averageFirstResponseMinutes).toBe(10);
    });
  });
});
