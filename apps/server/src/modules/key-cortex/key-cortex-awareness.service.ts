/**
 * KEY Cortex — Awareness (reading back what KEY noticed)
 *
 * The proactive layers now record what they find: intuition writes weak signals
 * and churn predictions, creativity writes ideas, reflection writes its
 * sessions. Nothing read any of it. KEY was noticing things into a drawer
 * nobody opens, which is only marginally better than not noticing them.
 *
 * This is the read side. It exists as its own service rather than as methods on
 * the writers because the writers are scheduled jobs with heavy dependency
 * graphs, and the read path should not have to boot any of that.
 *
 * Everything here is scoped by businessId in the WHERE clause. The controller
 * is behind BusinessGuard, but a guard establishes which tenant is asking — it
 * does not constrain what the query returns. Both are required.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

/** Record types written by the cognition layers. */
export const AWARENESS_TYPES = {
  weakSignal: 'weak_signal',
  churnRisk: 'churn_risk',
  idea: 'creative_idea',
  reflection: 'reflection_session',
  hypothesis: 'dream_hypothesis',
  // The amygdala's ranked output. It computed up to ten concerns per pass with
  // human-readable summaries and discarded eight of them; the surviving two
  // escaped only as the `reason` riding on a hormone, under an instruction that
  // explicitly forbids treating them as reportable fact. So a user could never
  // be TOLD "12 overdue invoices against a normal of 3" — only given a vaguer,
  // mood-shaped version of a number the system knew exactly.
  //
  // Threat and momentum are separate kinds rather than one: the panel colours
  // and counts by kind, and rendering new bookings in threat red would be
  // actively wrong.
  concern: 'salience_concern',
  momentum: 'salience_momentum',
} as const;

export interface AwarenessItem {
  id: string;
  kind: keyof typeof AWARENESS_TYPES;
  /** One-line summary suitable for a feed row. */
  headline: string;
  /** What KEY suggests doing about it, when it said. */
  suggestedAction?: string;
  confidence: number;
  noticedAt: Date;
  /** Kind-specific fields, already parsed. */
  detail: Record<string, unknown>;
}

export interface AwarenessSummary {
  businessId: string;
  items: AwarenessItem[];
  counts: Record<keyof typeof AWARENESS_TYPES, number>;
  /** Newest noticedAt across all items, or null when KEY has noticed nothing. */
  latestAt: Date | null;
}

/** Rows to read per kind. Enough for a feed, bounded so a busy tenant cannot. */
const PER_KIND_LIMIT = 25;

@Injectable()
export class KeyCortexAwarenessService {
  private readonly logger = new Logger(KeyCortexAwarenessService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Everything KEY has noticed for this business, newest first.
   *
   * Never throws: this backs a dashboard panel, and an empty panel is a better
   * failure than a 500 on a page that also shows other things.
   */
  async getAwareness(
    businessId: string,
    opts: { kinds?: Array<keyof typeof AWARENESS_TYPES>; sinceDays?: number } = {},
  ): Promise<AwarenessSummary> {
    const kinds = opts.kinds?.length
      ? opts.kinds
      : (Object.keys(AWARENESS_TYPES) as Array<keyof typeof AWARENESS_TYPES>);

    const since = opts.sinceDays
      ? new Date(Date.now() - opts.sinceDays * 24 * 60 * 60 * 1000)
      : undefined;

    const counts = Object.fromEntries(
      (Object.keys(AWARENESS_TYPES) as Array<keyof typeof AWARENESS_TYPES>).map((k) => [k, 0]),
    ) as Record<keyof typeof AWARENESS_TYPES, number>;

    const items: AwarenessItem[] = [];

    for (const kind of kinds) {
      let rows: Array<{ key: string; value: string; confidence: number; createdAt: Date }>;
      try {
        rows = await this.prisma.client.keyCortexMemory.findMany({
          where: {
            businessId,
            type: AWARENESS_TYPES[kind],
            ...(since ? { createdAt: { gte: since } } : {}),
          },
          select: { key: true, value: true, confidence: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: PER_KIND_LIMIT,
        });
      } catch (error: unknown) {
        this.logger.warn(
          `[Awareness] Could not read ${kind}: ` +
            `${error instanceof Error ? error.message : 'unknown'}`,
        );
        continue;
      }

      counts[kind] = rows.length;

      for (const row of rows) {
        // One malformed row must not lose the rest of the feed.
        try {
          const parsed = JSON.parse(row.value) as Record<string, unknown>;
          items.push({
            id: row.key,
            kind,
            headline: this.headlineFor(kind, parsed),
            suggestedAction: this.actionFor(kind, parsed),
            confidence: row.confidence,
            noticedAt: row.createdAt,
            detail: parsed,
          });
        } catch {
          this.logger.debug(`[Awareness] Skipping unparseable ${kind} ${row.key}`);
        }
      }
    }

    items.sort((a, b) => b.noticedAt.getTime() - a.noticedAt.getTime());

    return {
      businessId,
      items,
      counts,
      latestAt: items.length > 0 ? items[0].noticedAt : null,
    };
  }

  /**
   * A feed row's one-liner.
   *
   * Falls back to a plain label rather than inventing text: a row whose payload
   * shape changed should read as "a signal KEY recorded", not as a confident
   * sentence assembled from fields that are not there.
   */
  private headlineFor(kind: keyof typeof AWARENESS_TYPES, d: Record<string, unknown>): string {
    const str = (k: string): string | undefined =>
      typeof d[k] === 'string' && (d[k] as string).trim() ? (d[k] as string) : undefined;

    switch (kind) {
      case 'weakSignal':
        return str('description') ?? 'Weak signal detected';
      case 'churnRisk':
        return str('prediction') ?? str('pattern') ?? 'Customer at risk';
      case 'idea':
        return str('title') ?? str('description') ?? 'Idea generated';
      case 'reflection': {
        const insights = Array.isArray(d.insights) ? d.insights.length : 0;
        const type = str('type') ?? 'reflection';
        return insights > 0
          ? `${type}: ${insights} insight${insights === 1 ? '' : 's'}`
          : `${type} cycle completed`;
      }
      case 'hypothesis':
        return str('description') ?? 'Hypothesis formed';
      case 'concern':
      case 'momentum':
        // The sentence salience already wrote is exactly the line the owner
        // should read. Nothing to reword.
        return str('summary') ?? 'A ranked signal from the hourly appraisal';
    }
  }

  /** What KEY proposed doing, where the layer recorded one. */
  private actionFor(
    kind: keyof typeof AWARENESS_TYPES,
    d: Record<string, unknown>,
  ): string | undefined {
    const str = (k: string): string | undefined =>
      typeof d[k] === 'string' && (d[k] as string).trim() ? (d[k] as string) : undefined;

    switch (kind) {
      case 'weakSignal':
        return str('recommendedInvestigation');
      case 'churnRisk':
        return d.timeHorizon ? `Predicted window: ${String(d.timeHorizon)}` : undefined;
      case 'idea': {
        const steps = d.implementationSteps;
        return Array.isArray(steps) && steps.length > 0 ? String(steps[0]) : undefined;
      }
      default:
        return undefined;
    }
  }
}
