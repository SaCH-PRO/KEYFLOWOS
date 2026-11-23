/**
 * FU-KEY-CHAT-GENOME-MONEY-SIGHT (V1-71; D-128, D-100): the business genome as a KEY chat turn's
 * reader may see it. KeyCortexGenomeContextService loads the genome per business, with no viewer,
 * and a chat turn hands it to the model prompt, the answer (genomeInsights, proactiveSuggestions)
 * and the stream's genome alert. A reader without revenue read is handed:
 *   - no finance signal (isFinanceSignal on the signal's source module, section and domain, as the
 *     gated genome signal routes read it);
 *   - no finance recommendation or suggestion (isFinanceRecommendation on its domain/category);
 *   - no opportunity: each carries an estimatedValue in money.
 *   - no finance or sales DNA score (D-233: dnaScoresForReader).
 * Everything else (stage, readiness, the other modules' rows and scores) is unchanged. A revenue
 * reader gets the genome as loaded. The inputs are never changed (the context may be the cached one).
 */
import { dnaScoresForReader, isFinanceRecommendation, isFinanceSignal, isMoneyLabel } from '../business-genome/key-genome/genome-finance-scope';
import type { GenomeEnrichedContext, GenomeRecommendation } from './key-cortex-reasoning.types';

/** The genome signals a genome context serves (the newest NEW signals). */
export const GENOME_SIGNALS_SERVED = 20;
/** D-235 round 8: the newest NEW signals read once, from which a reader without revenue read is projected. */
export const GENOME_SIGNAL_POOL = 100;

/**
 * FU-KEY-GENOME-READS-RESIDUAL (D-235, D-233 "no inference via a score, grade or categorical indicator"): executive
 * readiness is recomputed as the mean of the DNA dimensions the reader may see (it averages, and the bridge can set it
 * to, the finance score); 0 when none is visible.
 */
export function readinessFromVisibleDna(visible: Record<string, unknown>): number {
  const values = Object.values(visible).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
}

/** The autonomy map without its money modules (finance, revenue, sales ... by name). */
export function autonomyMapForReader(map: Record<string, boolean> | undefined): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [module, allowed] of Object.entries(map ?? {})) if (!isMoneyLabel(module)) out[module] = allowed;
  return out;
}

export function genomeContextForReader(context: GenomeEnrichedContext, readsRevenue: boolean): GenomeEnrichedContext {
  if (readsRevenue) return context;
  const dnaScores = dnaScoresForReader(context.dnaScores, false) as Record<string, number>;
  // D-235: the genome stage is a categorical indicator of the whole genome, money dimensions included: withheld.
  // Round 8: the signal pool is read to project the signals and is never handed on.
  const { genomeStage: _stage, signalPool, ...rest } = context;
  return {
    ...rest,
    executiveReadiness: readinessFromVisibleDna(dnaScores),
    autonomyMap: autonomyMapForReader(context.autonomyMap),
    dnaScores,
    // Round 8 (security MINOR-1): projected from the pool (the newest signals), then limited to what a context serves,
    // so how many are handed does not tell how many of the newest twenty were finance or sales.
    signals: (signalPool ?? context.signals ?? [])
      .filter((s) => !isFinanceSignal({ sourceModule: s.module, section: s.section, domain: s.domain, signalType: s.type }))
      .slice(0, GENOME_SIGNALS_SERVED),
    recommendations: genomeRecommendationsForReader(context.recommendations ?? [], false),
    opportunities: [],
  };
}

export function genomeRecommendationsForReader<T extends Pick<GenomeRecommendation, 'category'>>(rows: T[], readsRevenue: boolean): T[] {
  if (readsRevenue) return rows;
  // The ranking weighs the financial value (GenomeRecommendationRanker): its score, reason and the financial viability
  // are withheld (security review MINOR-7; D-235), and the rows are re-ordered by their own impact and confidence, so the
  // order itself is not the money-weighted rank.
  const impactOf = (v: unknown) => (typeof v === 'number' ? v : v === 'high' ? 3 : v === 'medium' ? 2 : v === 'low' ? 1 : 0);
  return rows
    .filter((r) => !isFinanceRecommendation({ domain: r.category, title: (r as { title?: string }).title }))
    .map((r) => {
      const { genomeScore: _s, rankScore: _r, rankReason: _rr, financialViability: _f, ...rest } = r as T & Record<string, unknown>;
      return rest as unknown as T;
    })
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const x = a.r as unknown as { impact?: unknown; confidence?: unknown };
      const y = b.r as unknown as { impact?: unknown; confidence?: unknown };
      return impactOf(y.impact) - impactOf(x.impact) || (Number(y.confidence) || 0) - (Number(x.confidence) || 0) || a.i - b.i;
    })
    .map(({ r }) => r);
}

/**
 * FU-KEY-GENOME-READS-RESIDUAL round 4 (D-235; security MINOR-1): ranked recommendations projected for the reader. A
 * reader without revenue read (or no reader: fails closed) is read with headroom before the limit is taken, so how many of
 * the business's top rows are finance or sales cannot be read from how many the reader is handed.
 */
export async function rankedRecommendationsForReader<T extends Pick<GenomeRecommendation, 'category'>>(
  read: (limit: number) => Promise<T[]>,
  readsRevenue = false,
  limit = 5,
): Promise<T[]> {
  return genomeRecommendationsForReader(await read(readsRevenue ? limit : 50), readsRevenue).slice(0, limit);
}

/** Proactive suggestions carry the recommendation's domain, or the signal's module, as their category. */
export function genomeSuggestionsForReader<T extends { category?: string | null }>(rows: T[], readsRevenue: boolean): T[] {
  if (readsRevenue) return rows;
  // A suggestion's category is a recommendation domain or a signal's module (a label only), so it is
  // judged as a domain; suggestions built from signals already come from the projected signals.
  return rows.filter((s) => !isFinanceRecommendation({ domain: s.category }));
}
