/**
 * FU-KEY-CHAT-GENOME-MONEY-SIGHT (V1-71; D-128, D-100): the business genome as a KEY chat turn's
 * reader may see it. KeyCortexGenomeContextService loads the genome per business, with no viewer,
 * and a chat turn hands it to the model prompt, the answer (genomeInsights, proactiveSuggestions)
 * and the stream's genome alert. A reader without revenue read is handed:
 *   - no finance signal (isFinanceSignal on the signal's source module, as the gated genome
 *     signal routes read it);
 *   - no finance recommendation or suggestion (isFinanceRecommendation on its domain/category);
 *   - no opportunity: each carries an estimatedValue in money.
 * Everything else (DNA scores, stage, readiness, the other modules' rows) is unchanged. A revenue
 * reader gets the genome as loaded. The inputs are never changed (the context may be the cached one).
 */
import { isFinanceRecommendation, isFinanceSignal } from '../business-genome/key-genome/genome-finance-scope';
import type { GenomeEnrichedContext, GenomeRecommendation } from './key-cortex-reasoning.types';

export function genomeContextForReader(context: GenomeEnrichedContext, readsRevenue: boolean): GenomeEnrichedContext {
  if (readsRevenue) return context;
  return {
    ...context,
    signals: (context.signals ?? []).filter((s) => !isFinanceSignal({ sourceModule: s.module })),
    recommendations: genomeRecommendationsForReader(context.recommendations ?? [], false),
    opportunities: [],
  };
}

export function genomeRecommendationsForReader<T extends Pick<GenomeRecommendation, 'category'>>(rows: T[], readsRevenue: boolean): T[] {
  if (readsRevenue) return rows;
  return rows.filter((r) => !isFinanceRecommendation({ domain: r.category }));
}

/** Proactive suggestions carry the recommendation's domain, or the signal's module, as their category. */
export function genomeSuggestionsForReader<T extends { category?: string | null }>(rows: T[], readsRevenue: boolean): T[] {
  if (readsRevenue) return rows;
  return rows.filter((s) => !isFinanceRecommendation({ domain: s.category }) && !isFinanceSignal({ sourceModule: s.category }));
}
