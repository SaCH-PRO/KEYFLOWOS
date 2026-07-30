import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ModelGatewayService } from './model-gateway.service';
import { AiMemoryService } from './ai-memory.service';
import { AiUsageService } from './ai-usage.service';

export interface DetectedPattern {
  id: string;
  category: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  affectedEntities: Array<{ type: string; id: string; label: string }>;
  confidence: number;
  suggestedAction: string;
  suggestedTool?: string;
}

export interface PatternScanResult {
  patterns: DetectedPattern[];
  scanDurationMs: number;
  entitiesScanned: number;
}

@Injectable()
export class PatternDetectorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PatternDetectorService.name);
  private scanInterval: NodeJS.Timeout | null = null;
  private readonly SCAN_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(ModelGatewayService) private readonly gateway: ModelGatewayService,
    @Inject(AiMemoryService) private readonly memory: AiMemoryService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
  ) {}

  onModuleInit() {
    this.scanInterval = setInterval(() => this.runAllScans(), this.SCAN_INTERVAL_MS);
    this.logger.log(`Pattern detector scanning every ${this.SCAN_INTERVAL_MS}ms`);
    // Run initial scan after 60s to avoid startup noise
    setTimeout(() => this.runAllScans(), 60_000);
  }

  onModuleDestroy() {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
  }

  async runAllScans(): Promise<void> {
    const businesses = await this.prisma.client.business.findMany({
      select: { id: true },
      take: 50,
    });

    for (const biz of businesses) {
      try {
        await this.scanBusiness(biz.id);
      } catch (err: any) {
        this.logger.error(`Pattern scan failed for ${biz.id}: ${(err as Error).message}`);
      }
    }
  }

  async scanBusiness(businessId: string): Promise<PatternScanResult> {
    const startTime = Date.now();

    const [
      tickets,
      bookings,
      contacts,
      invoices,
    ] = await Promise.all([
      this.fetchRecentSupportTickets(businessId),
      this.fetchRecentBookings(businessId),
      this.fetchRecentContactEvents(businessId),
      this.fetchRecentInvoices(businessId),
    ]);

    const entitiesScanned = tickets.length + bookings.length + contacts.length + invoices.length;

    // Run local pattern detection first (fast, no AI cost)
    const localPatterns = this.detectLocalPatterns(businessId, tickets, bookings, contacts, invoices);

    // Run AI-powered pattern detection for complex clusters
    const aiPatterns = await this.detectAiPatterns(businessId, tickets, bookings, contacts);

    const allPatterns = [...localPatterns, ...aiPatterns];

    // Store patterns and emit events
    for (const pattern of allPatterns) {
      await this.memory.upsert(businessId, {
        category: 'patterns',
        key: `pattern_${pattern.category}_${Date.now()}`,
        value: JSON.stringify(pattern),
        confidence: pattern.confidence,
        source: 'pattern_analysis',
      }).catch(() => {});

      this.events.emit('pattern.detected', {
        businessId,
        pattern,
      });
    }

    return {
      patterns: allPatterns,
      scanDurationMs: Date.now() - startTime,
      entitiesScanned,
    };
  }

  private async fetchRecentSupportTickets(businessId: string) {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return this.prisma.client.supportTicket.findMany({
      where: { businessId, createdAt: { gte: since } },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        orgUnitId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  private async fetchRecentBookings(businessId: string) {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return this.prisma.client.booking.findMany({
      where: { businessId, createdAt: { gte: since } },
      select: {
        id: true,
        status: true,
        startTime: true,
        orgUnitId: true,
        contactId: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  private async fetchRecentContactEvents(businessId: string) {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return this.prisma.client.contactEvent.findMany({
      where: { businessId, createdAt: { gte: since } },
      select: {
        id: true,
        type: true,
        contactId: true,
        data: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  private async fetchRecentInvoices(businessId: string) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    return this.prisma.client.invoice.findMany({
      where: { businessId, createdAt: { gte: since }, deletedAt: null },
      select: {
        id: true,
        total: true,
        status: true,
        dueDate: true,
        contactId: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  private detectLocalPatterns(
    businessId: string,
    tickets: any[],
    bookings: any[],
    contacts: any[],
    invoices: any[],
  ): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];

    // Pattern: Multiple support tickets about same subject (cluster by keyword)
    const subjectGroups = new Map<string, any[]>();
    for (const ticket of tickets) {
      const key = ticket.title?.toLowerCase().trim() ?? 'unknown';
      if (!subjectGroups.has(key)) subjectGroups.set(key, []);
      subjectGroups.get(key)!.push(ticket);
    }
    for (const [subject, group] of subjectGroups.entries()) {
      if (group.length >= 3) {
        patterns.push({
          id: `ticket_cluster_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          category: 'support_cluster',
          severity: 'warning',
          title: `Multiple tickets about "${subject}"`,
          description: `${group.length} support tickets in the last 7 days about the same topic. This may indicate a systemic issue.`,
          affectedEntities: group.map((t) => ({ type: 'supportTicket', id: t.id, label: t.title })),
          confidence: Math.min(0.7 + group.length * 0.05, 0.95),
          suggestedAction: 'Create a task for operations to investigate and address the root cause',
          suggestedTool: 'create_task',
        });
      }
    }

    // Pattern: Multiple missed/cancelled bookings at same org unit
    const cancelledBookings = bookings.filter((b) => b.status === 'CANCELLED' || b.status === 'NO_SHOW');
    const orgUnitGroups = new Map<string, any[]>();
    for (const b of cancelledBookings) {
      const key = b.orgUnitId ?? 'unassigned';
      if (!orgUnitGroups.has(key)) orgUnitGroups.set(key, []);
      orgUnitGroups.get(key)!.push(b);
    }
    for (const [orgUnitId, group] of orgUnitGroups.entries()) {
      if (group.length >= 3) {
        patterns.push({
          id: `booking_cluster_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          category: 'booking_cancellation_cluster',
          severity: 'critical',
          title: `High cancellation rate at branch/team`,
          description: `${group.length} cancelled or no-show bookings in the last 7 days. This may indicate scheduling, staffing, or customer satisfaction issues.`,
          affectedEntities: group.map((b) => ({ type: 'booking', id: b.id, label: b.status })),
          confidence: Math.min(0.75 + group.length * 0.03, 0.95),
          suggestedAction: 'Alert branch manager and review scheduling patterns',
          suggestedTool: 'fetch_business_summary',
        });
      }
    }

    // Pattern: Multiple overdue invoices from same contact
    const now = new Date();
    const overdueInvoices = invoices.filter((inv) => inv.status !== 'PAID' && inv.dueDate && new Date(inv.dueDate) < now);
    const contactInvoiceGroups = new Map<string, any[]>();
    for (const inv of overdueInvoices) {
      const key = inv.contactId ?? 'unknown';
      if (!contactInvoiceGroups.has(key)) contactInvoiceGroups.set(key, []);
      contactInvoiceGroups.get(key)!.push(inv);
    }
    for (const [contactId, group] of contactInvoiceGroups.entries()) {
      if (group.length >= 2) {
        const total = group.reduce((sum, inv) => sum + (inv.total ?? 0), 0);
        patterns.push({
          id: `overdue_cluster_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          category: 'overdue_invoice_cluster',
          severity: 'critical',
          title: `Repeat late payer detected`,
          description: `${group.length} overdue invoices totaling ${total}. This customer may need a payment plan or collection follow-up.`,
          affectedEntities: group.map((inv) => ({ type: 'invoice', id: inv.id, label: `Overdue: ${inv.total}` })),
          confidence: 0.85,
          suggestedAction: 'Send payment reminder and consider payment plan',
          suggestedTool: 'commerce_send_payment_reminder',
        });
      }
    }

    // Pattern: Revenue drop vs last week
    const thisWeekInvoices = invoices.filter((inv) => {
      const d = new Date(inv.createdAt);
      return d > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    });
    const lastWeekInvoices = invoices.filter((inv) => {
      const d = new Date(inv.createdAt);
      const now7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const now14 = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      return d >= now14 && d < now7;
    });
    const thisWeekRevenue = thisWeekInvoices.reduce((sum, inv) => sum + (inv.total ?? 0), 0);
    const lastWeekRevenue = lastWeekInvoices.reduce((sum, inv) => sum + (inv.total ?? 0), 0);
    if (lastWeekRevenue > 0 && thisWeekRevenue < lastWeekRevenue * 0.8) {
      const drop = Math.round(((lastWeekRevenue - thisWeekRevenue) / lastWeekRevenue) * 100);
      patterns.push({
        id: `revenue_drop_${Date.now()}`,
        category: 'revenue_drop',
        severity: 'critical',
        title: `Revenue dropped ${drop}% vs last week`,
        description: `This week's revenue (${thisWeekRevenue}) is ${drop}% lower than last week (${lastWeekRevenue}). Investigate causes immediately.`,
        affectedEntities: [],
        confidence: 0.9,
        suggestedAction: 'Analyze booking pipeline and contact at-risk leads',
        suggestedTool: 'fetch_business_summary',
      });
    }

    return patterns;
  }

  private async detectAiPatterns(
    businessId: string,
    tickets: any[],
    bookings: any[],
    contacts: any[],
  ): Promise<DetectedPattern[]> {
    if (tickets.length < 2 && bookings.length < 2) return [];

    try {
      const prompt = `Analyze the following business data for patterns, anomalies, and actionable insights.

Support Tickets (${tickets.length}):
${tickets.slice(0, 20).map((t) => `- [${t.status}] ${t.title}`).join('\n')}

Bookings (${bookings.length}):
${bookings.slice(0, 20).map((b) => `- [${b.status}] ${b.startTime ? new Date(b.startTime).toLocaleDateString() : 'no date'}`).join('\n')}

Contact Events (${contacts.length}):
${contacts.slice(0, 15).map((c) => `- [${c.type}]`).join('\n')}

Identify up to 3 patterns that suggest a problem or opportunity. For each pattern, provide:
- category: one of [support_quality, scheduling_efficiency, customer_satisfaction, revenue_risk, operational_gap]
- severity: one of [critical, warning, info]
- title: concise headline
- description: 1-2 sentences explaining the pattern
- suggestedAction: what should be done
- confidence: 0.0 to 1.0

Respond with JSON only: { "patterns": [...] }`;

      const response = await this.aiUsage.trackAndComplete(
        businessId,
        undefined,
        'pattern_detect',
        {
          messages: [
            { role: 'system', content: 'You are a business operations analyst. Detect patterns and anomalies in operational data.' },
            { role: 'user', content: prompt },
          ],
          maxTokens: 800,
          temperature: 0.3,
        },
      );

      const content = response.content?.trim() ?? '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]);
      const rawPatterns = Array.isArray(parsed.patterns) ? parsed.patterns : [];

      return rawPatterns.map((p: any) => ({
        id: `ai_pattern_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        category: p.category ?? 'operational_gap',
        severity: p.severity ?? 'info',
        title: p.title ?? 'Pattern detected',
        description: p.description ?? '',
        affectedEntities: [],
        confidence: Math.min(Math.max(p.confidence ?? 0.5, 0), 1),
        suggestedAction: p.suggestedAction ?? 'Review the data manually',
      }));
    } catch (err: any) {
      this.logger.warn(`AI pattern detection failed: ${(err as Error).message}`);
      return [];
    }
  }
}
