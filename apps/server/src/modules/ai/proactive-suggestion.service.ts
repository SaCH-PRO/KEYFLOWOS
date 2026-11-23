import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ProAutoMonitorService, ProAutoInsight } from './pro-auto-monitor.service';
import { AiOversightService } from './ai-oversight.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { deleteAiMemoriesWithCopies, upsertAiMemoryDroppingStaleCopies } from './ai-memory.service';
import { SemanticMemoryService } from './semantic-memory.service';
import { insightNeeds, SIGHT_WORDS } from './insight-sight';

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
  /**
   * FU-INSIGHTS-SIGHT: the words its stored row carries for the sights its insight needs ('revenue', 'suppliers';
   * SIGHT_WORDS), so the row is withheld by the AiMemory-row rule wherever it is read.
   */
  sight?: string[];
}

const SUGGESTION_COOLDOWN_HOURS = 24;
/** FU-INSIGHTS-SIGHT: the most pending suggestion rows one filtered read takes. */
const PENDING_READ_MAX = 500;

@Injectable()
export class ProactiveSuggestionService {
  private readonly logger = new Logger(ProactiveSuggestionService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProAutoMonitorService) private readonly monitor: ProAutoMonitorService,
    @Inject(AiOversightService) private readonly governance: AiOversightService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    // FU-MEMORY-COPIES-REWRITE review COR-V71I-3: copies a suggestion row the door rewrote again. AiModule provides it.
    @Optional() @Inject(SemanticMemoryService) private readonly semantic?: SemanticMemoryService,
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
    // FU-INSIGHTS-SIGHT (reviews round 1, ISS-2 / F-2): a key is `<category>_<timestamp>` and a category has
    // underscores itself ('stale_leads'), so the category is everything before the last underscore; the first word
    // ('stale') never matched, the cooldown never held, and every refresh stored every suggestion again.
    const recentCategories = new Set(recentSuggestions.map((s) => s.key.slice(0, s.key.lastIndexOf('_'))));

    // Scan for insights
    const insights = await this.monitor.scanInsights(businessId);
    const actionable = insights.filter(i => i.severity === 'critical' || i.severity === 'warning' || i.severity === 'opportunity');

    const suggestions: ChatSuggestion[] = [];

    for (const insight of actionable) {
      // Skip if this category was already suggested recently
      if (recentCategories.has(insight.category)) continue;

      const made = this.insightToSuggestion(insight);
      const needs = insight.needs ?? insightNeeds(insight);
      const suggestion = made && needs.length ? { ...made, sight: needs.map((sight) => SIGHT_WORDS[sight]) } : made;
      if (suggestion) {
        suggestions.push(suggestion);
        // Store in memory so we don't repeat. FU-MEMORY-COPIES-REWRITE: through the write door, so a suggestion
        // rewritten in place (the same key) leaves no copy of the one it replaced.
        const key = `${insight.category}_${Date.now()}`;
        const expiresAt = new Date(Date.now() + SUGGESTION_COOLDOWN_HOURS * 60 * 60 * 1000);
        await upsertAiMemoryDroppingStaleCopies(this.prisma, businessId, { category: 'suggestion', key }, {
          update: { value: JSON.stringify(suggestion), expiresAt },
          create: {
            value: JSON.stringify(suggestion),
            confidence: insight.severity === 'critical' ? 0.95 : insight.severity === 'warning' ? 0.8 : 0.7,
            source: 'key_ai',
            expiresAt,
          },
        }, this.semantic);
      }
    }

    return suggestions;
  }

  /**
   * Fetch pending suggestions for the chat interface.
   * Returns suggestions that haven't been dismissed or acted on.
   */
  async getPendingSuggestions(
    businessId: string,
    // FU-INSIGHTS-SIGHT: the stored rows the reader may be handed (the caller's aiMemoryRowVisibleTo). Filtered before
    // the 10 are cut, so a withheld suggestion takes no place (suggestions expire in 24 hours: few rows are pending).
    rowVisible?: (row: { category: string; key: string; value: string }) => boolean,
  ): Promise<ChatSuggestion[]> {
    const pending = await this.prisma.client.aiMemory.findMany({
      where: {
        businessId,
        category: 'suggestion',
        expiresAt: { gte: new Date() },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      // A reader's rows are filtered before the 10 are cut; the read is bounded (the cooldown keeps a category to one
      // row a day, so the pending set is small; 500 is far above it).
      take: rowVisible ? PENDING_READ_MAX : 10,
    });
    const memories = (rowVisible ? pending.filter((row) => rowVisible(row)) : pending).slice(0, 10);

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
   * Mark a suggestion as dismissed so it won't appear again. W1F-MEMORY-COPIES: the row goes with its semantic copies
   * (a backfill copies suggestion rows too), so search and KEY's memory block stop serving it.
   */
  async dismissSuggestion(businessId: string, suggestionId: string): Promise<void> {
    await deleteAiMemoriesWithCopies(this.prisma, businessId, {
      category: 'suggestion',
      value: { contains: suggestionId },
    });
  }

  /**
   * Mark a suggestion category as "never suggest again" (7-day block).
   */
  async blockCategory(businessId: string, category: string): Promise<void> {
    // FU-MEMORY-COPIES-REWRITE: through the write door (a re-block only moves the expiry; nothing is rewritten).
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await upsertAiMemoryDroppingStaleCopies(this.prisma, businessId, { category: 'suggestion_block', key: category }, {
      update: { expiresAt },
      create: { value: 'blocked', source: 'user', expiresAt },
    }, this.semantic);
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
