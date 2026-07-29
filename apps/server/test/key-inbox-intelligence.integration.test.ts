import { describe, beforeAll, afterAll, it, expect, vi } from 'vitest';
import { db } from '@keyflow/db';
import { KeyInboxIntelligenceService } from '../src/modules/key-inbox/key-inbox-intelligence.service';
import type { PrismaService } from '../src/core/prisma/prisma.service';

const businessId = 'cmpcs917u00go9z00hvf3wcw3';

function createId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

describe('KEYInbox Intelligence smoke (B.9)', () => {
  let threadIds: string[] = [];
  let messageIds: string[] = [];
  let insightIds: string[] = [];

  const prisma = { client: db } as unknown as PrismaService;
  const aiUsage = {
    trackAndComplete: vi.fn().mockResolvedValue({
      content: JSON.stringify({
        executiveSummary: 'Smoke intelligence summary.',
        keyFindings: ['Finding 1'],
        recommendations: ['Recommendation 1'],
        taskSuggestions: ['Task 1'],
        insights: [
          {
            type: 'PRICING_SIGNAL',
            severity: 'MEDIUM',
            title: 'Pricing questions detected',
            description: 'Pricing questions increased.',
            evidence: ['pricingQuestions: 2'],
          },
        ],
        genomeSignals: [
          {
            signalType: 'pricing_objection_detected',
            section: 'Sales DNA',
            domain: 'Pricing',
            title: 'Pricing objection signal',
            reason: 'Pricing questions appeared.',
            confidence: 0.82,
            evidence: [],
          },
        ],
        channelBreakdown: { whatsapp: 3, gmail: 2 },
      }),
    }),
  };
  const temporalEmitter = {
    emitIntelligenceGenerated: vi.fn().mockResolvedValue(undefined),
    emitTrendDetected: vi.fn().mockResolvedValue(undefined),
    emitOpportunityDetected: vi.fn().mockResolvedValue(undefined),
    emitRiskDetected: vi.fn().mockResolvedValue(undefined),
    emitGenomeSignalDetected: vi.fn().mockResolvedValue(undefined),
  };

  const service = new KeyInboxIntelligenceService(prisma, aiUsage as any, temporalEmitter as any);

  beforeAll(async () => {
    await db.keyInboxInsight.deleteMany({ where: { businessId, scope: 'CUSTOM' } });
    const now = new Date();
    const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const t1 = createId('thread');
    const t2 = createId('thread');
    threadIds = [t1, t2];

    await db.keyInboxThread.createMany({
      data: [
        {
          id: t1,
          businessId,
          channel: 'WHATSAPP',
          status: 'OPEN',
          priority: 'URGENT',
          lastMessageAt: now,
          lastInboundAt: start,
          lastOutboundAt: now,
          aiSummary: 'WhatsApp pricing thread',
        },
        {
          id: t2,
          businessId,
          channel: 'GMAIL',
          status: 'OPEN',
          priority: 'NORMAL',
          lastMessageAt: now,
          lastInboundAt: start,
          lastOutboundAt: null,
          aiSummary: 'Gmail booking thread',
        },
      ],
    });

    const messages = [
      {
        id: createId('msg'),
        businessId,
        threadId: t1,
        channel: 'WHATSAPP',
        direction: 'INBOUND',
        contentText: 'How much is the monthly package?',
        aiAnalysis: { intent: 'pricing_question', urgency: 'high', sentiment: 'neutral' },
        createdAt: start,
      },
      {
        id: createId('msg'),
        businessId,
        threadId: t1,
        channel: 'WHATSAPP',
        direction: 'OUTBOUND',
        contentText: 'It is $99 per month.',
        sendStatus: 'SENT',
        aiAnalysis: {},
        createdAt: new Date(start.getTime() + 15 * 60000),
      },
      {
        id: createId('msg'),
        businessId,
        threadId: t1,
        channel: 'WHATSAPP',
        direction: 'INBOUND',
        contentText: 'Can I get a discount?',
        aiAnalysis: { intent: 'pricing_question', urgency: 'normal', sentiment: 'neutral' },
        createdAt: new Date(start.getTime() + 30 * 60000),
      },
      {
        id: createId('msg'),
        businessId,
        threadId: t2,
        channel: 'GMAIL',
        direction: 'INBOUND',
        contentText: 'I want to book a session.',
        aiAnalysis: { intent: 'booking_request', urgency: 'normal', sentiment: 'positive' },
        createdAt: start,
      },
      {
        id: createId('msg'),
        businessId,
        threadId: t2,
        channel: 'GMAIL',
        direction: 'OUTBOUND',
        contentText: 'Draft reply',
        sendStatus: 'DRAFT',
        aiAnalysis: {},
        createdAt: new Date(start.getTime() + 5 * 60000),
      },
    ];

    await db.keyInboxMessage.createMany({ data: messages });
    messageIds = messages.map((m) => m.id);
  });

  afterAll(async () => {
    await db.keyInboxMessage.deleteMany({ where: { id: { in: messageIds } } });
    await db.keyInboxThread.deleteMany({ where: { id: { in: threadIds } } });
    await db.keyInboxInsight.deleteMany({ where: { id: { in: insightIds } } });
    await db.$disconnect();
  });

  it('generates an intelligence report with deterministic metrics', async () => {
    const now = new Date();
    const start = new Date(now.getTime() - 25 * 60 * 60 * 1000);
    const dto = { scope: 'CUSTOM' as const, start: start.toISOString(), end: now.toISOString() };

    const report = await service.generateReport(businessId, dto);
    insightIds.push(report.id);

    expect(report.businessId).toBe(businessId);
    expect(report.scope).toBe('CUSTOM');
    expect(report.metrics.totalThreads).toBeGreaterThanOrEqual(2);
    expect(report.metrics.totalMessages).toBeGreaterThanOrEqual(5);
    expect(report.metrics.inboundMessages).toBeGreaterThanOrEqual(3);
    expect(report.metrics.outboundMessages).toBeGreaterThanOrEqual(2);
    expect(report.metrics.pricingQuestions).toBeGreaterThanOrEqual(2);
    expect(report.metrics.bookingRequests).toBeGreaterThanOrEqual(1);
    expect(report.metrics.sentReplies).toBeGreaterThanOrEqual(1);
    expect(report.metrics.draftReplies).toBeGreaterThanOrEqual(1);
    expect(report.metrics.urgentThreads).toBeGreaterThanOrEqual(1);
    expect(report.metrics.unansweredThreads).toBeGreaterThanOrEqual(1);
    expect(report.metrics.topChannels.some((c) => c.channel === 'WHATSAPP' && c.count >= 3)).toBe(true);
    expect(report.metrics.topChannels.some((c) => c.channel === 'GMAIL' && c.count >= 2)).toBe(true);

    expect(report.trends.inboundMessages).toBeDefined();
    expect(report.insights.length).toBeGreaterThanOrEqual(1);
    expect(report.genomeSignals.length).toBeGreaterThanOrEqual(1);
    expect(report.channelBreakdown).toEqual({ whatsapp: 3, gmail: 2 });

    expect(temporalEmitter.emitIntelligenceGenerated).toHaveBeenCalled();
  });

  it('persists report and can retrieve it', async () => {
    const latest = await service.getLatestReport(businessId, 'CUSTOM');
    expect(latest).not.toBeNull();
    expect(latest?.businessId).toBe(businessId);
    expect(latest?.metrics.totalMessages).toBeGreaterThanOrEqual(5);
  });
});
