/**
 * KEY Cortex Digest Service — Phase D.2
 *
 * Generates daily and weekly business briefings by composing the business
 * mental model, insight reports, and recent memory context into a structured
 * digest. Digests can be delivered through the CommunicationsService facade.
 */

import { Injectable, Logger } from '@nestjs/common';
import { KeyBiEngineService } from './key-bi-engine.service';
import { KeyCortexInsightService } from './key-cortex-insight.service';
import { KeyCortexMemoryRetrievalService } from './key-cortex-memory-retrieval.service';
import { CommunicationsService } from '../communications/communications.service';

export interface KeyCortexDigest {
  businessId: string;
  generatedAt: Date;
  period: 'daily' | 'weekly';
  summary: string;
  highlights: string[];
  alerts: string[];
  opportunities: string[];
  actions: string[];
}

@Injectable()
export class KeyCortexDigestService {
  private readonly logger = new Logger(KeyCortexDigestService.name);

  constructor(
    private readonly biEngine: KeyBiEngineService,
    private readonly insightService: KeyCortexInsightService,
    private readonly memoryRetrieval: KeyCortexMemoryRetrievalService,
    private readonly communications: CommunicationsService,
  ) {}

  /**
   * Generate a daily digest for a business.
   */
  async generateDailyDigest(businessId: string): Promise<KeyCortexDigest> {
    return this.generateDigest(businessId, 'daily');
  }

  /**
   * Generate a weekly digest for a business.
   */
  async generateWeeklyDigest(businessId: string): Promise<KeyCortexDigest> {
    return this.generateDigest(businessId, 'weekly');
  }

  /**
   * Generate and deliver a daily digest via the communications facade.
   * Falls back to a broadcast when no primary contact is configured.
   */
  async deliverDailyDigest(
    businessId: string,
    channel: 'email' | 'whatsapp' | 'sms' = 'email',
  ): Promise<{ digest: KeyCortexDigest; result: { success: boolean; contentId?: string; error?: string } }> {
    const digest = await this.generateDailyDigest(businessId);
    const result = await this.sendDigest(businessId, digest, channel);
    return { digest, result };
  }

  /**
   * Generate and deliver a weekly digest via the communications facade.
   */
  async deliverWeeklyDigest(
    businessId: string,
    channel: 'email' | 'whatsapp' | 'sms' = 'email',
  ): Promise<{ digest: KeyCortexDigest; result: { success: boolean; contentId?: string; error?: string } }> {
    const digest = await this.generateWeeklyDigest(businessId);
    const result = await this.sendDigest(businessId, digest, channel);
    return { digest, result };
  }

  private async generateDigest(
    businessId: string,
    period: 'daily' | 'weekly',
  ): Promise<KeyCortexDigest> {
    const [mentalModel, report, memories] = await Promise.all([
      this.biEngine.getMentalModel(businessId),
      this.insightService.generateBusinessReport(businessId, period).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[generateDigest] insight report failed for ${businessId}: ${msg}`);
        return null;
      }),
      this.memoryRetrieval
        .retrieveContext(businessId, { limit: 10, boostRecency: true })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(`[generateDigest] memory retrieval failed for ${businessId}: ${msg}`);
          return [];
        }),
    ]);

    const highlights: string[] = [];
    const alerts: string[] = [];
    const opportunities: string[] = [];
    const actions: string[] = [];

    if (mentalModel) {
      highlights.push(
        `Health score: ${mentalModel.healthScore}/100 (${mentalModel.healthStatus})`,
      );

      for (const risk of mentalModel.topRisks.slice(0, 3)) {
        alerts.push(`${risk.title} — ${risk.reason} (${risk.severity})`);
      }

      for (const opp of mentalModel.topOpportunities.slice(0, 3)) {
        opportunities.push(`${opp.title} — ${opp.reason}`);
      }

      for (const item of mentalModel.attentionItems.slice(0, 3)) {
        actions.push(`${item.title} (${item.count} item${item.count === 1 ? '' : 's'}, ${item.priority} priority)`);
      }
    }

    if (report) {
      highlights.push(
        `Revenue ${report.revenue.growthDirection} (${report.revenue.growthRate}% vs last period)`,
      );

      for (const priority of report.topPriorities.slice(0, 3)) {
        if (!actions.includes(priority)) {
          actions.push(priority);
        }
      }

      for (const opp of report.opportunities.slice(0, 3)) {
        const line = `${opp.title} — ${opp.description}`;
        if (!opportunities.includes(line)) {
          opportunities.push(line);
        }
      }

      if (report.churnRisks.length > 0) {
        alerts.push(`${report.churnRisks.length} churn risk(s) detected`);
      }
    }

    if (memories.length > 0) {
      highlights.push(`${memories.length} relevant memory fragment(s) from the last 90 days`);
    }

    const summary = this.buildSummary(businessId, period, mentalModel, report);

    return {
      businessId,
      generatedAt: new Date(),
      period,
      summary,
      highlights: highlights.slice(0, 5),
      alerts: alerts.slice(0, 5),
      opportunities: opportunities.slice(0, 5),
      actions: actions.slice(0, 5),
    };
  }

  private buildSummary(
    businessId: string,
    period: 'daily' | 'weekly',
    mentalModel: Awaited<ReturnType<KeyBiEngineService['getMentalModel']>>,
    report: Awaited<ReturnType<KeyCortexInsightService['generateBusinessReport']>> | null,
  ): string {
    const parts: string[] = [];
    const periodLabel = period === 'daily' ? 'Today' : 'This week';

    parts.push(`${periodLabel}'s digest for ${businessId}:`);

    if (mentalModel) {
      parts.push(`health is ${mentalModel.healthStatus} (${mentalModel.healthScore}/100).`);
    }

    if (report) {
      parts.push(
        `Revenue ${report.revenue.growthDirection} ${Math.abs(report.revenue.growthRate)}% with ${report.revenue.invoiceCount} invoice(s).`,
      );
    }

    const alertCount = (mentalModel?.topRisks.length ?? 0) + (report?.churnRisks.length ?? 0);
    if (alertCount > 0) {
      parts.push(`${alertCount} alert(s) need attention.`);
    }

    return parts.join(' ');
  }

  private async sendDigest(
    businessId: string,
    digest: KeyCortexDigest,
    channel: 'email' | 'whatsapp' | 'sms',
  ): Promise<{ success: boolean; contentId?: string; error?: string }> {
    const subject =
      digest.period === 'daily'
        ? `Your daily business digest — ${digest.generatedAt.toLocaleDateString()}`
        : `Your weekly business digest — week of ${digest.generatedAt.toLocaleDateString()}`;

    const body = this.formatDigestBody(digest);

    try {
      const result = await this.communications.sendBroadcast({
        businessId,
        segment: 'business_owners',
        channel,
        body,
      });

      return {
        success: result.success,
        contentId: result.contentId,
        error: result.error,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[sendDigest] failed for ${businessId}: ${msg}`);
      return { success: false, error: msg };
    }
  }

  private formatDigestBody(digest: KeyCortexDigest): string {
    const lines: string[] = [digest.summary, ''];

    if (digest.highlights.length > 0) {
      lines.push('Highlights:');
      digest.highlights.forEach((h) => lines.push(`• ${h}`));
      lines.push('');
    }

    if (digest.alerts.length > 0) {
      lines.push('Alerts:');
      digest.alerts.forEach((a) => lines.push(`• ${a}`));
      lines.push('');
    }

    if (digest.opportunities.length > 0) {
      lines.push('Opportunities:');
      digest.opportunities.forEach((o) => lines.push(`• ${o}`));
      lines.push('');
    }

    if (digest.actions.length > 0) {
      lines.push('Suggested actions:');
      digest.actions.forEach((a) => lines.push(`• ${a}`));
      lines.push('');
    }

    return lines.join('\n');
  }
}
