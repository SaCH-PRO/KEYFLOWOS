import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from '../ai/ai-usage.service';
import { RevenueForecastService, RevenueForecast } from './revenue-forecast.service';
import { SlowPayerDetector, SlowPayerReport } from './slow-payer-detector.service';
import { PricingSignalsService, PricingSignalsReport } from './pricing-signals.service';
import { RevenueActionService } from './revenue-action.service';

export interface RevenueBriefingChase {
  id: string;
  title: string;
  detail: string;
  amountAtRisk?: number | null;
  contactId?: string | null;
  relatedType?: string | null;
  relatedId?: string | null;
}

export interface RevenueBriefing {
  whatChanged: string[];
  whatsAtRisk: string[];
  whatToChase: RevenueBriefingChase[];
  whatToPlan: string[];
  headline: string;
  source: 'ai' | 'fallback';
}

export interface RevenueBriefingSnapshot {
  businessId: string;
  generatedAt: string;
  expiresAt: string;
  briefing: RevenueBriefing;
  forecast: RevenueForecast;
  slowPayers: SlowPayerReport;
  pricingSignals: PricingSignalsReport;
  inputs: {
    overdueCount: number;
    overdueTotal: number;
    pendingQuoteCount: number;
    pendingQuoteTotal: number;
  };
}

const CACHE_TTL_MS = 6 * 3600_000; // 6 hours

@Injectable()
export class RevenueBriefingService {
  private readonly logger = new Logger(RevenueBriefingService.name);
  private readonly cache = new Map<string, RevenueBriefingSnapshot>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
    @Inject(RevenueForecastService) private readonly forecastSvc: RevenueForecastService,
    @Inject(SlowPayerDetector) private readonly slowPayerSvc: SlowPayerDetector,
    @Inject(PricingSignalsService) private readonly pricingSvc: PricingSignalsService,
    @Inject(RevenueActionService) private readonly revenueActions: RevenueActionService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  async getOrGenerate(businessId: string): Promise<RevenueBriefingSnapshot> {
    const cached = this.cache.get(businessId);
    if (cached && new Date(cached.expiresAt).getTime() > Date.now()) {
      return cached;
    }
    return this.generate(businessId);
  }

  async generate(businessId: string): Promise<RevenueBriefingSnapshot> {
    const [forecast, slowPayers, pricingSignals, biz, openInvoices, pendingQuotes] = await Promise.all([
      this.forecastSvc.compute(businessId),
      this.slowPayerSvc.detect(businessId),
      this.pricingSvc.detect(businessId),
      this.db.business.findUnique({ where: { id: businessId }, select: { name: true, currency: true, industry: true } }),
      this.db.invoice.findMany({
        where: { businessId, deletedAt: null, status: { in: ['SENT', 'OVERDUE', 'PARTIALLY_PAID'] } },
        select: {
          id: true, invoiceNumber: true, total: true, dueDate: true, status: true,
          contact: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
        orderBy: { total: 'desc' },
        take: 20,
      }),
      this.db.quote.findMany({
        where: { businessId, deletedAt: null, status: { in: ['SENT', 'ACCEPTED'] }, invoiceId: null },
        select: {
          id: true, quoteNumber: true, total: true, status: true, sentAt: true,
          contact: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
        orderBy: { total: 'desc' },
        take: 20,
      }),
    ]);

    const now = new Date();
    const overdueInv = openInvoices.filter(
      (i) => i.status === 'OVERDUE' || (i.dueDate && new Date(i.dueDate) < now),
    );
    const overdueTotal = overdueInv.reduce((s, i) => s + Number(i.total ?? 0), 0);
    const pendingQuoteTotal = pendingQuotes.reduce((s, q) => s + Number(q.total ?? 0), 0);
    const currency = biz?.currency ?? 'TTD';

    let briefing: RevenueBriefing;
    try {
      briefing = await this.callAi(businessId, {
        businessName: biz?.name ?? 'Your business',
        currency,
        forecast,
        slowPayers,
        pricingSignals,
        overdueInv,
        pendingQuotes,
      });
    } catch (e) {
      this.logger.warn(`AI briefing failed: ${(e as Error).message}; using fallback`);
      briefing = this.buildFallback(forecast, slowPayers, pricingSignals, overdueInv, pendingQuotes, currency);
    }

    const snapshot: RevenueBriefingSnapshot = {
      businessId,
      generatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + CACHE_TTL_MS).toISOString(),
      briefing,
      forecast,
      slowPayers,
      pricingSignals,
      inputs: {
        overdueCount: overdueInv.length,
        overdueTotal: Math.round(overdueTotal * 100) / 100,
        pendingQuoteCount: pendingQuotes.length,
        pendingQuoteTotal: Math.round(pendingQuoteTotal * 100) / 100,
      },
    };
    this.cache.set(businessId, snapshot);
    return snapshot;
  }

  private async callAi(
    businessId: string,
    ctx: {
      businessName: string;
      currency: string;
      forecast: RevenueForecast;
      slowPayers: SlowPayerReport;
      pricingSignals: PricingSignalsReport;
      overdueInv: Array<{ id: string; invoiceNumber: string; total: number; contact: { id: string; firstName: string | null; lastName: string | null; email: string | null } | null }>;
      pendingQuotes: Array<{ id: string; quoteNumber: string; total: number; contact: { id: string; firstName: string | null; lastName: string | null; email: string | null } | null }>;
    },
  ): Promise<RevenueBriefing> {
    const top = (arr: Array<{ contact: { firstName: string | null; lastName: string | null; email: string | null } | null }>) =>
      arr.slice(0, 5).map((x) => {
        const c = x.contact;
        return c ? `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || c.email : 'Unknown';
      });

    const payload = JSON.stringify({
      currency: ctx.currency,
      forecast: {
        totalExpected: ctx.forecast.totalExpected,
        totalBest: ctx.forecast.totalBest,
        totalWorst: ctx.forecast.totalWorst,
        confidence: ctx.forecast.confidence,
      },
      overdue: { count: ctx.overdueInv.length, top: top(ctx.overdueInv) },
      pendingQuotes: { count: ctx.pendingQuotes.length, top: top(ctx.pendingQuotes) },
      slowPayers: ctx.slowPayers.slowPayers.slice(0, 5).map((s) => ({
        name: s.contactName, avgDays: s.avgDaysToPay, owed: s.outstandingTotal,
      })),
      pricingSignals: ctx.pricingSignals.signals.slice(0, 5).map((s) => ({
        product: s.productName, signal: s.signal, marginPct: s.grossMarginPct, units: s.unitsSold90d,
      })),
    });

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'revenue_briefing',
      responseMode: 'structured_json',
      maxTokens: 900,
      temperature: 0.4,
      messages: [
        {
          role: 'system',
          content:
            `You are the revenue copilot for a Caribbean small business. Produce a forward-looking briefing. ` +
            `Be specific and actionable. Use ${ctx.currency} for currency. Respond ONLY with valid JSON ` +
            `matching this exact schema (no markdown, no code fences):\n` +
            `{"headline":"one-sentence summary","whatChanged":["...","..."],` +
            `"whatsAtRisk":["...","..."],"whatToChase":[{"title":"...","detail":"...","amountAtRisk":0}],` +
            `"whatToPlan":["...","..."]}`,
        },
        {
          role: 'user',
          content:
            `Business: ${ctx.businessName}\n` +
            `Data payload:\n${payload}\n\n` +
            `Generate the four-section briefing. whatToChase should be 3–5 high-leverage chase items ` +
            `(overdue invoices, stale quotes, slow payers). Each chase item must have title (short), ` +
            `detail (one sentence), and amountAtRisk (number, 0 if unknown).`,
        },
      ],
    });

    let parsed: {
      headline?: string;
      whatChanged?: string[];
      whatsAtRisk?: string[];
      whatToChase?: Array<{ title?: string; detail?: string; amountAtRisk?: number }>;
      whatToPlan?: string[];
    };
    try {
      const cleaned = result.content.trim().replace(/^```json\s*|\s*```$/g, '');
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error('Failed to parse AI JSON');
    }

    return this.normalize(parsed, ctx, 'ai');
  }

  private normalize(
    parsed: {
      headline?: string;
      whatChanged?: string[];
      whatsAtRisk?: string[];
      whatToChase?: Array<{ title?: string; detail?: string; amountAtRisk?: number }>;
      whatToPlan?: string[];
    },
    ctx: {
      overdueInv: Array<{ id: string; invoiceNumber: string; total: number; contact: { id: string; firstName: string | null; lastName: string | null; email: string | null } | null }>;
      pendingQuotes: Array<{ id: string; quoteNumber: string; total: number; contact: { id: string; firstName: string | null; lastName: string | null; email: string | null } | null }>;
    },
    source: 'ai' | 'fallback',
  ): RevenueBriefing {
    const chases: RevenueBriefingChase[] = [];
    const incoming = Array.isArray(parsed.whatToChase) ? parsed.whatToChase : [];
    incoming.slice(0, 6).forEach((item, idx) => {
      const title = (item?.title ?? '').toString().trim() || `Chase #${idx + 1}`;
      const detail = (item?.detail ?? '').toString().trim();
      const amt = typeof item?.amountAtRisk === 'number' ? item.amountAtRisk : null;
      // Try to bind to a known invoice/quote/contact by partial title match.
      const match = this.matchSource(title, detail, ctx);
      chases.push({
        id: `chase-${idx}-${Date.now().toString(36)}`,
        title,
        detail,
        amountAtRisk: amt,
        contactId: match?.contactId ?? null,
        relatedType: match?.relatedType ?? null,
        relatedId: match?.relatedId ?? null,
      });
    });

    return {
      headline: (parsed.headline ?? '').toString().trim() || 'Here is your revenue briefing.',
      whatChanged: this.stringArr(parsed.whatChanged),
      whatsAtRisk: this.stringArr(parsed.whatsAtRisk),
      whatToChase: chases,
      whatToPlan: this.stringArr(parsed.whatToPlan),
      source,
    };
  }

  private matchSource(
    title: string,
    detail: string,
    ctx: {
      overdueInv: Array<{ id: string; invoiceNumber: string; contact: { id: string; firstName: string | null; lastName: string | null; email: string | null } | null }>;
      pendingQuotes: Array<{ id: string; quoteNumber: string; contact: { id: string; firstName: string | null; lastName: string | null; email: string | null } | null }>;
    },
  ): { relatedType: string; relatedId: string; contactId: string | null } | null {
    const haystack = `${title} ${detail}`.toLowerCase();
    for (const inv of ctx.overdueInv) {
      if (inv.invoiceNumber && haystack.includes(inv.invoiceNumber.toLowerCase())) {
        return { relatedType: 'invoice', relatedId: inv.id, contactId: inv.contact?.id ?? null };
      }
    }
    for (const q of ctx.pendingQuotes) {
      if (q.quoteNumber && haystack.includes(q.quoteNumber.toLowerCase())) {
        return { relatedType: 'quote', relatedId: q.id, contactId: q.contact?.id ?? null };
      }
    }
    // Try contact name match
    for (const inv of ctx.overdueInv) {
      const c = inv.contact;
      const name = c ? `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim().toLowerCase() : '';
      if (name && haystack.includes(name)) {
        return { relatedType: 'invoice', relatedId: inv.id, contactId: c?.id ?? null };
      }
    }
    for (const q of ctx.pendingQuotes) {
      const c = q.contact;
      const name = c ? `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim().toLowerCase() : '';
      if (name && haystack.includes(name)) {
        return { relatedType: 'quote', relatedId: q.id, contactId: c?.id ?? null };
      }
    }
    return null;
  }

  private stringArr(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return v.filter((x) => typeof x === 'string' && x.trim().length > 0).slice(0, 6).map((x) => (x as string).trim());
  }

  private buildFallback(
    forecast: RevenueForecast,
    slowPayers: SlowPayerReport,
    pricingSignals: PricingSignalsReport,
    overdueInv: Array<{ id: string; invoiceNumber: string; total: number; contact: { id: string; firstName: string | null; lastName: string | null; email: string | null } | null }>,
    pendingQuotes: Array<{ id: string; quoteNumber: string; total: number; contact: { id: string; firstName: string | null; lastName: string | null; email: string | null } | null }>,
    currency: string,
  ): RevenueBriefing {
    const fmt = (n: number) => `${currency} ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    const changed: string[] = [];
    if (forecast.totalExpected > 0) {
      changed.push(`30-day forecast: ${fmt(forecast.totalExpected)} expected (${fmt(forecast.totalWorst)}–${fmt(forecast.totalBest)} range, ${forecast.confidence} confidence).`);
    }
    if (forecast.inputs.activeRecurring > 0) {
      changed.push(`${forecast.inputs.activeRecurring} active recurring sources contributing ~${fmt(forecast.inputs.monthlyRecurringEstimate)} per month.`);
    }

    const atRisk: string[] = [];
    if (overdueInv.length > 0) {
      const total = overdueInv.reduce((s, i) => s + Number(i.total ?? 0), 0);
      atRisk.push(`${overdueInv.length} overdue invoice${overdueInv.length === 1 ? '' : 's'} totaling ${fmt(total)}.`);
    }
    if (slowPayers.slowPayers.length > 0) {
      atRisk.push(`${slowPayers.slowPayers.length} slow payer${slowPayers.slowPayers.length === 1 ? '' : 's'} above ${slowPayers.threshold}d threshold.`);
    }

    const chases: RevenueBriefingChase[] = [];
    overdueInv.slice(0, 3).forEach((inv) => {
      const c = inv.contact;
      const name = c ? `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || c.email || 'customer' : 'customer';
      chases.push({
        id: `chase-inv-${inv.id}`,
        title: `Chase ${inv.invoiceNumber} — ${name}`,
        detail: `Send a payment reminder for ${fmt(Number(inv.total))}.`,
        amountAtRisk: Number(inv.total),
        contactId: c?.id ?? null,
        relatedType: 'invoice',
        relatedId: inv.id,
      });
    });
    pendingQuotes.slice(0, Math.max(0, 3 - chases.length)).forEach((q) => {
      const c = q.contact;
      const name = c ? `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || c.email || 'lead' : 'lead';
      chases.push({
        id: `chase-q-${q.id}`,
        title: `Follow up on ${q.quoteNumber} — ${name}`,
        detail: `Quote of ${fmt(Number(q.total))} hasn't converted yet.`,
        amountAtRisk: Number(q.total),
        contactId: c?.id ?? null,
        relatedType: 'quote',
        relatedId: q.id,
      });
    });

    const plan: string[] = [];
    pricingSignals.signals.slice(0, 2).forEach((s) => {
      plan.push(`${s.productName}: ${s.suggestion}`);
    });
    if (plan.length === 0) plan.push('Review your top customers and book a check-in for the highest-value 3.');

    return {
      headline:
        `Expecting ${fmt(forecast.totalExpected)} over the next 30 days` +
        (overdueInv.length ? ` with ${overdueInv.length} overdue invoice${overdueInv.length === 1 ? '' : 's'} to chase.` : '.'),
      whatChanged: changed.length ? changed : ['No major movements in the last 7 days.'],
      whatsAtRisk: atRisk.length ? atRisk : ['Nothing urgent at risk right now.'],
      whatToChase: chases,
      whatToPlan: plan,
      source: 'fallback',
    };
  }

  /**
   * Convert a single chase suggestion from the briefing into a real R3 RevenueAction.
   */
  async delegateChase(
    businessId: string,
    chase: RevenueBriefingChase,
  ): Promise<{ created: boolean; actionId?: string }> {
    const created = await this.revenueActions.createFromBriefing(businessId, {
      title: chase.title,
      detail: chase.detail,
      amountAtRisk: chase.amountAtRisk ?? null,
      contactId: chase.contactId ?? null,
      relatedType: chase.relatedType ?? null,
      relatedId: chase.relatedId ?? null,
    });
    return created;
  }

  invalidate(businessId: string) {
    this.cache.delete(businessId);
  }
}
