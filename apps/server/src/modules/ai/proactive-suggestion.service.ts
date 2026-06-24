import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ProAutoMonitorService, ProAutoInsight } from './pro-auto-monitor.service';
import { AiOversightService } from './ai-oversight.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface ChatSuggestion {
  id: string;
  category: string;
  title: string;
  message: string;
  actions: Array<{
    label: string;
    value: string;
    toolName?: string;
    args?: Record<string, any>;
  }>;
  severity: 'critical' | 'warning' | 'opportunity' | 'info';
  metric?: string;
  createdAt: Date;
}

const SUGGESTION_COOLDOWN_HOURS = 24;

@Injectable()
export class ProactiveSuggestionService {
  private readonly logger = new Logger(ProactiveSuggestionService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProAutoMonitorService) private readonly monitor: ProAutoMonitorService,
    @Inject(AiOversightService) private readonly governance: AiOversightService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  /**
   * Scan business and generate chat-ready suggestions.
   * Stores suggestions in AiMemory with 24h expiry.
   * Respects cooldown — same category not suggested twice within 24h.
   */
  async generateSuggestions(businessId: string): Promise<ChatSuggestion[]> {
    const settings = await this.governance.getAutonomySettings(businessId);
    if (settings.mode === 'restricted' || settings.mode === 'advisory') {
      return [];
    }

    // Get existing suggestions to check cooldown
    const recentSuggestions = await this.prisma.client.aiMemory.findMany({
      where: {
        businessId,
        category: 'suggestion',
        createdAt: { gte: new Date(Date.now() - SUGGESTION_COOLDOWN_HOURS * 60 * 60 * 1000) },
      },
      select: { key: true, value: true },
    });
    const recentCategories = new Set(recentSuggestions.map(s => s.key.split('_')[0]));

    // Scan for insights
    const insights = await this.monitor.scanInsights(businessId);
    const actionable = insights.filter(i => i.severity === 'critical' || i.severity === 'warning' || i.severity === 'opportunity');

    const suggestions: ChatSuggestion[] = [];

    for (const insight of actionable) {
      // Skip if this category was already suggested recently
      if (recentCategories.has(insight.category)) continue;

      const suggestion = this.insightToSuggestion(insight);
      if (suggestion) {
        suggestions.push(suggestion);
        // Store in memory so we don't repeat
        await this.prisma.client.aiMemory.upsert({
          where: { businessId_category_key: { businessId, category: 'suggestion', key: `${insight.category}_${Date.now()}` } },
          update: { value: JSON.stringify(suggestion), expiresAt: new Date(Date.now() + SUGGESTION_COOLDOWN_HOURS * 60 * 60 * 1000) },
          create: {
            businessId,
            category: 'suggestion',
            key: `${insight.category}_${Date.now()}`,
            value: JSON.stringify(suggestion),
            confidence: insight.severity === 'critical' ? 0.95 : insight.severity === 'warning' ? 0.8 : 0.7,
            source: 'key_ai',
            expiresAt: new Date(Date.now() + SUGGESTION_COOLDOWN_HOURS * 60 * 60 * 1000),
          },
        });
      }
    }

    return suggestions;
  }

  /**
   * Fetch pending suggestions for the chat interface.
   * Returns suggestions that haven't been dismissed or acted on.
   */
  async getPendingSuggestions(businessId: string): Promise<ChatSuggestion[]> {
    const memories = await this.prisma.client.aiMemory.findMany({
      where: {
        businessId,
        category: 'suggestion',
        expiresAt: { gte: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return memories
      .map(m => {
        try {
          return JSON.parse(m.value) as ChatSuggestion;
        } catch {
          return null;
        }
      })
      .filter((s): s is ChatSuggestion => s !== null);
  }

  /**
   * Mark a suggestion as dismissed so it won't appear again.
   */
  async dismissSuggestion(businessId: string, suggestionId: string): Promise<void> {
    await this.prisma.client.aiMemory.deleteMany({
      where: {
        businessId,
        category: 'suggestion',
        value: { contains: suggestionId },
      },
    });
  }

  /**
   * Mark a suggestion category as "never suggest again" (7-day block).
   */
  async blockCategory(businessId: string, category: string): Promise<void> {
    await this.prisma.client.aiMemory.upsert({
      where: { businessId_category_key: { businessId, category: 'suggestion_block', key: category } },
      update: { expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
      create: {
        businessId,
        category: 'suggestion_block',
        key: category,
        value: 'blocked',
        source: 'user',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
  }

  private insightToSuggestion(insight: ProAutoInsight): ChatSuggestion | null {
    switch (insight.category) {
      case 'stale_leads':
        return {
          id: `suggestion_${insight.category}_${Date.now()}`,
          category: insight.category,
          title: 'Stale leads need attention',
          message: insight.description,
          actions: [
            { label: 'Follow up now', value: 'follow_up', toolName: 'draft_followup_message' },
            { label: 'Show me who', value: 'show_list' },
            { label: 'Not now', value: 'dismiss' },
          ],
          severity: insight.severity,
          metric: insight.metric,
          createdAt: new Date(),
        };

      case 'overdue_invoices':
        return {
          id: `suggestion_${insight.category}_${Date.now()}`,
          category: insight.category,
          title: 'Overdue invoices',
          message: insight.description,
          actions: [
            { label: 'Send reminders', value: 'send_reminders', toolName: 'draft_payment_reminder' },
            { label: 'Show details', value: 'show_list' },
            { label: 'Not now', value: 'dismiss' },
          ],
          severity: insight.severity,
          metric: insight.metric,
          createdAt: new Date(),
        };

      case 'pending_bookings':
        return {
          id: `suggestion_${insight.category}_${Date.now()}`,
          category: insight.category,
          title: 'Bookings awaiting confirmation',
          message: insight.description,
          actions: [
            { label: 'Confirm all', value: 'confirm_all', toolName: 'bookings_confirm_booking' },
            { label: 'Review first', value: 'show_list' },
            { label: 'Not now', value: 'dismiss' },
          ],
          severity: insight.severity,
          metric: insight.metric,
          createdAt: new Date(),
        };

      case 'delayed_projects':
        return {
          id: `suggestion_${insight.category}_${Date.now()}`,
          category: insight.category,
          title: 'Project delays detected',
          message: insight.description,
          actions: [
            { label: 'Check status', value: 'check_status', toolName: 'fetch_project_status' },
            { label: 'Notify client', value: 'notify_client', toolName: 'draft_followup_message' },
            { label: 'Not now', value: 'dismiss' },
          ],
          severity: insight.severity,
          metric: insight.metric,
          createdAt: new Date(),
        };

      case 'cost_pressure':
        return {
          id: `suggestion_${insight.category}_${Date.now()}`,
          category: insight.category,
          title: 'Expenses trending high',
          message: insight.description,
          actions: [
            { label: 'Review expenses', value: 'review', toolName: 'fetch_expense_pressure' },
            { label: 'Not now', value: 'dismiss' },
          ],
          severity: insight.severity,
          metric: insight.metric,
          createdAt: new Date(),
        };

      case 'content_stale':
        return {
          id: `suggestion_${insight.category}_${Date.now()}`,
          category: insight.category,
          title: 'Content needs refreshing',
          message: insight.description,
          actions: [
            { label: 'Draft content', value: 'draft', toolName: 'draft_social_post' },
            { label: 'Not now', value: 'dismiss' },
          ],
          severity: insight.severity,
          metric: insight.metric,
          createdAt: new Date(),
        };

      default:
        return {
          id: `suggestion_${insight.category}_${Date.now()}`,
          category: insight.category,
          title: insight.title,
          message: insight.description,
          actions: [
            { label: 'Take action', value: 'act', toolName: insight.suggestedTool },
            { label: 'Tell me more', value: 'info' },
            { label: 'Not now', value: 'dismiss' },
          ],
          severity: insight.severity,
          metric: insight.metric,
          createdAt: new Date(),
        };
    }
  }
}
