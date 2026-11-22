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
import { dnaScoresForReader, isFinanceRecommendation, isFinanceSignal } from '../business-genome/key-genome/genome-finance-scope';
import type { GenomeEnrichedContext, GenomeRecommendation } from './key-cortex-reasoning.types';

export function genomeContextForReader(context: GenomeEnrichedContext, readsRevenue: boolean): GenomeEnrichedContext {
  if (readsRevenue) return context;
  return {
    ...context,
    dnaScores: dnaScoresForReader(context.dnaScores, false) as Record<string, number>,
    signals: (context.signals ?? []).filter((s) => !isFinanceSignal({ sourceModule: s.module, section: s.section, domain: s.domain, signalType: s.type })),
    recommendations: genomeRecommendationsForReader(context.recommendations ?? [], false),
    opportunities: [],
  };
}

export function genomeRecommendationsForReader<T extends Pick<GenomeRecommendation, 'category'>>(rows: T[], readsRevenue: boolean): T[] {
  if (readsRevenue) return rows;
  // The ranking score weighs the financial value (GenomeRecommendationRanker): withheld (security review MINOR-7).
  return rows
    .filter((r) => !isFinanceRecommendation({ domain: r.category, title: (r as { title?: string }).title }))
    .map((r) => {
      if (!('genomeScore' in r)) return r;
      const { genomeScore: _withheld, ...rest } = r as T & { genomeScore?: number };
      return rest as T;
    });
}

/** Proactive suggestions carry the recommendation's domain, or the signal's module, as their category. */
export function genomeSuggestionsForReader<T extends { category?: string | null }>(rows: T[], readsRevenue: boolean): T[] {
  if (readsRevenue) return rows;
  // A suggestion's category is a recommendation domain or a signal's module (a label only), so it is
  // judged as a domain; suggestions built from signals already come from the projected signals.
  return rows.filter((s) => !isFinanceRecommendation({ domain: s.category }));
}
