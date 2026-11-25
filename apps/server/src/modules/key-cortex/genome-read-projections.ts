/**
 * P82 — FU-KEY-GENOME-READS-RESIDUAL-2 (D-100, D-128, D-233, D-234, D-235):
 * Pure per-reader projections for residual live KEY genome, blueprint, fact,
 * module readiness, and V2 context reads. All projections fail closed and
 * never mutate input objects/arrays.
 */
import {
  dnaScoresForReader,
  isFinanceRecommendation,
  isMoneyLabel,
  proposalTextStatesMoney,
  structuredValueStatesMoney,
} from '../business-genome/key-genome/genome-finance-scope';

/** Blueprint top-level sections / composite scores that carry or aggregate money/sales/cap-table/untyped data. */
const BLUEPRINT_MONEY_KEYS = new Set([
  'financials',
  'taxProfile',
  'projectionProfile',
  'offerArchitecture',
  'salesSystem',
  'riskProfile',
  'ownershipProfile',
  'businessAssets',
  'completeness',
  'readinessScore',
  'genomeIntegrity',
  'genomeStage',
  'executiveReadinessScore',
  'summary',
]);

/** Nested keys inside non-money blueprint sections that carry revenue/tax/commerce/sales indicators. */
const BLUEPRINT_NESTED_MONEY_KEYS = new Set([
  'revenueModel',
  'pricingModel',
  'budgetRange',
  'expenseRatio',
  'quoteConversionRate',
  'recentMomentumScore',
  'vatStatus',
  'birStatus',
  'businessBankStatus',
  'retainerCycle',
  'quoteDrivenSales',
  'ecommerceFulfillment',
  'complianceScore',
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

/** V2 genome keys that expose whole-genome categorical/progress scores derived from financial DNA. */
const V2_GENOME_WITHHELD_KEYS = new Set([
  'currentStage',
  'genomeStage',
  'stageProgress',
  'growthTrajectory',
  'readinessScore',
  'executiveReadiness',
]);

function stringStatesMoney(value: string): boolean {
  return isMoneyLabel(value) || proposalTextStatesMoney(value);
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return Boolean(val && typeof val === 'object' && !Array.isArray(val));
}

/**
 * Recursively sanitize an arbitrary blueprint sub-value without mutating input:
 * drops keys in `BLUEPRINT_NESTED_MONEY_KEYS` or matching `isMoneyLabel`, drops
 * money-worded strings/array items, and drops structured array items that state money.
 */
function sanitizeBlueprintValue(val: unknown, depth = 0): unknown {
  if (depth > 8) return undefined;
  if (val === null || val === undefined) return val;
  if (typeof val === 'string') {
    return stringStatesMoney(val) ? undefined : val;
  }
  if (Array.isArray(val)) {
    const out: unknown[] = [];
    for (const item of val) {
      if (typeof item === 'string') {
        if (!stringStatesMoney(item)) out.push(item);
      } else if (isPlainObject(item)) {
        if (structuredValueStatesMoney(item)) continue;
        const cleaned = sanitizeBlueprintValue(item, depth + 1);
        if (isPlainObject(cleaned) && Object.keys(cleaned).length > 0) {
          out.push(cleaned);
        }
      } else if (item !== undefined) {
        out.push(item);
      }
    }
    return out;
  }
  if (isPlainObject(val)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val)) {
      if (BLUEPRINT_NESTED_MONEY_KEYS.has(k) || isMoneyLabel(k) || proposalTextStatesMoney(k)) {
        continue;
      }
      const cleaned = sanitizeBlueprintValue(v, depth + 1);
      if (cleaned !== undefined) {
        out[k] = cleaned;
      }
    }
    return out;
  }
  return val;
}

/**
 * Project a `BlueprintData` (or `BlueprintContext`) object for the caller's revenue visibility.
 * Never mutates the input object.
 */
export function blueprintForReader<T extends Record<string, unknown>>(
  blueprint: T | null | undefined,
  readsRevenue = false,
): T | null | undefined {
  if (!blueprint || readsRevenue) return blueprint;

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(blueprint)) {
    if (BLUEPRINT_MONEY_KEYS.has(key) || isMoneyLabel(key)) continue;

    if (key === 'genomeDnaScores' && isPlainObject(val)) {
      out[key] = dnaScoresForReader(val as Record<string, number>, false);
      continue;
    }

    if (key === 'genomeDnaConfidence' && isPlainObject(val)) {
      out[key] = dnaScoresForReader(val as Record<string, number>, false);
      continue;
    }

    if (key === 'confidenceScores' && isPlainObject(val)) {
      const cs: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val)) {
        if (BLUEPRINT_MONEY_KEYS.has(k) || isMoneyLabel(k)) continue;
        cs[k] = v;
      }
      out[key] = cs;
      continue;
    }

    const sanitized = sanitizeBlueprintValue(val);
    if (sanitized !== undefined) {
      out[key] = sanitized;
    }
  }

  return out as T;
}

/**
 * Project a `GenomeIntegrityResult` for the caller's revenue visibility:
 * - Strips money/sales DNA sections and enforces D-233 allowlist on `genomeDnaScores`,
 *   `genomeDnaConfidence`, and `readinessBreakdown`.
 * - Scrubs money field names/sentences from kept `dnaSections` (`missingFields`, `summary`, `recommendation`).
 * - Omits `genomeStage` (which encodes `REVENUE_ENGINE`).
 * - Recomputes `genomeIntegrity` and `executiveReadinessScore` strictly from visible sections.
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
  const visibleSections = rawSections
    .filter(
      (s): s is Record<string, unknown> =>
        Boolean(isPlainObject(s) && typeof s.key === 'string' && visibleKeys.has(s.key)),
    )
    .map((s) => {
      const copy: Record<string, unknown> = { ...s };
      if (Array.isArray(s.missingFields)) {
        copy.missingFields = s.missingFields.filter(
          (f): f is string => typeof f === 'string' && !stringStatesMoney(f),
        );
      }
      if (typeof s.summary === 'string' && stringStatesMoney(s.summary)) {
        copy.summary = '';
      }
      if (typeof s.recommendation === 'string' && stringStatesMoney(s.recommendation)) {
        copy.recommendation = '';
      }
      return copy;
    });

  const visibleIntegrities = visibleSections
    .map((s) => Number(s.integrity))
    .filter((n) => Number.isFinite(n));
  const recomputedIntegrity =
    visibleIntegrities.length > 0
      ? Math.round(visibleIntegrities.reduce((sum, v) => sum + v, 0) / visibleIntegrities.length)
      : 0;

  const rawBreakdown = isPlainObject(integrity.readinessBreakdown)
    ? (integrity.readinessBreakdown as Record<string, number>)
    : {};
  // D-233: allowlist via dnaScoresForReader so unknown dimensions fail closed.
  const visibleBreakdown = dnaScoresForReader(rawBreakdown, false);

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

function isUnclassifiedLabel(value: string | null | undefined): boolean {
  return typeof value !== 'string' || value.trim() === '' || /^general$/i.test(value.trim());
}

function isRiskLabel(value: string | null | undefined): boolean {
  return typeof value === 'string' && /(^risk(_|profile|\b)|riskprofile)/i.test(value.trim());
}

/**
 * Filter `GenomeFactData` rows for the caller's revenue visibility (D-234):
 * - Fails closed when `section` and `domain` are both blank/null/`'general'`.
 * - Withholds money provenance (`sourceModule`, `sourceType`, `sourceEntityType`) and `riskProfile` facts.
 * - Checks `section`, `domain`, `field` via `isMoneyLabel` + `proposalTextStatesMoney`.
 * - Mirrors `isFinanceSignal` (Codex P1 on #228): wraps `{ [field]: raw }` into `structuredValueStatesMoney`
 *   so figure-word fields paired with numeric values (e.g. `hourlyRate: 250`, `monthlyRent: 4200`) are caught.
 */
const FINANCIAL_CAPTURE_TYPE_PATTERN =
  /\b(?:receipt|invoice|bill|expense|bank|statement|tax|payment|payroll|quote|order)s?\b/i;

function domainHasMoneyBlueprintKey(domain: string | null | undefined): boolean {
  if (typeof domain !== 'string' || !domain.trim()) return false;
  for (const seg of domain.split('.')) {
    const trimmed = seg.trim();
    if (!trimmed) continue;
    if (
      BLUEPRINT_MONEY_KEYS.has(trimmed) ||
      BLUEPRINT_NESTED_MONEY_KEYS.has(trimmed) ||
      isMoneyLabel(trimmed) ||
      isRiskLabel(trimmed) ||
      proposalTextStatesMoney(trimmed)
    ) {
      return true;
    }
  }
  return false;
}

export function genomeFactsForReader<
  T extends {
    section?: string | null;
    domain?: string | null;
    field?: string | null;
    value?: unknown;
    sourceModule?: string | null;
    sourceType?: string | null;
    sourceEntityType?: string | null;
  },
>(facts: T[], readsRevenue = false): T[] {
  if (readsRevenue) return facts;
  return facts.filter((f) => {
    if (isUnclassifiedLabel(f.section) && isUnclassifiedLabel(f.domain)) {
      return false;
    }
    if (
      isMoneyLabel(f.section) ||
      isMoneyLabel(f.domain) ||
      isMoneyLabel(f.field) ||
      isMoneyLabel(f.sourceModule) ||
      isMoneyLabel(f.sourceType) ||
      isMoneyLabel(f.sourceEntityType) ||
      isRiskLabel(f.section) ||
      isRiskLabel(f.domain) ||
      domainHasMoneyBlueprintKey(f.domain)
    ) {
      return false;
    }
    const fieldTrimmed = typeof f.field === 'string' ? f.field.trim() : '';
    if (
      fieldTrimmed &&
      (BLUEPRINT_MONEY_KEYS.has(fieldTrimmed) ||
        BLUEPRINT_NESTED_MONEY_KEYS.has(fieldTrimmed) ||
        proposalTextStatesMoney(fieldTrimmed))
    ) {
      return false;
    }
    if (typeof f.domain === 'string' && proposalTextStatesMoney(f.domain)) {
      return false;
    }
    const raw = (f.value as { raw?: unknown } | null | undefined)?.raw ?? f.value;
    if (typeof raw === 'string' && proposalTextStatesMoney(raw)) {
      return false;
    }
    if (structuredValueStatesMoney(raw)) {
      return false;
    }
    // Check paired `{ [key]: raw }` against both `f.field` and the leaf segment of `f.domain`
    // (KeyGenomeBackfillService writes `domain: "operationsSystem.hourlyRate", field: "value"`).
    if (raw !== undefined && raw !== null) {
      const domainLeaf =
        typeof f.domain === 'string' && f.domain.includes('.')
          ? f.domain.split('.').pop()?.trim() || null
          : null;
      for (const candidateKey of [fieldTrimmed || null, domainLeaf]) {
        if (!candidateKey) continue;
        const paired = Object.defineProperty(Object.create(null), candidateKey, { value: raw, enumerable: true });
        if (structuredValueStatesMoney(paired)) return false;
      }
    }
    return true;
  });
}

function isMoneyReqFact(item: unknown): boolean {
  if (!isPlainObject(item)) return false;
  const f = item as { section?: string; domain?: string; field?: string; reason?: string };
  return (
    isMoneyLabel(f.section) ||
    isMoneyLabel(f.domain) ||
    isMoneyLabel(f.field) ||
    isRiskLabel(f.section) ||
    isRiskLabel(f.domain) ||
    domainHasMoneyBlueprintKey(f.domain) ||
    (typeof f.field === 'string' &&
      (BLUEPRINT_MONEY_KEYS.has(f.field.trim()) ||
        BLUEPRINT_NESTED_MONEY_KEYS.has(f.field.trim()) ||
        proposalTextStatesMoney(f.field))) ||
    (typeof f.domain === 'string' && proposalTextStatesMoney(f.domain)) ||
    (typeof f.reason === 'string' && stringStatesMoney(f.reason))
  );
}

function projectSingleReadiness<T extends Record<string, unknown>>(entry: T): T | null {
  const mod = typeof entry.module === 'string' ? entry.module : null;
  if (!mod || isMoneyLabel(mod) || V2_MONEY_MODULES.has(mod.toLowerCase())) {
    return null;
  }

  const filterReqFacts = (list: unknown) =>
    Array.isArray(list) ? list.filter((item) => !isMoneyReqFact(item)) : list;

  const rawRequired = Array.isArray(entry.requiredFacts) ? entry.requiredFacts : null;
  const visibleRequired = rawRequired ? rawRequired.filter((item) => !isMoneyReqFact(item)) : null;

  // If a module had required facts and EVERY one was money-scoped (e.g. `reports`), withhold the module.
  if (rawRequired && rawRequired.length > 0 && visibleRequired && visibleRequired.length === 0) {
    return null;
  }

  const rawMissing = Array.isArray(entry.missingFacts) ? entry.missingFacts : null;
  const visibleMissing = rawMissing ? rawMissing.filter((item) => !isMoneyReqFact(item)) : null;
  const visibleOptional = filterReqFacts(entry.optionalFacts);

  // Collect identifiers (`domain.field`) of withheld facts so blockedReasons / recommendedSetupActions
  // (e.g. "Missing degraded fact: risk.top_risks") cannot leak them back in prose.
  const withheldFactRefs: string[] = [];
  for (const list of [rawMissing, rawRequired]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!isMoneyReqFact(item) || !isPlainObject(item)) continue;
      const d = typeof item.domain === 'string' ? item.domain.trim() : '';
      const f = typeof item.field === 'string' ? item.field.trim() : '';
      if (d && f) withheldFactRefs.push(`${d}.${f}`.toLowerCase());
    }
  }
  const keepsReadinessMessage = (s: unknown): s is string => {
    if (typeof s !== 'string') return false;
    if (stringStatesMoney(s) || isRiskLabel(s)) return false;
    const lower = s.toLowerCase();
    for (const ref of withheldFactRefs) {
      if (lower.includes(ref)) return false;
    }
    return true;
  };

  const visibleBlockedReasons = Array.isArray(entry.blockedReasons)
    ? entry.blockedReasons.filter(keepsReadinessMessage)
    : entry.blockedReasons;

  const visibleSetupActions = Array.isArray(entry.recommendedSetupActions)
    ? entry.recommendedSetupActions.filter(keepsReadinessMessage)
    : entry.recommendedSetupActions;

  const out: Record<string, unknown> = {
    ...entry,
    ...(visibleRequired !== null ? { requiredFacts: visibleRequired } : {}),
    ...(visibleMissing !== null ? { missingFacts: visibleMissing } : {}),
    ...(entry.optionalFacts !== undefined ? { optionalFacts: visibleOptional } : {}),
    ...(entry.blockedReasons !== undefined ? { blockedReasons: visibleBlockedReasons } : {}),
    ...(entry.recommendedSetupActions !== undefined ? { recommendedSetupActions: visibleSetupActions } : {}),
  };

  // Recompute readinessScore, automationAllowed, and riskLevel strictly from visible facts
  // so missing hidden financial facts cannot be inferred mathematically.
  if (visibleRequired !== null && visibleMissing !== null) {
    const reqTotal = visibleRequired.length;
    const missingCount = Math.min(reqTotal, visibleMissing.length);
    const recomputedScore = reqTotal > 0 ? Math.round(((reqTotal - missingCount) / reqTotal) * 100) : 100;
    const hasBlockingMissing = visibleMissing.some(
      (m) => isPlainObject(m) && String(m.impact ?? '').toUpperCase() === 'BLOCKING',
    );
    const hasDegradedMissing = visibleMissing.some(
      (m) => isPlainObject(m) && String(m.impact ?? '').toUpperCase() === 'DEGRADED',
    );
    if (out.readinessScore !== undefined) out.readinessScore = recomputedScore;
    if (out.automationAllowed !== undefined) out.automationAllowed = !hasBlockingMissing;
    if (out.riskLevel !== undefined) {
      out.riskLevel = hasBlockingMissing ? 'HIGH' : hasDegradedMissing ? 'MEDIUM' : 'LOW';
    }
  }

  return out as T;
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

function filterMoneyItems<T>(list: T[]): T[] {
  return list.filter((item) => {
    if (typeof item === 'string') return !stringStatesMoney(item);
    if (isPlainObject(item)) return !structuredValueStatesMoney(item);
    return true;
  });
}

/**
 * Project `ContextV2Service.getFullContext()` output for the caller's revenue visibility.
 * Never mutates the input object.
 */
export function v2ContextForReader<T extends Record<string, unknown>>(
  v2Context: T | null | undefined,
  readsRevenue = false,
): T | null | undefined {
  if (!v2Context || readsRevenue) return v2Context;

  const out: Record<string, unknown> = {};
  for (const [mod, val] of Object.entries(v2Context)) {
    if (V2_MONEY_MODULES.has(mod.toLowerCase()) || isMoneyLabel(mod)) continue;

    if (mod === 'summary' && isPlainObject(val)) {
      const projectedSummary: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val)) {
        if (k === 'totalRevenueOutstanding' || k === 'healthScore' || isMoneyLabel(k)) continue;
        if (k === 'alerts' && Array.isArray(v)) {
          projectedSummary[k] = v.filter((a) => typeof a === 'string' && !stringStatesMoney(a));
          continue;
        }
        projectedSummary[k] = v;
      }
      out[mod] = projectedSummary;
      continue;
    }

    if (mod === 'bookings' && isPlainObject(val)) {
      const projectedBookings: Record<string, unknown> = { ...val };
      if (isPlainObject(val.todayBookings)) {
        const tb: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(val.todayBookings)) {
          if (k === 'totalValue' || isMoneyLabel(k)) continue;
          tb[k] = v;
        }
        projectedBookings.todayBookings = tb;
      }
      out[mod] = projectedBookings;
      continue;
    }

    if (mod === 'genome' && isPlainObject(val)) {
      const projectedGenome: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val)) {
        if (V2_GENOME_WITHHELD_KEYS.has(k) || isMoneyLabel(k)) continue;
        if (k === 'dnaScores' && isPlainObject(v)) {
          projectedGenome[k] = dnaScoresForReader(v as Record<string, number>, false);
          continue;
        }
        if (k === 'recommendations' && Array.isArray(v)) {
          projectedGenome[k] = v.filter((rec) => {
            if (typeof rec === 'string') return !stringStatesMoney(rec);
            if (!isPlainObject(rec)) return false;
            const r = rec as { domain?: string; category?: string; title?: string; diagnosis?: string };
            return (
              !isFinanceRecommendation({
                domain: r.domain ?? r.category ?? null,
                title: r.title ?? null,
                diagnosis: r.diagnosis ?? null,
              }) &&
              !(typeof r.title === 'string' && stringStatesMoney(r.title)) &&
              !structuredValueStatesMoney(r)
            );
          });
          continue;
        }
        projectedGenome[k] = v;
      }
      out[mod] = projectedGenome;
      continue;
    }

    if (mod === 'crm' && isPlainObject(val)) {
      const projectedCrm: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val)) {
        if ((k === 'recentActivity' || k === 'overdueTasks') && Array.isArray(v)) {
          projectedCrm[k] = filterMoneyItems(v);
          continue;
        }
        if (isMoneyLabel(k)) continue;
        projectedCrm[k] = v;
      }
      out[mod] = projectedCrm;
      continue;
    }

    if (mod === 'temporal' && isPlainObject(val)) {
      out[mod] = {
        ...val,
        ...(Array.isArray(val.recentMemories) ? { recentMemories: filterMoneyItems(val.recentMemories) } : {}),
        ...(Array.isArray(val.patternsDetected) ? { patternsDetected: filterMoneyItems(val.patternsDetected) } : {}),
      };
      continue;
    }

    if (mod === 'autopilot' && isPlainObject(val)) {
      out[mod] = {
        ...val,
        ...(Array.isArray(val.activeTasks) ? { activeTasks: filterMoneyItems(val.activeTasks) } : {}),
      };
      continue;
    }

    if (mod === 'inbox' && isPlainObject(val)) {
      const projectedInbox: Record<string, unknown> = {
        ...val,
        ...(Array.isArray(val.urgentMessages) ? { urgentMessages: filterMoneyItems(val.urgentMessages) } : {}),
      };
      if (typeof val.aiSummary === 'string' && stringStatesMoney(val.aiSummary)) {
        delete projectedInbox.aiSummary;
      }
      out[mod] = projectedInbox;
      continue;
    }

    if (mod === 'device' && isPlainObject(val)) {
      out[mod] = {
        ...val,
        ...(Array.isArray(val.recentCaptures)
          ? {
              recentCaptures: val.recentCaptures.filter((c) => {
                if (!isPlainObject(c)) return true;
                if (
                  typeof c.detectedType === 'string' &&
                  (stringStatesMoney(c.detectedType) || FINANCIAL_CAPTURE_TYPE_PATTERN.test(c.detectedType))
                ) {
                  return false;
                }
                return !structuredValueStatesMoney(c);
              }),
            }
          : {}),
        ...(Array.isArray(val.linkedCommandItems)
          ? { linkedCommandItems: filterMoneyItems(val.linkedCommandItems) }
          : {}),
      };
      continue;
    }

    out[mod] = val;
  }

  return out as T;
}
