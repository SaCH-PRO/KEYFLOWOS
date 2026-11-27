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
import {
  classifyKeyCortexMemoryForRead,
  evaluateMemoryClassAccess,
  fetchProjectedBatch,
  getMemoryClassReadMode,
  isRowUnconditionallySecret,
  logMemoryClassShadowDiff,
  type MemoryClassShadowDiffEntry,
  type MemoryReaderContext,
} from './memory-class-read-projection';
import { PrismaService } from '../../core/prisma/prisma.service';
import { isMoneyLabel, proposalTextStatesMoney } from '../business-genome/key-genome/genome-finance-scope';

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
  // An automated intake that has stopped working, or has gone quiet for long
  // enough that it probably has.
  //
  // This kind exists because of two defects found on one afternoon, both of
  // which produced a SILENT ZERO rather than an error: the Drive sweep asked
  // Google for a filename instead of a folder and matched nothing, and
  // concurrent imports raced past an in-memory dedupe. Neither would have
  // raised anything. The nightly job would have reported "0 files considered"
  // — indistinguishable from a bank that sent nothing — until someone
  // reconciled at year end.
  //
  // A system that runs unattended has to be able to notice its own silence,
  // and nothing else in the awareness feed watches an integration.
  integration: 'integration_health',
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
/** D-235 round 6: the rows of a kind read for a reader without revenue read, of which at most PER_KIND_LIMIT are served. */
const PER_KIND_HEADROOM = 100;

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
    // D-235: readsRevenue false (or left out: fails closed) withholds every item whose content states money (an idea or
    // a hypothesis made from finance DNA, a concern about receivables); the counts are of what is served.
    opts: {
      kinds?: Array<keyof typeof AWARENESS_TYPES>;
      sinceDays?: number;
      readsRevenue?: boolean;
      readerContext?: MemoryReaderContext;
    } = {},
  ): Promise<AwarenessSummary> {
    const readerCtx = opts.readerContext;
    const readsRevenue =
      opts.readsRevenue === true ||
      (opts.readsRevenue === undefined && Boolean(readerCtx?.reader && readerCtx.sight('revenue')));
    // Round 2 (security MAJOR-1/2, D-234 provenance): ideas, hypotheses and reflections are made from the unprojected
    // business context and integration rows are the finance module's statement sweep, so a reader without revenue read
    // is served none of them; the other kinds are judged by their values (not their key names: correctness minor 4).
    const revenueOnly = new Set<string>(['idea', 'hypothesis', 'reflection', 'integration']);
    // `valence` is a structural label (threat / opportunity), not content; every other value is read.
    const valuesOf = (v: unknown): string[] =>
      typeof v === 'string'
        ? [v]
        : Array.isArray(v)
          ? v.flatMap(valuesOf)
          : v && typeof v === 'object'
            ? Object.entries(v).flatMap(([k, x]) => (k === 'valence' ? [] : valuesOf(x)))
            : [];
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
    const mode = getMemoryClassReadMode();
    const activeClassMode = Boolean(readerCtx) && mode === 'ACTIVE';
    const shadowClassMode = Boolean(readerCtx) && mode === 'SHADOW';
    const shadowDiffs: MemoryClassShadowDiffEntry[] = [];
    let shadowTotalCandidates = 0;
    let shadowLegacyCount = 0;
    let shadowProjectedCount = 0;

    type AwarenessRow = {
      id?: string;
      key: string;
      userId?: string | null;
      value: string;
      confidence: number;
      createdAt: Date;
    };

    for (const kind of kinds) {
      if (!readsRevenue && revenueOnly.has(kind)) continue;

      const whereClause: Record<string, unknown> = {
        businessId,
        type: AWARENESS_TYPES[kind],
        ...(since ? { createdAt: { gte: since } } : {}),
        // R1 Blocker 4: SQL-level personal ownership filter so foreign personal rows cannot exhaust PER_KIND_HEADROOM.
        ...(activeClassMode && readerCtx
          ? readerCtx.reader
            ? { OR: [{ userId: null }, { userId: readerCtx.reader }] }
            : { userId: null }
          : {}),
      };

      const fetchPage = (skip: number, take: number) =>
        this.prisma.client.keyCortexMemory.findMany({
          where: whereClause,
          select: { id: true, key: true, userId: true, value: true, confidence: true, createdAt: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...(skip > 0 ? { skip } : {}),
          take,
        }) as Promise<AwarenessRow[]>;

      let served = 0;
      let totalReadUnfiltered = 0;

      try {
        if (activeClassMode && readerCtx) {
          // R1 Blocker 5: paginate past withheld rows so fixed take never starves allowed awareness items.
          const acceptedRows = await fetchProjectedBatch<AwarenessRow>({
            targetCount: PER_KIND_LIMIT,
            batchSize: PER_KIND_HEADROOM,
            idOf: (row) => row.id ?? row.key,
            fetchPage,
            projectPage: (rawPage) =>
              rawPage.filter((row) => {
                try {
                  const parsed = JSON.parse(row.value) as Record<string, unknown>;
                  const parsedValues = valuesOf(parsed);
                  const accessInput = classifyKeyCortexMemoryForRead(
                    {
                      id: row.id,
                      key: row.key,
                      type: kind,
                      userId: row.userId ?? null,
                      value: row.value,
                    },
                    { revenueOnlyTypes: revenueOnly },
                  );
                  const decision = evaluateMemoryClassAccess(
                    {
                      ...accessInput,
                      backstopTexts: [...parsedValues, row.value],
                    },
                    readerCtx,
                  );
                  if (!decision.allowed) return false;
                  if (!readsRevenue && parsedValues.some((t) => proposalTextStatesMoney(t) || isMoneyLabel(t))) {
                    return false;
                  }
                  return true;
                } catch {
                  this.logger.debug(`[Awareness] Skipping unparseable ${kind} ${row.key}`);
                  return false;
                }
              }),
          });
          for (const row of acceptedRows) {
            try {
              const parsed = JSON.parse(row.value) as Record<string, unknown>;
              served += 1;
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
        } else {
          const rows = await fetchPage(0, readsRevenue ? PER_KIND_LIMIT : PER_KIND_HEADROOM);
          totalReadUnfiltered = rows.length;
          for (const row of rows) {
            if (served >= PER_KIND_LIMIT) break;
            try {
              const parsed = JSON.parse(row.value) as Record<string, unknown>;
              const parsedValues = valuesOf(parsed);
              // Unconditional secret-pattern defense even without readerContext (unless OFF).
              if (mode !== 'OFF' && isRowUnconditionallySecret(null, [...parsedValues, row.value])) {
                continue;
              }
              const legacyAllowed =
                readsRevenue || !parsedValues.some((t) => proposalTextStatesMoney(t) || isMoneyLabel(t));
              if (shadowClassMode && readerCtx) {
                shadowTotalCandidates += 1;
                if (legacyAllowed) shadowLegacyCount += 1;
                try {
                  const accessInput = classifyKeyCortexMemoryForRead(
                    {
                      id: row.id,
                      key: row.key,
                      type: kind,
                      userId: row.userId ?? null,
                      value: row.value,
                    },
                    { revenueOnlyTypes: revenueOnly },
                  );
                  const decision = evaluateMemoryClassAccess(
                    {
                      ...accessInput,
                      backstopTexts: [...parsedValues, row.value],
                    },
                    readerCtx,
                  );
                  const projectedAllowed = legacyAllowed && decision.allowed;
                  if (projectedAllowed) shadowProjectedCount += 1;
                  if (legacyAllowed !== projectedAllowed) {
                    shadowDiffs.push({
                      id: row.id ?? 'unknown',
                      store: 'key_cortex_memory',
                      dataClass: decision.effectiveDataClass,
                      moduleScope: decision.effectiveModuleScope,
                      legacyAllowed,
                      projectedAllowed,
                      reason: decision.reason,
                    });
                  }
                } catch {
                  // Crash-isolated shadow evaluation
                }
              }
              if (!legacyAllowed) continue;
              served += 1;
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
      } catch (error: unknown) {
        this.logger.warn(
          `[Awareness] Could not read ${kind}: ` +
            `${error instanceof Error ? error.message : 'unknown'}`,
        );
        continue;
      }

      // A revenue reader's counts are as before (every row read); anyone else's (or active class projection) are of what is served (D-235, design 6.1).
      counts[kind] = readsRevenue && !activeClassMode ? totalReadUnfiltered : served;
    }

    if (shadowClassMode && readerCtx && shadowDiffs.length > 0) {
      logMemoryClassShadowDiff(this.logger, {
        path: 'KeyCortexAwarenessService.getAwareness',
        businessId,
        readerPresent: readerCtx.reader !== null,
        totalCandidates: shadowTotalCandidates,
        legacyCount: shadowLegacyCount,
        projectedCount: shadowProjectedCount,
        diffs: shadowDiffs,
      });
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
      case 'integration':
        return str('summary') ?? 'An automatic intake needs attention';
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
      case 'integration':
        return str('suggestedAction');
      default:
        return undefined;
    }
  }
}
