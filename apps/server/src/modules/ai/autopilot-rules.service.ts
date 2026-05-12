import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface AutopilotRule {
  id: string;
  ruleType: string;
  enabled: boolean;
  config?: Record<string, unknown>;
}

@Injectable()
export class AutopilotRulesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getRules(businessId: string): Promise<AutopilotRule[]> {
    const bp = await (this.prisma.client as any).businessBlueprint.findUnique({
      where: { businessId },
      select: { aiPreferences: true },
    });
    const prefs = (bp?.aiPreferences as Record<string, unknown>) || {};
    return [
      { id: 'booking_reminders', ruleType: 'Auto booking reminders', enabled: (prefs.notifyOnRecommendations as boolean) ?? true },
      { id: 'review_requests', ruleType: 'Auto review requests', enabled: true },
      { id: 'invoice_reminders', ruleType: 'Auto invoice reminders', enabled: true },
      { id: 'lead_followup_drafts', ruleType: 'Auto lead follow-up drafts', enabled: true },
      { id: 'abandoned_quote_alerts', ruleType: 'Auto abandoned quote alerts', enabled: true },
      { id: 'low_stock_warnings', ruleType: 'Auto low-stock warnings', enabled: true },
      { id: 'weekly_reports', ruleType: 'Auto weekly reports', enabled: true },
    ];
  }

  async updateRule(businessId: string, ruleId: string, enabled: boolean) {
    // Store in aiPreferences for now
    const bp = await (this.prisma.client as any).businessBlueprint.findUnique({
      where: { businessId },
    });
    const prefs = { ...(bp?.aiPreferences as Record<string, unknown> || {}), [ruleId]: enabled };
    return (this.prisma.client as any).businessBlueprint.update({
      where: { businessId },
      data: { aiPreferences: prefs as any },
    });
  }
}
