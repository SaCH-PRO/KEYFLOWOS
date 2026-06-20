import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import type { KeyInboxInsight, KeyInboxMessage } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from '../ai/ai-usage.service';
import type { GenerateKeyInboxIntelligenceDto } from './dto/generate-intelligence.dto';
import { KeyInboxTemporalEmitterService } from './key-inbox-temporal-emitter.service';
import type {
  EvidenceSample,
  GenomeSignalPreview,
  IntelligenceScope,
  KeyInboxIntelligenceInsight,
  KeyInboxIntelligenceMetrics,
  KeyInboxIntelligenceReport,
  KeyInboxIntelligenceReportContent,
  MetricTrend,
} from './key-inbox-intelligence.types';

const TRACKED_TREND_KEYS: Array<keyof KeyInboxIntelligenceMetrics> = [
  'inboundMessages',
  'outboundMessages',
  'leadInquiries',
  'pricingQuestions',
  'bookingRequests',
  'invoiceRequests',
  'supportRequests',
  'complaints',
  'urgentThreads',
  'unansweredThreads',
  'failedReplies',
];

interface Period {
  start: Date;
  end: Date;
}

interface EvidenceBundle {
  leads: EvidenceSample[];
  pricing: EvidenceSample[];
  bookings: EvidenceSample[];
  invoices: EvidenceSample[];
  complaints: EvidenceSample[];
  failed: EvidenceSample[];
  notSupported: EvidenceSample[];
  unanswered: Array<{ threadId: string; channel: string; excerpt: string; lastInboundAt: Date }>;
}

@Injectable()
export class KeyInboxIntelligenceService {
  private readonly logger = new Logger(KeyInboxIntelligenceService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
    @Inject(KeyInboxTemporalEmitterService) private readonly temporalEmitter: KeyInboxTemporalEmitterService,
  ) {}

  async generateReport(
    businessId: string,
    dto: GenerateKeyInboxIntelligenceDto,
    userId?: string,
  ): Promise<KeyInboxIntelligenceReport> {
    const currentPeriod = this.resolvePeriod(dto.scope, dto.start, dto.end);
    const previousPeriod = this.resolvePreviousPeriod(currentPeriod.start, currentPeriod.end);

    const [currentMetrics, previousMetrics, evidence] = await Promise.all([
      this.aggregateMetrics(businessId, currentPeriod),
      this.aggregateMetrics(businessId, previousPeriod),
      this.collectEvidenceSamples(businessId, currentPeriod),
    ]);

    const trends = this.buildTrends(currentMetrics, previousMetrics);

    let generatedBy: 'ai' | 'fallback' = 'ai';
    let report: KeyInboxIntelligenceReportContent;

    try {
      report = await this.generateAiReport(
        businessId,
        dto.scope,
        currentPeriod,
        currentMetrics,
        trends,
        evidence,
      );
    } catch (err) {
      this.logger.warn(`AI intelligence report failed: ${(err as Error).message}`);
      generatedBy = 'fallback';
      report = this.buildFallbackReport(dto.scope, currentMetrics, trends);
    }

    const insight = await this.persistReport(businessId, dto.scope, currentPeriod, report, generatedBy, userId);

    await this.emitIntelligenceEvents(businessId, insight, report);

    return {
      id: insight.id,
      businessId,
      scope: dto.scope,
      periodStart: currentPeriod.start.toISOString(),
      periodEnd: currentPeriod.end.toISOString(),
      ...report,
      createdAt: insight.createdAt.toISOString(),
    };
  }

  async getLatestReport(
    businessId: string,
    scope: IntelligenceScope,
  ): Promise<KeyInboxIntelligenceReport | null> {
    const insight = await this.prisma.client.keyInboxInsight.findFirst({
      where: { businessId, scope },
      orderBy: { createdAt: 'desc' },
    });
    return insight ? this.toReport(insight) : null;
  }

  async listReports(
    businessId: string,
    scope?: IntelligenceScope,
    limit = 20,
  ): Promise<KeyInboxIntelligenceReport[]> {
    const insights = await this.prisma.client.keyInboxInsight.findMany({
      where: { businessId, scope },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return insights.map((i) => this.toReport(i));
  }

  async getReport(businessId: string, insightId: string): Promise<KeyInboxIntelligenceReport | null> {
    const insight = await this.prisma.client.keyInboxInsight.findFirst({
      where: { id: insightId, businessId },
    });
    return insight ? this.toReport(insight) : null;
  }

  resolvePeriod(scope: IntelligenceScope, start?: string, end?: string): Period {
    const now = new Date();

    if (scope === 'CUSTOM') {
      if (!start || !end) {
        throw new BadRequestException('Custom scope requires start and end dates');
      }
      return { start: new Date(start), end: new Date(end) };
    }

    if (scope === 'DAILY') {
      const s = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      return { start: s, end: now };
    }

    if (scope === 'MONTHLY') {
      const s = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
      return { start: s, end: now };
    }

    // WEEKLY: rolling last 7 days
    const s = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { start: s, end: now };
  }

  resolvePreviousPeriod(start: Date, end: Date): Period {
    const lengthMs = end.getTime() - start.getTime();
    return {
      start: new Date(start.getTime() - lengthMs),
      end: new Date(start.getTime()),
    };
  }

  async aggregateMetrics(businessId: string, period: Period): Promise<KeyInboxIntelligenceMetrics> {
    const [threads, messages] = await Promise.all([
      this.prisma.client.keyInboxThread.findMany({
        where: {
          businessId,
          OR: [
            { lastMessageAt: { gte: period.start, lte: period.end } },
            { createdAt: { gte: period.start, lte: period.end } },
          ],
        },
        select: {
          id: true,
          status: true,
          priority: true,
          lastInboundAt: true,
          lastOutboundAt: true,
          createdAt: true,
          aiTags: true,
          contactId: true,
          channel: true,
          aiSummary: true,
        },
      }),
      this.prisma.client.keyInboxMessage.findMany({
        where: {
          businessId,
          createdAt: { gte: period.start, lte: period.end },
        },
        select: {
          id: true,
          threadId: true,
          direction: true,
          channel: true,
          sendStatus: true,
          contentText: true,
          aiAnalysis: true,
          createdAt: true,
        },
      }),
    ]);

    const messagesByThread = new Map<string, KeyInboxMessage[]>();
    for (const m of messages as KeyInboxMessage[]) {
      const list = messagesByThread.get(m.threadId) ?? [];
      list.push(m);
      messagesByThread.set(m.threadId, list);
    }

    const statusCounts = this.countBy(threads, (t) => t.status);
    const newThreads = threads.filter((t) => t.createdAt >= period.start && t.createdAt <= period.end).length;

    const inboundMessages = messages.filter((m) => m.direction === 'INBOUND');
    const outboundMessages = messages.filter((m) => m.direction === 'OUTBOUND');

    const sendStatusCounts = this.countBy(outboundMessages, (m) => m.sendStatus ?? 'unknown');

    const unansweredThreads = threads.filter(
      (t) =>
        t.lastInboundAt &&
        t.lastInboundAt >= period.start &&
        t.lastInboundAt <= period.end &&
        (!t.lastOutboundAt || t.lastOutboundAt < t.lastInboundAt),
    ).length;

    const responseTimes = this.computeResponseTimes(messagesByThread, period);

    const intentCounts = this.countBy(
      messages.map((m) => this.analysisField(m, 'intent')),
      (i) => i,
    );

    const leadInquiries = intentCounts.get('lead_inquiry') ?? 0;
    const pricingQuestions = intentCounts.get('pricing_question') ?? 0;
    const bookingRequests = intentCounts.get('booking_request') ?? 0;
    const invoiceRequests = intentCounts.get('invoice_request') ?? 0;
    const supportRequests = intentCounts.get('support_request') ?? 0;
    const complaints = intentCounts.get('complaint') ?? 0;
    const spam = intentCounts.get('spam') ?? 0;

    const topChannels = this.toChannelTopList(this.countBy(messages, (m) => m.channel));
    const topIntents = this.toIntentTopList(intentCounts);
    const topUrgencies = this.toUrgencyTopList(
      this.countBy(messages.map((m) => this.analysisField(m, 'urgency')), (u) => u),
    );
    const topSentiments = this.toSentimentTopList(
      this.countBy(messages.map((m) => this.analysisField(m, 'sentiment')), (s) => s),
    );
    const topTags = this.toTagTopList(this.flattenTags(threads));
    const topContacts = this.toContactTopList(this.countBy(threads, (t) => t.contactId ?? 'unknown'));

    return {
      totalThreads: threads.length,
      newThreads,
      openThreads: statusCounts.get('OPEN') ?? 0,
      waitingThreads: statusCounts.get('WAITING') ?? 0,
      doneThreads: statusCounts.get('DONE') ?? 0,
      archivedThreads: statusCounts.get('ARCHIVED') ?? 0,

      totalMessages: messages.length,
      inboundMessages: inboundMessages.length,
      outboundMessages: outboundMessages.length,

      draftReplies: sendStatusCounts.get('DRAFT') ?? 0,
      sentReplies: sendStatusCounts.get('SENT') ?? 0,
      failedReplies: sendStatusCounts.get('FAILED') ?? 0,
      notSupportedReplies: sendStatusCounts.get('NOT_SUPPORTED') ?? 0,

      urgentThreads: threads.filter((t) => t.priority === 'URGENT').length,
      highPriorityThreads: threads.filter((t) => t.priority === 'HIGH').length,
      unansweredThreads,

      averageFirstResponseMinutes: responseTimes.first.length
        ? Math.round(responseTimes.first.reduce((a, b) => a + b, 0) / responseTimes.first.length)
        : null,
      averageLastResponseMinutes: responseTimes.last.length
        ? Math.round(responseTimes.last.reduce((a, b) => a + b, 0) / responseTimes.last.length)
        : null,

      leadInquiries,
      pricingQuestions,
      bookingRequests,
      invoiceRequests,
      supportRequests,
      complaints,
      spam,

      topChannels,
      topIntents,
      topUrgencies,
      topSentiments,
      topTags,
      topContacts,
    };
  }

  buildTrends(current: KeyInboxIntelligenceMetrics, previous: KeyInboxIntelligenceMetrics): Record<string, MetricTrend> {
    const trends: Record<string, MetricTrend> = {};
    for (const key of TRACKED_TREND_KEYS) {
      const cur = Number(current[key]) || 0;
      const prev = Number(previous[key]) || 0;
      const delta = cur - prev;
      const deltaPercent = prev === 0 ? null : Math.round((delta / prev) * 1000) / 10;
      let direction: MetricTrend['direction'] = 'flat';
      if (delta > 0) direction = 'up';
      if (delta < 0) direction = 'down';
      trends[key] = { current: cur, previous: prev, delta, deltaPercent, direction };
    }
    return trends;
  }

  async collectEvidenceSamples(businessId: string, period: Period): Promise<EvidenceBundle> {
    const messages = await this.prisma.client.keyInboxMessage.findMany({
      where: {
        businessId,
        createdAt: { gte: period.start, lte: period.end },
      },
      select: {
        id: true,
        threadId: true,
        channel: true,
        direction: true,
        sendStatus: true,
        contentText: true,
        aiAnalysis: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const byIntent = (intent: string) =>
      messages
        .filter((m) => this.analysisField(m, 'intent') === intent)
        .slice(0, 5)
        .map((m) => this.toEvidence(m));

    const failed = messages
      .filter((m) => m.direction === 'OUTBOUND' && m.sendStatus === 'FAILED')
      .slice(0, 5)
      .map((m) => this.toEvidence(m));

    const notSupported = messages
      .filter((m) => m.direction === 'OUTBOUND' && m.sendStatus === 'NOT_SUPPORTED')
      .slice(0, 5)
      .map((m) => this.toEvidence(m));

    const threads = await this.prisma.client.keyInboxThread.findMany({
      where: {
        businessId,
        OR: [
          { lastMessageAt: { gte: period.start, lte: period.end } },
          { createdAt: { gte: period.start, lte: period.end } },
        ],
      },
      select: { id: true, channel: true, aiSummary: true, lastInboundAt: true, lastOutboundAt: true },
    });

    const unanswered = threads
      .filter(
        (t) =>
          t.lastInboundAt &&
          t.lastInboundAt >= period.start &&
          t.lastInboundAt <= period.end &&
          (!t.lastOutboundAt || t.lastOutboundAt < t.lastInboundAt),
      )
      .slice(0, 5)
      .map((t) => ({
        threadId: t.id,
        channel: t.channel,
        excerpt: t.aiSummary ?? 'Unanswered thread',
        lastInboundAt: t.lastInboundAt ?? new Date(),
      }));

    return {
      leads: byIntent('lead_inquiry'),
      pricing: byIntent('pricing_question'),
      bookings: byIntent('booking_request'),
      invoices: byIntent('invoice_request'),
      complaints: byIntent('complaint'),
      failed,
      notSupported,
      unanswered,
    };
  }

  private async generateAiReport(
    businessId: string,
    scope: IntelligenceScope,
    period: Period,
    metrics: KeyInboxIntelligenceMetrics,
    trends: Record<string, MetricTrend>,
    evidence: EvidenceBundle,
  ): Promise<KeyInboxIntelligenceReportContent> {
    const systemPrompt = `You are KEYInbox Intelligence, the omnichannel business communication analyst for KEYFlowOS.
You analyze business conversations across email, WhatsApp, forms, Meta, website chat, and other active channels.
Use only the provided metrics, trends, and evidence. Do not invent numbers. Return only valid JSON.`;

    const userPrompt = `Generate an intelligence report for business ${businessId}.
Scope: ${scope}
Period: ${period.start.toISOString()} to ${period.end.toISOString()}

Metrics:
${JSON.stringify(metrics, null, 2)}

Trends (current vs previous period):
${JSON.stringify(trends, null, 2)}

Evidence samples:
${JSON.stringify(evidence, null, 2)}

Return ONLY valid JSON matching this exact schema:
{
  "executiveSummary": "string",
  "keyFindings": ["string"],
  "recommendations": ["string"],
  "taskSuggestions": ["string"],
  "insights": [
    {
      "type": "LEAD_OPPORTUNITY|REVENUE_OPPORTUNITY|CUSTOMER_COMPLAINT|OPERATIONAL_RISK|FOLLOW_UP_GAP|CHANNEL_PERFORMANCE|PRICING_SIGNAL|BOOKING_SIGNAL|INVOICE_SIGNAL|SUPPORT_SIGNAL|OFFER_CONFUSION|REPEATED_QUESTION|GENOME_SIGNAL",
      "severity": "LOW|MEDIUM|HIGH|CRITICAL",
      "title": "string",
      "description": "string",
      "evidence": ["string"],
      "relatedThreadIds": ["string"],
      "relatedMessageIds": ["string"],
      "suggestedAction": { "type": "string", "label": "string", "payload": {} }
    }
  ],
  "genomeSignals": [
    {
      "signalType": "pricing_objection_detected|lead_source_detected|complaint_pattern_detected|support_risk_detected|offer_confusion_detected|recurring_offer_interest|booking_request_pattern|response_time_risk",
      "section": "string",
      "domain": "string",
      "title": "string",
      "reason": "string",
      "confidence": 0.0-1.0,
      "evidence": [{ "threadId": "string", "messageId": "string", "channel": "string", "excerpt": "string" }]
    }
  ],
  "channelBreakdown": { "channelName": number }
}`;

    const response = await this.aiUsage.trackAndComplete(
      businessId,
      undefined,
      'key_inbox_intelligence',
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        taskCategory: 'analysis',
        temperature: 0.3,
        maxTokens: 3000,
      },
    );

    const raw = (response.content ?? '').trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw) as Partial<KeyInboxIntelligenceReport>;

    return {
      executiveSummary: typeof parsed.executiveSummary === 'string' ? parsed.executiveSummary : this.fallbackSummary(scope, metrics),
      keyFindings: Array.isArray(parsed.keyFindings) ? parsed.keyFindings.map(String) : [],
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.map(String) : [],
      taskSuggestions: Array.isArray(parsed.taskSuggestions) ? parsed.taskSuggestions.map(String) : [],
      metrics,
      trends,
      insights: Array.isArray(parsed.insights) ? parsed.insights : [],
      genomeSignals: Array.isArray(parsed.genomeSignals) ? parsed.genomeSignals : [],
      channelBreakdown:
        parsed.channelBreakdown && typeof parsed.channelBreakdown === 'object'
          ? (parsed.channelBreakdown as Record<string, number>)
          : this.buildChannelBreakdown(metrics.topChannels),
      generatedBy: 'ai',
      reportVersion: 1,
    };
  }

  private buildFallbackReport(
    scope: IntelligenceScope,
    metrics: KeyInboxIntelligenceMetrics,
    trends: Record<string, MetricTrend>,
  ): KeyInboxIntelligenceReportContent {
    const findings: string[] = [
      `${metrics.totalMessages} messages (${metrics.inboundMessages} inbound, ${metrics.outboundMessages} outbound) during this ${scope.toLowerCase()} period.`,
      `${metrics.totalThreads} threads, ${metrics.openThreads} open and ${metrics.unansweredThreads} unanswered.`,
    ];

    if (metrics.urgentThreads > 0) findings.push(`${metrics.urgentThreads} urgent threads require attention.`);
    if (metrics.failedReplies > 0) findings.push(`${metrics.failedReplies} outbound replies failed to send.`);
    if (metrics.leadInquiries > 0) findings.push(`${metrics.leadInquiries} lead inquiries detected.`);
    if (metrics.pricingQuestions > 0) findings.push(`${metrics.pricingQuestions} pricing questions detected.`);

    const insights: KeyInboxIntelligenceInsight[] = [];
    if (metrics.unansweredThreads > 0) {
      insights.push({
        type: 'FOLLOW_UP_GAP',
        severity: metrics.unansweredThreads > 5 ? 'HIGH' : 'MEDIUM',
        title: 'Unanswered threads need follow-up',
        description: `${metrics.unansweredThreads} threads received inbound messages without a reply.`,
        evidence: [`unansweredThreads: ${metrics.unansweredThreads}`],
      });
    }
    if (metrics.failedReplies > 0) {
      insights.push({
        type: 'OPERATIONAL_RISK',
        severity: 'HIGH',
        title: 'Outbound reply failures detected',
        description: `${metrics.failedReplies} replies failed to send. Review channel configuration and retry.`,
        evidence: [`failedReplies: ${metrics.failedReplies}`],
      });
    }
    if (metrics.pricingQuestions > 0) {
      insights.push({
        type: 'PRICING_SIGNAL',
        severity: 'MEDIUM',
        title: 'Pricing questions detected',
        description: `${metrics.pricingQuestions} pricing questions were recorded this period.`,
        evidence: [`pricingQuestions: ${metrics.pricingQuestions}`],
      });
    }

    return {
      executiveSummary: this.fallbackSummary(scope, metrics),
      keyFindings: findings,
      recommendations: [],
      taskSuggestions: metrics.unansweredThreads > 0 ? ['Follow up on unanswered threads'] : [],
      metrics,
      trends,
      insights,
      genomeSignals: [],
      channelBreakdown: this.buildChannelBreakdown(metrics.topChannels),
      generatedBy: 'fallback',
      reportVersion: 1,
    };
  }

  private async persistReport(
    businessId: string,
    scope: IntelligenceScope,
    period: Period,
    report: KeyInboxIntelligenceReportContent,
    generatedBy: 'ai' | 'fallback',
    userId?: string,
  ): Promise<KeyInboxInsight> {
    return this.prisma.client.keyInboxInsight.create({
      data: {
        businessId,
        periodStart: period.start,
        periodEnd: period.end,
        scope,
        summary: report.executiveSummary,
        keyFindings: report.keyFindings,
        recommendations: report.recommendations,
        taskSuggestions: report.taskSuggestions,
        metrics: report.metrics as unknown as Record<string, unknown>,
        trends: report.trends as unknown as Record<string, unknown>,
        insights: report.insights as unknown[],
        channelBreakdown: report.channelBreakdown,
        genomeSignals: report.genomeSignals as unknown[],
        reportVersion: report.reportVersion,
        generatedBy,
      },
    });
  }

  private async emitIntelligenceEvents(
    businessId: string,
    insight: KeyInboxInsight,
    report: KeyInboxIntelligenceReportContent,
  ): Promise<void> {
    await this.temporalEmitter.emitIntelligenceGenerated(
      businessId,
      insight.id,
      insight.scope,
      insight.periodStart,
      insight.periodEnd,
      report.generatedBy ?? 'fallback',
    );

    for (const insightItem of report.insights ?? []) {
      if (
        ['LEAD_OPPORTUNITY', 'REVENUE_OPPORTUNITY', 'BOOKING_SIGNAL', 'INVOICE_SIGNAL'].includes(
          insightItem.type,
        )
      ) {
        await this.temporalEmitter.emitOpportunityDetected(
          businessId,
          insight.id,
          insight.scope,
          insight.periodStart,
          insight.periodEnd,
          insightItem,
        );
      } else if (
        ['CUSTOMER_COMPLAINT', 'OPERATIONAL_RISK', 'SUPPORT_SIGNAL', 'FOLLOW_UP_GAP'].includes(
          insightItem.type,
        )
      ) {
        await this.temporalEmitter.emitRiskDetected(
          businessId,
          insight.id,
          insight.scope,
          insight.periodStart,
          insight.periodEnd,
          insightItem,
        );
      }
    }

    for (const signal of report.genomeSignals ?? []) {
      await this.temporalEmitter.emitGenomeSignalDetected(
        businessId,
        insight.id,
        insight.scope,
        insight.periodStart,
        insight.periodEnd,
        signal,
      );
    }

    for (const [key, trend] of Object.entries(report.trends ?? {})) {
      if (this.isSignificantTrend(trend)) {
        await this.temporalEmitter.emitTrendDetected(
          businessId,
          insight.id,
          insight.scope,
          insight.periodStart,
          insight.periodEnd,
          key,
          trend,
        );
      }
    }
  }

  private isSignificantTrend(trend: MetricTrend): boolean {
    if (Math.abs(trend.delta) >= 5) return true;
    if (trend.deltaPercent !== null && Math.abs(trend.deltaPercent) >= 50) return true;
    return false;
  }

  private toReport(insight: KeyInboxInsight): KeyInboxIntelligenceReport {
    return {
      id: insight.id,
      businessId: insight.businessId,
      scope: insight.scope as IntelligenceScope,
      periodStart: insight.periodStart.toISOString(),
      periodEnd: insight.periodEnd.toISOString(),
      executiveSummary: insight.summary,
      keyFindings: (insight.keyFindings as string[]) ?? [],
      recommendations: (insight.recommendations as string[]) ?? [],
      taskSuggestions: (insight.taskSuggestions as string[]) ?? [],
      metrics: (insight.metrics as unknown as KeyInboxIntelligenceMetrics) ?? ({} as KeyInboxIntelligenceMetrics),
      trends: (insight.trends as unknown as Record<string, MetricTrend>) ?? {},
      insights: (insight.insights as unknown as KeyInboxIntelligenceInsight[]) ?? [],
      genomeSignals: (insight.genomeSignals as unknown as GenomeSignalPreview[]) ?? [],
      channelBreakdown: (insight.channelBreakdown as unknown as Record<string, number>) ?? {},
      generatedBy: insight.generatedBy ?? undefined,
      reportVersion: insight.reportVersion,
      createdAt: insight.createdAt.toISOString(),
    };
  }

  private computeResponseTimes(
    messagesByThread: Map<string, KeyInboxMessage[]>,
    period: Period,
  ): { first: number[]; last: number[] } {
    const first: number[] = [];
    const last: number[] = [];

    for (const list of messagesByThread.values()) {
      const inPeriod = list
        .filter((m) => m.createdAt >= period.start && m.createdAt <= period.end)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const inbound = inPeriod.filter((m) => m.direction === 'INBOUND');
      const outbound = inPeriod.filter((m) => m.direction === 'OUTBOUND');

      if (inbound.length === 0 || outbound.length === 0) continue;

      const firstInbound = inbound[0];
      const firstOutbound = outbound.find((m) => m.createdAt > firstInbound.createdAt);
      if (firstOutbound) {
        first.push(
          Math.round((firstOutbound.createdAt.getTime() - firstInbound.createdAt.getTime()) / 60000),
        );
      }

      const lastInbound = inbound[inbound.length - 1];
      const lastOutbound = [...outbound].reverse().find((m) => m.createdAt > lastInbound.createdAt);
      if (lastOutbound) {
        last.push(
          Math.round((lastOutbound.createdAt.getTime() - lastInbound.createdAt.getTime()) / 60000),
        );
      }
    }

    return { first, last };
  }

  private analysisField(message: { aiAnalysis?: unknown }, field: string): string | null {
    const analysis = message.aiAnalysis as Record<string, unknown> | null;
    const value = analysis?.[field];
    return typeof value === 'string' ? value.toLowerCase() : null;
  }

  private toEvidence(message: {
    id: string;
    threadId: string;
    channel: string;
    contentText?: string | null;
    aiAnalysis?: unknown;
  }): EvidenceSample {
    return {
      threadId: message.threadId,
      messageId: message.id,
      channel: message.channel,
      intent: this.analysisField(message, 'intent') ?? undefined,
      excerpt: this.truncate(message.contentText ?? '', 200),
    };
  }

  private buildChannelBreakdown(topChannels: Array<{ channel: string; count: number }>): Record<string, number> {
    return Object.fromEntries(topChannels.map((c) => [c.channel, c.count]));
  }

  private fallbackSummary(scope: IntelligenceScope, metrics: KeyInboxIntelligenceMetrics): string {
    return `Inbox intelligence for the ${scope.toLowerCase()} period: ${metrics.totalMessages} messages across ${metrics.totalThreads} threads, ${metrics.openThreads} threads still open.`;
  }

  private countBy<T>(items: T[], keyFn: (item: T) => string | null | undefined): Map<string, number> {
    const counts = new Map<string, number>();
    for (const item of items) {
      const key = keyFn(item);
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }

  private toChannelTopList(counts: Map<string, number>): Array<{ channel: string; count: number }> {
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([channel, count]) => ({ channel, count }));
  }

  private toIntentTopList(counts: Map<string, number>): Array<{ intent: string; count: number }> {
    return Array.from(counts.entries())
      .filter(([intent]) => intent !== 'unknown')
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([intent, count]) => ({ intent, count }));
  }

  private toUrgencyTopList(counts: Map<string, number>): Array<{ urgency: string; count: number }> {
    return Array.from(counts.entries())
      .filter(([urgency]) => urgency !== 'unknown')
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([urgency, count]) => ({ urgency, count }));
  }

  private toSentimentTopList(counts: Map<string, number>): Array<{ sentiment: string; count: number }> {
    return Array.from(counts.entries())
      .filter(([sentiment]) => sentiment !== 'unknown')
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([sentiment, count]) => ({ sentiment, count }));
  }

  private toTagTopList(counts: Map<string, number>): Array<{ tag: string; count: number }> {
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count }));
  }

  private toContactTopList(counts: Map<string, number>): Array<{ contactId: string | null; count: number }> {
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([key, count]) => ({ contactId: key === 'unknown' ? null : key, count }));
  }

  private flattenTags(threads: { aiTags: string[] }[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const t of threads) {
      for (const tag of t.aiTags ?? []) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return counts;
  }

  private truncate(text: string, maxLength: number): string {
    if (!text) return '';
    return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
  }
}
