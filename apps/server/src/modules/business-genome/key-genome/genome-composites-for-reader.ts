/**
 * FU-GENOME-SURFACES-REVENUE (owner rulings D-233, D-234; D-128, D-100). The genome's composites as a reader may see
 * them. A DNA score of the finance, sales or business dimension is finance even with no currency in it (D-233/D-234),
 * and so is every composite that weights it:
 *   - the genome integrity averages financial (15), sales (5) and business DNA in, or uses the fact kernel's overall;
 *   - the executive readiness weights financial (20) and sales (10) DNA in;
 *   - the genome stage reads financial (>= 40) and sales (>= 50) thresholds;
 *   - the KEY genome score's overall, integrity, readiness and confidence average FINANCIAL, SALES, OFFER_PRODUCT and
 *     BUSINESS_MODEL sections in.
 *
 * Contract: withhold composites as `null` + `withheldForRevenue` (do NOT recompute inferable totals). Inputs are never
 * mutated so shared results remain safe across interleaved readers.
 */
import type { PrismaService } from '../../../core/prisma/prisma.service';
import type { DnaSectionKey, DnaSectionScore, GenomeIntegrityResult } from '../../blueprint/blueprint.types';
import type { TemporalFlowService } from '../../temporal-flow/temporal-flow.service';
import type { TemporalFlowAnalysis } from '../../temporal-flow/temporal-flow.types';
import {
  dnaScoresForReader,
  genomeReaderReadsRevenue,
  isFinanceSignal,
  isMoneyLabel,
  proposalTextStatesMoney,
  structuredValueStatesMoney,
  type GenomeReader,
} from './genome-finance-scope';
import { DNA_TO_KEY_GENOME_SECTION } from './key-genome.service';
import type { ModuleReadinessData } from './key-genome.types';
import type { ConstitutionStaleness, ConstitutionVersionData } from '../constitution-version.types';

/** The composites withheld from a reader without revenue read. */
export const GENOME_COMPOSITES = ['genomeIntegrity', 'executiveReadinessScore', 'genomeStage'] as const;

/** Whether `key` is a DNA dimension a reader without revenue read is served (dnaScoresForReader's allowlist). */
export function isServedDnaKey(key: string): boolean {
  return Object.keys(dnaScoresForReader({ [key]: 0 }, false)).length === 1;
}

/** The KEY genome sections a reader without revenue read is served: those the served DNA keys map to. */
const SERVED_KEY_SECTIONS: ReadonlySet<string> = new Set(
  (Object.entries(DNA_TO_KEY_GENOME_SECTION) as [DnaSectionKey, string][])
    .filter(([key]) => isServedDnaKey(key))
    .map(([, section]) => section),
);

/** Whether a KEY genome section (FINANCIAL, SALES, OFFER_PRODUCT, BUSINESS_MODEL, ...) is served to non-revenue readers. */
export function isServedKeySection(section: string | null | undefined): boolean {
  return typeof section === 'string' && SERVED_KEY_SECTIONS.has(section.trim().toUpperCase()) && !isMoneyLabel(section);
}

/**
 * Resolve revenue read authority for a reader.
 * - `undefined` is an internal caller (unchanged -> true).
 * - `null` (no member) or missing PrismaService or failed DB read -> false (fail closed).
 */
export async function readsRevenueFor(
  prisma: PrismaService | undefined | null,
  businessId: string,
  reader: GenomeReader | null | undefined,
): Promise<boolean> {
  if (reader === undefined) return true;
  if (!prisma || !reader) return false;
  return genomeReaderReadsRevenue(prisma, businessId, reader).catch(() => false);
}

/**
 * R1-SEC-03: Run TemporalFlowService.analyze with reader-scoped event & memory filters whenever a reader context is
 * present (including `null` fail-closed). Leaves internal callers (`reader === undefined`) unchanged. If a mock
 * TemporalFlowService lacks `readerFilter`/`memorySight` and `!readsRevenue`, fails closed to an empty analysis.
 */
export async function analyzeTemporalForReader(
  temporal: Pick<TemporalFlowService, 'analyze'> &
    Partial<Pick<TemporalFlowService, 'readerFilter' | 'memorySight'>>,
  businessId: string,
  reader: GenomeReader | null | undefined,
  readsRevenue: boolean,
): Promise<TemporalFlowAnalysis> {
  if (reader === undefined) {
    return temporal.analyze(businessId);
  }
  if (typeof temporal.readerFilter !== 'function' || typeof temporal.memorySight !== 'function') {
    if (!readsRevenue) {
      return { summary: '', urgentItems: [], opportunities: [], risks: [], genomeProposalCandidates: [] };
    }
    return temporal.analyze(businessId);
  }
  const [filter, sight] = await Promise.all([
    temporal.readerFilter(businessId, reader ?? undefined),
    temporal.memorySight(businessId, reader ?? undefined),
  ]);
  return temporal.analyze(businessId, filter, sight, reader);
}

export type ProjectedGenome<T> = Omit<T, (typeof GENOME_COMPOSITES)[number]> & {
  genomeIntegrity: number | null;
  executiveReadinessScore: number | null;
  genomeStage: string | null;
  withheldForRevenue?: string[];
};

/**
 * Money fields embedded inside an otherwise-served DNA section (R1-SEC-04): removing them from `fieldsTotal` and
 * `fieldsCaptured` prevents presence/absence inference via counts or section integrity.
 */
const HIDDEN_DNA_SECTION_FIELDS: Partial<Record<DnaSectionKey, ReadonlySet<string>>> = {
  risk: new Set(['financialRisks']),
};

function sanitizeDnaSection<S extends Pick<DnaSectionScore, 'key'>>(section: S): S {
  const rec = section as unknown as Partial<DnaSectionScore> & Record<string, unknown>;
  const hiddenSet = HIDDEN_DNA_SECTION_FIELDS[section.key as DnaSectionKey];
  const rawMissing = Array.isArray(rec.missingFields) ? (rec.missingFields as string[]) : null;
  const cleanMissing = rawMissing
    ? rawMissing.filter((f) => typeof f === 'string' && !hiddenSet?.has(f) && !isMoneyLabel(f) && !proposalTextStatesMoney(f))
    : null;

  const out: Record<string, unknown> = { ...rec };
  if (cleanMissing !== null) out.missingFields = cleanMissing;

  if (hiddenSet && hiddenSet.size > 0) {
    const label = typeof rec.label === 'string' && rec.label ? rec.label : `${section.key} DNA`;
    if (typeof rec.fieldsTotal === 'number' && typeof rec.fieldsCaptured === 'number' && rawMissing !== null) {
      const hiddenMissing = rawMissing.filter((f) => hiddenSet.has(f)).length;
      const hiddenCaptured = Math.max(0, hiddenSet.size - hiddenMissing);
      const nextTotal = Math.max(0, rec.fieldsTotal - hiddenSet.size);
      const nextCaptured = Math.max(0, Math.min(nextTotal, rec.fieldsCaptured - hiddenCaptured));
      const nextIntegrity = nextTotal > 0 ? Math.round((nextCaptured / nextTotal) * 100) : 0;
      out.fieldsTotal = nextTotal;
      out.fieldsCaptured = nextCaptured;
      if (typeof rec.integrity === 'number') out.integrity = nextIntegrity;
      if (typeof rec.confidence === 'number') out.confidence = nextIntegrity;
      if (typeof rec.summary === 'string') {
        if (nextIntegrity === 100) out.summary = `${label} is complete.`;
        else if (nextIntegrity === 0) out.summary = `${label} has not been started.`;
        else {
          const firstMissing = (cleanMissing ?? []).slice(0, 3).join(', ');
          out.summary = firstMissing
            ? `${label} is partially complete. Missing: ${firstMissing}${(cleanMissing?.length ?? 0) > 3 ? '...' : ''}`
            : `${label} is partially complete.`;
        }
      }
      if (typeof rec.recommendation === 'string') {
        out.recommendation =
          cleanMissing && cleanMissing.length > 0
            ? `Add ${cleanMissing[0].replace(/([A-Z])/g, ' $1').toLowerCase()} to strengthen ${label}.`
            : 'No further fields required.';
      }
    }
  }

  if (typeof out.summary === 'string' && (isMoneyLabel(out.summary) || proposalTextStatesMoney(out.summary))) {
    out.summary = '';
  }
  if (
    typeof out.recommendation === 'string' &&
    (isMoneyLabel(out.recommendation) || proposalTextStatesMoney(out.recommendation))
  ) {
    out.recommendation = '';
  }

  return out as S;
}

/** The DNA sections a reader without revenue read is served, scrubbed of embedded money fields/prose. */
export function dnaSectionsForReader<S extends Pick<DnaSectionScore, 'key'>>(
  sections: S[] | null | undefined,
  readsRevenue: boolean,
): S[] {
  const list = sections ?? [];
  return readsRevenue ? list : list.filter((s) => isServedDnaKey(s.key)).map(sanitizeDnaSection);
}

/** The withheld field names: the composites and the money DNA keys. */
function withheldNames(): string[] {
  return [
    ...GENOME_COMPOSITES,
    ...(Object.keys(DNA_TO_KEY_GENOME_SECTION) as string[]).filter((k) => !isServedDnaKey(k)),
  ];
}

/**
 * A genome integrity result (BlueprintService.calculateGenomeIntegrity) as a reader may see it.
 */
export function genomeIntegrityForReader<T extends Partial<GenomeIntegrityResult>>(
  result: T,
  readsRevenue: boolean,
): T | ProjectedGenome<T> {
  if (readsRevenue) return result;
  const out: Record<string, unknown> = { ...result };
  for (const field of GENOME_COMPOSITES) out[field] = null;
  if ('genomeDnaScores' in result) {
    out.genomeDnaScores = dnaScoresForReader(result.genomeDnaScores as Record<string, unknown>, false);
  }
  if ('genomeDnaConfidence' in result) {
    out.genomeDnaConfidence = dnaScoresForReader(result.genomeDnaConfidence as Record<string, unknown>, false);
  }
  if ('readinessBreakdown' in result) {
    out.readinessBreakdown = dnaScoresForReader(result.readinessBreakdown as Record<string, unknown>, false);
  }
  if ('dnaSections' in result) {
    const projectedSections = dnaSectionsForReader(result.dnaSections, false);
    out.dnaSections = projectedSections;
    // Keep scores/confidence/breakdown in sync for sections whose hidden money fields were adjusted (e.g. risk).
    for (const sec of projectedSections) {
      if (!HIDDEN_DNA_SECTION_FIELDS[sec.key as DnaSectionKey]) continue;
      if (out.genomeDnaScores && typeof out.genomeDnaScores === 'object' && sec.key in out.genomeDnaScores) {
        (out.genomeDnaScores as Record<string, unknown>)[sec.key] = sec.integrity;
      }
      if (
        out.genomeDnaConfidence &&
        typeof out.genomeDnaConfidence === 'object' &&
        sec.key in out.genomeDnaConfidence
      ) {
        (out.genomeDnaConfidence as Record<string, unknown>)[sec.key] = sec.confidence;
      }
      if (
        out.readinessBreakdown &&
        typeof out.readinessBreakdown === 'object' &&
        sec.key in out.readinessBreakdown
      ) {
        (out.readinessBreakdown as Record<string, unknown>)[sec.key] = sec.integrity;
      }
    }
  }
  out.withheldForRevenue = withheldNames();
  return out as ProjectedGenome<T>;
}

/**
 * The blueprint columns the financial and sales DNA are counted from.
 */
export const MONEY_BLUEPRINT_COLUMNS = ['financials', 'projectionProfile', 'salesSystem'] as const;

/**
 * Money fields inside otherwise-served blueprint columns (D-100, D-234; rounds 1-2 + R1-SEC-04).
 */
const MONEY_BLUEPRINT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  intelligence: ['recentMomentumScore', 'expenseRatio', 'quoteConversionRate', 'topProductCategories'],
  workflowModel: ['retainerCycle', 'quoteDrivenSales', 'ecommerceFulfillment'],
  taxProfile: ['estimatedAnnualRevenue', 'vatThresholdWatch'],
  riskProfile: ['financialRisks', 'riskScore'],
  operatingModel: ['revenueModel'],
  constraints: ['budgetRange'],
};

const MONEY_WHOLE_COLUMNS: readonly string[] = [...MONEY_BLUEPRINT_COLUMNS, 'offerArchitecture'];

const BLUEPRINT_NON_SANITIZED_TOP_KEYS: ReadonlySet<string> = new Set([
  'id',
  'businessId',
  'schemaVersion',
  'genomeIntegrity',
  'executiveReadinessScore',
  'genomeStage',
  'genomeDnaScores',
  'genomeDnaConfidence',
  'readinessBreakdown',
  'dnaSections',
  'confidenceScores',
  'completeness',
  'readinessScore',
  'withheldForRevenue',
  'genesisCompleted',
  'constitutionVersion',
  'constitutionGeneratedAt',
  'lastGenomeSyncAt',
  'lastAnalyzedAt',
  'updatedAt',
  'createdAt',
  ...MONEY_WHOLE_COLUMNS,
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v && typeof v === 'object' && !Array.isArray(v));
}

/** Recursively scrub money-stating strings/items from kept blueprint columns without dropping benign keys like taxIdStatus. */
function sanitizeKeptBlueprintValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return undefined;
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return proposalTextStatesMoney(value) ? undefined : value;
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      if (typeof item === 'string') {
        if (!proposalTextStatesMoney(item)) out.push(item);
      } else if (isPlainObject(item)) {
        if (structuredValueStatesMoney(item)) continue;
        const cleaned = sanitizeKeptBlueprintValue(item, depth + 1);
        if (isPlainObject(cleaned) && Object.keys(cleaned).length > 0) out.push(cleaned);
      } else if (item !== undefined) {
        out.push(item);
      }
    }
    return out;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const cleaned = sanitizeKeptBlueprintValue(v, depth + 1);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return out;
  }
  return value;
}

/**
 * Setup steps as a reader may see them: omit steps tied to money columns.
 */
export function setupStepsForReader<S extends { id?: string; section?: string }>(
  steps: S[],
  readsRevenue: boolean,
): S[] {
  if (readsRevenue) return steps;
  return steps.filter((s) => !MONEY_WHOLE_COLUMNS.includes(String(s.section ?? s.id)));
}

/**
 * A blueprint (GET or write response) as a reader may see it: composites, money DNA, money columns/fields,
 * completeness and readinessScore withheld, and money-stating prose scrubbed from kept columns.
 */
export function blueprintForReader<T extends Record<string, unknown>>(blueprint: T, readsRevenue: boolean): T {
  if (readsRevenue || !blueprint || typeof blueprint !== 'object') return blueprint;
  const out: Record<string, unknown> = genomeIntegrityForReader(
    blueprint as Partial<GenomeIntegrityResult>,
    false,
  ) as Record<string, unknown>;
  for (const column of MONEY_WHOLE_COLUMNS) {
    if (column in blueprint) out[column] = {};
  }
  for (const [column, fields] of Object.entries(MONEY_BLUEPRINT_FIELDS)) {
    const value = blueprint[column];
    if (!isPlainObject(value)) continue;
    const kept: Record<string, unknown> = { ...value };
    for (const field of fields) delete kept[field];
    out[column] = kept;
  }
  for (const [key, value] of Object.entries(out)) {
    if (BLUEPRINT_NON_SANITIZED_TOP_KEYS.has(key)) continue;
    if (isPlainObject(value) || Array.isArray(value)) {
      const sanitized = sanitizeKeptBlueprintValue(value);
      out[key] = sanitized ?? (Array.isArray(value) ? [] : {});
    } else if (typeof value === 'string' && proposalTextStatesMoney(value)) {
      out[key] = null;
    }
  }
  if (!('dnaSections' in blueprint) && isPlainObject(out.riskProfile)) {
    const nonMoneyRiskFields = ['legalRisks', 'marketRisks', 'operationalRisks', 'founderRisks', 'mitigationPlan'];
    const captured = nonMoneyRiskFields.filter((f) => {
      const v = (out.riskProfile as Record<string, unknown>)[f];
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === 'string') return v.trim().length > 0;
      return v !== null && v !== undefined;
    }).length;
    const riskScore = Math.round((captured / nonMoneyRiskFields.length) * 100);
    if (isPlainObject(out.genomeDnaScores) && 'risk' in out.genomeDnaScores) {
      (out.genomeDnaScores as Record<string, unknown>).risk = riskScore;
    }
    if (isPlainObject(out.genomeDnaConfidence) && 'risk' in out.genomeDnaConfidence) {
      (out.genomeDnaConfidence as Record<string, unknown>).risk = riskScore;
    }
  }
  const confidence = blueprint.confidenceScores;
  if (isPlainObject(confidence)) {
    const kept: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(confidence)) {
      if (!MONEY_WHOLE_COLUMNS.includes(key) && !(key in MONEY_BLUEPRINT_FIELDS)) {
        kept[key] = value;
      }
    }
    out.confidenceScores = kept;
  }
  if ('completeness' in blueprint) out.completeness = null;
  if ('readinessScore' in blueprint) out.readinessScore = null;
  out.withheldForRevenue = [...withheldNames(), 'completeness', 'readinessScore'];
  return out as T;
}

/** A KEY genome score's sections a reader without revenue read is served. */
export function keyGenomeSectionsForReader<S extends { section: string }>(
  sections: S[] | null | undefined,
  readsRevenue: boolean,
): S[] {
  const list = sections ?? [];
  return readsRevenue ? list : list.filter((s) => isServedKeySection(s.section));
}

/** A missing or required genome fact with money provenance (section, domain, field, sourceModule) or unclassified. */
export function isMoneyFact(fact: {
  section?: string | null;
  domain?: string | null;
  field?: string | null;
  sourceModule?: string | null;
}): boolean {
  return (
    isFinanceSignal({
      sourceModule: fact.sourceModule,
      section: fact.section,
      domain: fact.domain,
      field: fact.field,
    }) || !isServedKeySection(fact.section)
  );
}

/**
 * Module readiness as a reader may see it. Withholds WHOLE any module whose name is money OR that requires or misses
 * any money fact (round 1, security MAJOR-2), and filters money optional facts from kept modules.
 */
export function moduleReadinessForReader<R extends Partial<ModuleReadinessData> & { module: string }>(
  rows: R[],
  readsRevenue: boolean,
): R[] {
  if (readsRevenue) return rows;
  const factsOf = (r: R, key: 'missingFacts' | 'requiredFacts') =>
    (Array.isArray(r[key]) ? r[key] : []) as Array<Parameters<typeof isMoneyFact>[0]>;
  return rows
    .filter((r) => !isMoneyLabel(r.module))
    .filter((r) => !factsOf(r, 'requiredFacts').some(isMoneyFact) && !factsOf(r, 'missingFacts').some(isMoneyFact))
    .map((r) => {
      const out: Record<string, unknown> = { ...r };
      for (const key of ['missingFacts', 'requiredFacts', 'optionalFacts'] as const) {
        if (Array.isArray(r[key])) {
          out[key] = (r[key] as Array<Parameters<typeof isMoneyFact>[0]>).filter((f) => !isMoneyFact(f));
        }
      }
      return out as R;
    });
}

/** Constitution sections drawn from a money/business DNA dimension, or with no source named (fail closed). */
function isMoneyConstitutionSection(section: unknown): boolean {
  if (!section || typeof section !== 'object') return true;
  const source = (section as { sourceDna?: unknown }).sourceDna;
  if (!Array.isArray(source) || source.length === 0) return true;
  return source.some((key) => typeof key !== 'string' || !isServedDnaKey(key));
}

function scrubBusinessModelLines(section: Record<string, unknown>): Record<string, unknown> {
  if (typeof section.content !== 'string') return section;
  const content = section.content
    .replace(/\s*Pricing model:[^.]*\.?/gi, '')
    .replace(/\s*Revenue model:[^.]*\.?/gi, '')
    .replace(/\s*Core offer:[^.]*\.?/gi, '')
    .trim();
  return { ...section, content: content || 'Generated from Business DNA.' };
}

/**
 * Constitution content as a reader may see it: composites null, money/business/executive-summary sections dropped,
 * and pricing/revenue-model/core-offer lines scrubbed.
 */
export function constitutionContentForReader<C extends Record<string, unknown>>(content: C, readsRevenue: boolean): C {
  if (readsRevenue || !content || typeof content !== 'object') return content;
  const out: Record<string, unknown> = { ...content };
  for (const field of GENOME_COMPOSITES) if (field in out) out[field] = null;
  const sections = content.sections;
  if (sections && typeof sections === 'object' && !Array.isArray(sections)) {
    const kept: Record<string, unknown> = {};
    for (const [key, section] of Object.entries(sections)) {
      if (isMoneyConstitutionSection(section)) continue;
      kept[key] =
        key === 'businessModel' ? scrubBusinessModelLines(section as Record<string, unknown>) : section;
    }
    out.sections = kept;
  }
  out.withheldForRevenue = withheldNames();
  return out as C;
}

/**
 * Stored Constitution version as a reader may see it: source composites, summary and money DNA withheld; content projected.
 */
export function constitutionVersionForReader<V extends ConstitutionVersionData | null>(
  row: V,
  readsRevenue: boolean,
): V {
  if (readsRevenue || !row) return row;
  return {
    ...row,
    summary: null,
    sourceGenomeIntegrity: null,
    sourceExecutiveReadiness: null,
    sourceGenomeStage: null,
    sourceDnaScores: row.sourceDnaScores ? dnaScoresForReader(row.sourceDnaScores, false) : row.sourceDnaScores,
    sourceDnaConfidence: row.sourceDnaConfidence
      ? dnaScoresForReader(row.sourceDnaConfidence, false)
      : row.sourceDnaConfidence,
    content: constitutionContentForReader(row.content ?? {}, false),
  } as V;
}

/** Staleness as a reader may see it: stale boolean stays, composites withheld as null. */
export function stalenessForReader(staleness: ConstitutionStaleness, readsRevenue: boolean): ConstitutionStaleness {
  if (readsRevenue) return staleness;
  return {
    ...staleness,
    currentGenomeIntegrity: null,
    constitutionGenomeIntegrity: null,
    currentExecutiveReadiness: null,
    constitutionExecutiveReadiness: null,
    currentGenomeStage: null,
    constitutionGenomeStage: null,
  } as unknown as ConstitutionStaleness;
}

const MONEY_CHANNEL_FIELDS = ['monthlyBudget', 'targetCac', 'targetConversionRate'] as const;

/** Growth channel projected for reader: withholds monthlyBudget, targetCac, targetConversionRate. */
export function growthChannelForReader<C extends Record<string, unknown> | null | undefined>(
  channel: C,
  readsRevenue: boolean,
): C {
  if (readsRevenue || !channel || typeof channel !== 'object') return channel;
  const out: Record<string, unknown> = { ...channel };
  for (const field of MONEY_CHANNEL_FIELDS) out[field] = null;
  out.withheldForRevenue = [...MONEY_CHANNEL_FIELDS];
  return out as C;
}

const MONEY_SNAPSHOT_FIELDS = [
  'blendedCac',
  'leadVolumeEstimate',
  'funnelConversionEstimate',
  'channelDiversificationScore',
  'overallRisk',
] as const;

const NON_MONEY_MARKETING_TYPES: ReadonlySet<string> = new Set([
  'NO_CONTENT_STRATEGY',
  'CREATE_CONTENT_STRATEGY',
  'MISSING_CONTENT_PILLARS',
  'ADD_CONTENT_PILLARS',
  'MISSING_CONTENT_CADENCE',
  'SET_CONTENT_CADENCE',
  'ADD_CHANNELS',
]);

/** Marketing-growth snapshot projected for reader: withholds CAC, lead volume, funnel conversion, shares, diversification, risk and CAC/concentration warnings. */
export function marketingSnapshotForReader<S extends Record<string, unknown> | null | undefined>(
  snapshot: S,
  readsRevenue: boolean,
): S {
  if (readsRevenue || !snapshot || typeof snapshot !== 'object') return snapshot;
  const out: Record<string, unknown> = { ...snapshot };
  for (const field of MONEY_SNAPSHOT_FIELDS) out[field] = null;
  const served = (rows: unknown) =>
    (Array.isArray(rows) ? rows : []).filter(
      (r) => r && typeof r === 'object' && NON_MONEY_MARKETING_TYPES.has(String((r as { type?: unknown }).type)),
    );
  out.warnings = served(snapshot.warnings);
  out.recommendations = served(snapshot.recommendations);
  out.channelMix = (Array.isArray(snapshot.channelMix) ? snapshot.channelMix : []).map((item) =>
    item && typeof item === 'object' ? { ...(item as Record<string, unknown>), sharePercent: null } : item,
  );
  out.missingInputs = (Array.isArray(snapshot.missingInputs) ? snapshot.missingInputs : []).filter(
    (i) => typeof i === 'string' && !isMoneyLabel(i),
  );
  out.withheldForRevenue = [...MONEY_SNAPSHOT_FIELDS, 'channelMix.sharePercent'];
  return out as S;
}
