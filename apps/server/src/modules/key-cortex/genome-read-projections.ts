/**
 * P82 — FU-KEY-GENOME-READS-RESIDUAL-2 (D-100, D-128, D-233, D-234, D-235):
 * Pure per-reader projections for residual live KEY genome, blueprint, fact,
 * module readiness, and V2 context reads. All projections fail closed: when
 * `readsRevenue` is false, financial/sales/tax/projection/commerce fields,
 * composite scores derived from them, and money-worded entries are withheld.
 */
import {
  dnaScoresForReader,
  isFinanceRecommendation,
  isMoneyLabel,
  proposalTextStatesMoney,
  structuredValueStatesMoney,
} from '../business-genome/key-genome/genome-finance-scope';

/** Blueprint top-level sections / composite scores that carry or aggregate money/sales data. */
const BLUEPRINT_MONEY_KEYS = new Set([
  'financials',
  'taxProfile',
  'projectionProfile',
  'offerArchitecture',
  'salesSystem',
  'riskProfile',
  'completeness',
  'readinessScore',
  'genomeIntegrity',
  'genomeStage',
  'executiveReadinessScore',
]);

/** V2 context top-level modules that carry money/revenue/sales/expense data. */
const V2_MONEY_MODULES = new Set([
  'commerce',
  'finance',
  'expenses',
  'revenue',
  'payroll',
  'billing',
  'accounting',
  'sales',
]);

/**
 * Project a `BlueprintData` object for the caller's revenue visibility.
 */
export function blueprintForReader<T extends Record<string, unknown>>(
  blueprint: T | null | undefined,
  readsRevenue = false,
): T | null | undefined {
  if (!blueprint || readsRevenue) return blueprint;

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(blueprint)) {
    if (BLUEPRINT_MONEY_KEYS.has(key) || isMoneyLabel(key)) continue;

    if (key === 'operatingModel' && val && typeof val === 'object' && !Array.isArray(val)) {
      const om: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        if (k === 'revenueModel' || k === 'pricingModel' || isMoneyLabel(k)) continue;
        om[k] = v;
      }
      out[key] = om;
      continue;
    }

    if (key === 'constraints' && val && typeof val === 'object' && !Array.isArray(val)) {
      const c: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        if (k === 'budgetRange' || isMoneyLabel(k)) continue;
        c[k] = v;
      }
      out[key] = c;
      continue;
    }

    if (key === 'genomeDnaScores' && val && typeof val === 'object' && !Array.isArray(val)) {
      out[key] = dnaScoresForReader(val as Record<string, number>, false);
      continue;
    }

    if (key === 'genomeDnaConfidence' && val && typeof val === 'object' && !Array.isArray(val)) {
      out[key] = dnaScoresForReader(val as Record<string, number>, false);
      continue;
    }

    if (key === 'confidenceScores' && val && typeof val === 'object' && !Array.isArray(val)) {
      const cs: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        if (BLUEPRINT_MONEY_KEYS.has(k) || isMoneyLabel(k)) continue;
        cs[k] = v;
      }
      out[key] = cs;
      continue;
    }

    out[key] = val;
  }

  return out as T;
}

/**
 * Project a `GenomeIntegrityResult` for the caller's revenue visibility:
 * strips money/sales DNA sections & breakdown entries, omits `genomeStage`
 * (which encodes `REVENUE_ENGINE`), and recomputes `genomeIntegrity` and
 * `executiveReadinessScore` strictly from visible non-money sections so hidden
 * financial scores cannot be back-calculated from the average.
 */
export function genomeIntegrityForReader<T extends Record<string, unknown>>(
  integrity: T | null | undefined,
  readsRevenue = false,
): T | null | undefined {
  if (!integrity || readsRevenue) return integrity;

  const rawScores = (integrity.genomeDnaScores ?? {}) as Record<string, number>;
  const rawConf = (integrity.genomeDnaConfidence ?? {}) as Record<string, number>;
  const visibleScores = dnaScoresForReader(rawScores, false);
  const visibleConf = dnaScoresForReader(rawConf, false);
  const visibleKeys = new Set(Object.keys(visibleScores));

  const rawSections = Array.isArray(integrity.dnaSections) ? integrity.dnaSections : [];
  const visibleSections = rawSections.filter(
    (s): s is Record<string, unknown> =>
      Boolean(s && typeof s === 'object' && typeof (s as { key?: unknown }).key === 'string' && visibleKeys.has((s as { key: string }).key)),
  );

  const visibleIntegrities = visibleSections
    .map((s) => Number(s.integrity))
    .filter((n) => Number.isFinite(n));
  const recomputedIntegrity =
    visibleIntegrities.length > 0
      ? Math.round(visibleIntegrities.reduce((sum, v) => sum + v, 0) / visibleIntegrities.length)
      : 0;

  const rawBreakdown =
    integrity.readinessBreakdown && typeof integrity.readinessBreakdown === 'object' && !Array.isArray(integrity.readinessBreakdown)
      ? (integrity.readinessBreakdown as Record<string, unknown>)
      : {};
  const visibleBreakdown: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawBreakdown)) {
    if (isMoneyLabel(k)) continue;
    visibleBreakdown[k] = v;
  }

  const out: Record<string, unknown> = {
    ...integrity,
    genomeIntegrity: recomputedIntegrity,
    genomeDnaScores: visibleScores,
    genomeDnaConfidence: visibleConf,
    dnaSections: visibleSections,
    executiveReadinessScore: recomputedIntegrity,
    readinessBreakdown: visibleBreakdown,
  };
  delete out.genomeStage;
  return out as T;
}

/**
 * Filter `GenomeFactData` rows for the caller's revenue visibility.
 * Withholds facts in money sections/domains/fields or whose value states money.
 */
export function genomeFactsForReader<
  T extends { section?: string | null; domain?: string | null; field?: string | null; value?: unknown },
>(facts: T[], readsRevenue = false): T[] {
  if (readsRevenue) return facts;
  return facts.filter((f) => {
    if (isMoneyLabel(f.section) || isMoneyLabel(f.domain) || isMoneyLabel(f.field)) {
      return false;
    }
    const raw = (f.value as { raw?: unknown } | null | undefined)?.raw ?? f.value;
    if (typeof raw === 'string') {
      return !proposalTextStatesMoney(raw);
    }
    return !structuredValueStatesMoney(raw);
  });
}

function projectSingleReadiness<T extends Record<string, unknown>>(entry: T): T | null {
  const mod = typeof entry.module === 'string' ? entry.module : null;
  if (!mod || isMoneyLabel(mod) || V2_MONEY_MODULES.has(mod.toLowerCase())) {
    return null;
  }
  const filterReqFacts = (list: unknown) =>
    Array.isArray(list)
      ? list.filter((item) => {
          if (!item || typeof item !== 'object') return true;
          const f = item as { section?: string; domain?: string; field?: string; reason?: string };
          return (
            !isMoneyLabel(f.section) &&
            !isMoneyLabel(f.domain) &&
            !isMoneyLabel(f.field) &&
            !(typeof f.reason === 'string' && proposalTextStatesMoney(f.reason))
          );
        })
      : list;

  return {
    ...entry,
    ...(entry.missingFacts !== undefined ? { missingFacts: filterReqFacts(entry.missingFacts) } : {}),
    ...(entry.requiredFacts !== undefined ? { requiredFacts: filterReqFacts(entry.requiredFacts) } : {}),
  };
}

/**
 * Project `ModuleReadinessData | ModuleReadinessData[] | null` for the caller's revenue visibility.
 */
export function moduleReadinessForReader<T extends Record<string, unknown>>(
  readiness: T | T[] | null | undefined,
  readsRevenue = false,
): T | T[] | null | undefined {
  if (!readiness || readsRevenue) return readiness;
  if (Array.isArray(readiness)) {
    return readiness
      .map((entry) => projectSingleReadiness(entry))
      .filter((entry): entry is T => entry !== null);
  }
  return projectSingleReadiness(readiness);
}

/**
 * Project `ContextV2Service.getFullContext()` output for the caller's revenue visibility.
 * Omits `commerce`, `finance`, `expenses`, `revenue`, `payroll`, `billing`, `accounting`, `sales`,
 * and projects the nested `genome` block (DNA scores, recommendations, omits `currentStage`/`readinessScore`).
 */
export function v2ContextForReader<T extends Record<string, unknown>>(
  v2Context: T | null | undefined,
  readsRevenue = false,
): T | null | undefined {
  if (!v2Context || readsRevenue) return v2Context;

  const out: Record<string, unknown> = {};
  for (const [mod, val] of Object.entries(v2Context)) {
    if (V2_MONEY_MODULES.has(mod.toLowerCase()) || isMoneyLabel(mod)) continue;

    if (mod === 'genome' && val && typeof val === 'object' && !Array.isArray(val)) {
      const g = val as Record<string, unknown>;
      const projectedGenome: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(g)) {
        if (k === 'currentStage' || k === 'genomeStage' || k === 'readinessScore' || k === 'executiveReadiness' || isMoneyLabel(k)) {
          continue;
        }
        if (k === 'dnaScores' && v && typeof v === 'object' && !Array.isArray(v)) {
          projectedGenome[k] = dnaScoresForReader(v as Record<string, number>, false);
          continue;
        }
        if (k === 'recommendations' && Array.isArray(v)) {
          projectedGenome[k] = v.filter((rec) => {
            if (!rec || typeof rec !== 'object') return false;
            const r = rec as { domain?: string; category?: string; title?: string; diagnosis?: string };
            return (
              !isFinanceRecommendation({
                domain: r.domain ?? r.category ?? null,
                title: r.title ?? null,
                diagnosis: r.diagnosis ?? null,
              }) &&
              !(typeof r.title === 'string' && proposalTextStatesMoney(r.title))
            );
          });
          continue;
        }
        projectedGenome[k] = v;
      }
      out[mod] = projectedGenome;
      continue;
    }

    out[mod] = val;
  }

  return out as T;
}
