/**
 * FU-GENOME-SURFACES-REVENUE (owner rulings D-233, D-234; D-128, D-100). The genome's composites as a reader may see
 * them. A DNA score of the finance or sales dimension is finance even with no currency in it (D-233), and so is every
 * composite that weights it:
 *   - the genome integrity averages the financial DNA in (DNA_SECTION_WEIGHTS: financial 15, sales 5), or, once facts
 *     exist, is the fact kernel's overall, which scores the FINANCIAL and SALES sections;
 *   - the executive readiness weights the financial DNA at 20 and the sales DNA at 10 (EXECUTIVE_READINESS_WEIGHTS);
 *   - the genome stage is read from the integrity and from the financial (>= 40) and sales (>= 50) thresholds;
 *   - the KEY genome score's overall, integrity, readiness and confidence average its FINANCIAL, SALES and OFFER_PRODUCT
 *     sections in.
 *
 * Withheld, not recomputed. A recomputation over the non-money sections would be a second integrity with the same name
 * and a different value (the fact kernel's overall has no non-money variant), and the stage cannot be recomputed without
 * the money thresholds it reads. So a reader without revenue read is served `null` for each composite, and the names of
 * what was withheld in `withheldForRevenue`, so a surface can render the withheld state (no score, no grade, no ring
 * segment). The DNA sections, scores, confidence and readiness breakdown are served for the non-money dimensions only
 * (dnaScoresForReader's list, which fails closed: a key not on it is withheld), and a ranking (the weakest section) is
 * taken among those. A revenue reader is served everything unchanged. The inputs are never changed: a result may be
 * shared between readers.
 */
import type { PrismaService } from '../../../core/prisma/prisma.service';
import type { DnaSectionKey, DnaSectionScore, GenomeIntegrityResult } from '../../blueprint/blueprint.types';
import { dnaScoresForReader, genomeReaderReadsRevenue, isFinanceSignal, isMoneyLabel, type GenomeReader } from './genome-finance-scope';
import { DNA_TO_KEY_GENOME_SECTION } from './key-genome.service';
import type { KeyGenomeScore, ModuleReadinessData } from './key-genome.types';
import type { ConstitutionStaleness, ConstitutionVersionData } from '../constitution-version.types';

/** The composites withheld from a reader without revenue read. */
export const GENOME_COMPOSITES = ['genomeIntegrity', 'executiveReadinessScore', 'genomeStage'] as const;

/** Whether `key` is a DNA dimension a reader without revenue read is served (dnaScoresForReader's list). */
export function isServedDnaKey(key: string): boolean {
  return Object.keys(dnaScoresForReader({ [key]: 0 }, false)).length === 1;
}

/** The KEY genome sections a reader without revenue read is served: those the served DNA keys map to. */
const SERVED_KEY_SECTIONS: ReadonlySet<string> = new Set(
  (Object.entries(DNA_TO_KEY_GENOME_SECTION) as [DnaSectionKey, string][])
    .filter(([key]) => isServedDnaKey(key))
    .map(([, section]) => section),
);

/** Whether a KEY genome section (FINANCIAL, SALES, OFFER_PRODUCT, ...) is served to a reader without revenue read. */
export function isServedKeySection(section: string | null | undefined): boolean {
  return typeof section === 'string' && SERVED_KEY_SECTIONS.has(section.trim().toUpperCase());
}

/**
 * The reader's revenue read, for a service whose callers may pass no reader. `undefined` is an internal caller (no
 * member is served the result), unchanged; `null` (no member) and a member are read by genomeReaderReadsRevenue; a
 * service built without Prisma, or a failed read, serves no money (fail closed).
 */
export async function readsRevenueFor(prisma: PrismaService | undefined | null, businessId: string, reader: GenomeReader | null | undefined): Promise<boolean> {
  if (reader === undefined) return true;
  if (!prisma || !reader) return false;
  return genomeReaderReadsRevenue(prisma, businessId, reader).catch(() => false);
}

export type ProjectedGenome<T> = Omit<T, (typeof GENOME_COMPOSITES)[number]> & {
  genomeIntegrity: number | null;
  executiveReadinessScore: number | null;
  genomeStage: string | null;
  withheldForRevenue?: string[];
};

/** The DNA sections a reader without revenue read is served. */
export function dnaSectionsForReader<S extends Pick<DnaSectionScore, 'key'>>(sections: S[] | null | undefined, readsRevenue: boolean): S[] {
  const list = sections ?? [];
  return readsRevenue ? list : list.filter((s) => isServedDnaKey(s.key));
}

/** The withheld field names: the composites and the money DNA keys. */
function withheldNames(): string[] {
  return [...GENOME_COMPOSITES, ...(Object.keys(DNA_TO_KEY_GENOME_SECTION) as string[]).filter((k) => !isServedDnaKey(k))];
}

/**
 * A genome integrity result (BlueprintService.calculateGenomeIntegrity) as a reader may see it. Fields the result does
 * not have are left out; the composites are null.
 */
export function genomeIntegrityForReader<T extends Partial<GenomeIntegrityResult>>(result: T, readsRevenue: boolean): T | ProjectedGenome<T> {
  if (readsRevenue) return result;
  const out: Record<string, unknown> = { ...result };
  for (const field of GENOME_COMPOSITES) out[field] = null;
  if ('genomeDnaScores' in result) out.genomeDnaScores = dnaScoresForReader(result.genomeDnaScores as Record<string, unknown>, false);
  if ('genomeDnaConfidence' in result) out.genomeDnaConfidence = dnaScoresForReader(result.genomeDnaConfidence as Record<string, unknown>, false);
  if ('readinessBreakdown' in result) out.readinessBreakdown = dnaScoresForReader(result.readinessBreakdown as Record<string, unknown>, false);
  if ('dnaSections' in result) out.dnaSections = dnaSectionsForReader(result.dnaSections, false);
  out.withheldForRevenue = withheldNames();
  return out as ProjectedGenome<T>;
}

/**
 * The blueprint columns the financial and sales DNA are counted from (DNA_SECTION_CONFIG: financial from financials and
 * projectionProfile, sales from salesSystem): from them the blueprint-derived score is recomputed field by field, so a
 * reader without revenue read is served them empty, and their confidence scores not at all.
 */
export const MONEY_BLUEPRINT_COLUMNS = ['financials', 'projectionProfile', 'salesSystem'] as const;

/** A blueprint (BlueprintService.getBlueprint) as a reader may see it: composites, money DNA and money columns withheld. */
export function blueprintForReader<T extends Record<string, unknown>>(blueprint: T, readsRevenue: boolean): T {
  if (readsRevenue) return blueprint;
  const out: Record<string, unknown> = genomeIntegrityForReader(blueprint as Partial<GenomeIntegrityResult>, false) as Record<string, unknown>;
  for (const column of MONEY_BLUEPRINT_COLUMNS) {
    if (column in blueprint) out[column] = {};
  }
  const confidence = blueprint.confidenceScores;
  if (confidence && typeof confidence === 'object' && !Array.isArray(confidence)) {
    const kept: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(confidence)) {
      if (!(MONEY_BLUEPRINT_COLUMNS as readonly string[]).includes(key)) kept[key] = value;
    }
    out.confidenceScores = kept;
  }
  return out as T;
}

/** A KEY genome score's sections a reader without revenue read is served. */
export function keyGenomeSectionsForReader<S extends { section: string }>(sections: S[] | null | undefined, readsRevenue: boolean): S[] {
  const list = sections ?? [];
  return readsRevenue ? list : list.filter((s) => isServedKeySection(s.section));
}

/** A KEY genome score as a reader may see it: overall, integrity, readiness and confidence withheld, money sections left out. */
export function keyGenomeScoreForReader(score: KeyGenomeScore, readsRevenue: boolean): KeyGenomeScore | (Omit<KeyGenomeScore, 'overall' | 'integrity' | 'readiness' | 'confidence'> & { overall: null; integrity: null; readiness: null; confidence: null; withheldForRevenue: string[] }) {
  if (readsRevenue) return score;
  return {
    ...score,
    overall: null,
    integrity: null,
    readiness: null,
    confidence: null,
    sections: keyGenomeSectionsForReader(score.sections, false),
    withheldForRevenue: ['overall', 'integrity', 'readiness', 'confidence', 'FINANCIAL', 'SALES', 'OFFER_PRODUCT'],
  };
}

/** A missing or required genome fact with money provenance (its section, domain or field), or nothing to classify it by. */
export function isMoneyFact(fact: { section?: string | null; domain?: string | null; field?: string | null; sourceModule?: string | null }): boolean {
  return isFinanceSignal({ sourceModule: fact.sourceModule, section: fact.section, domain: fact.domain, field: fact.field }) || !isServedKeySection(fact.section);
}

/**
 * Module readiness as a reader may see it: a money module's readiness (finance, commerce: its score is the readiness of
 * the money facts) is withheld, and so is every money fact another module names as missing, required or optional.
 */
export function moduleReadinessForReader<R extends Partial<ModuleReadinessData> & { module: string }>(rows: R[], readsRevenue: boolean): R[] {
  if (readsRevenue) return rows;
  return rows
    .filter((r) => !isMoneyLabel(r.module))
    .map((r) => {
      const out: Record<string, unknown> = { ...r };
      for (const key of ['missingFacts', 'requiredFacts', 'optionalFacts'] as const) {
        if (Array.isArray(r[key])) out[key] = (r[key] as Array<Parameters<typeof isMoneyFact>[0]>).filter((f) => !isMoneyFact(f));
      }
      return out as R;
    });
}

/** The constitution sections drawn from a money DNA dimension, or with no source named (fail closed). */
function isMoneyConstitutionSection(section: unknown): boolean {
  if (!section || typeof section !== 'object') return true;
  const source = (section as { sourceDna?: unknown }).sourceDna;
  if (!Array.isArray(source) || source.length === 0) return true;
  return source.some((key) => typeof key !== 'string' || !isServedDnaKey(key));
}

/**
 * A constitution's content (BlueprintService.generateConstitution, stored as a ConstitutionVersion's content) as a reader
 * may see it: the composites null, every section drawn from the financial or sales DNA left out (the financial and sales
 * strategies, the risk register), and the business model's pricing line (the last line it writes, from the financials
 * column) cut.
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
      kept[key] = key === 'businessModel' ? withoutPricingLine(section as Record<string, unknown>) : section;
    }
    out.sections = kept;
  }
  out.withheldForRevenue = withheldNames();
  return out as C;
}

function withoutPricingLine(section: Record<string, unknown>): Record<string, unknown> {
  if (typeof section.content !== 'string') return section;
  const content = section.content.replace(/\s*Pricing model:[\s\S]*$/, '').trim();
  return { ...section, content: content || 'Generated from Business DNA.' };
}

/**
 * FU-GENOME-SURFACES-REVENUE (D-233, D-234): a stored Constitution version as a reader may see it. Its source composites
 * (the genome integrity, executive readiness and stage it was generated from) and its summary (which states them) are
 * withheld from a member without revenue read, its source financial and sales DNA are left out, and its content is
 * projected as GET blueprint/.../genome/constitution is (constitutionContentForReader).
 */
export function constitutionVersionForReader<V extends ConstitutionVersionData | null>(row: V, readsRevenue: boolean): V {
  if (readsRevenue || !row) return row;
  return {
    ...row,
    summary: null,
    sourceGenomeIntegrity: null,
    sourceExecutiveReadiness: null,
    sourceGenomeStage: null,
    sourceDnaScores: row.sourceDnaScores ? dnaScoresForReader(row.sourceDnaScores, false) : row.sourceDnaScores,
    sourceDnaConfidence: row.sourceDnaConfidence ? dnaScoresForReader(row.sourceDnaConfidence, false) : row.sourceDnaConfidence,
    content: constitutionContentForReader(row.content ?? {}, false),
  } as V;
}

/** The staleness as a reader may see it: whether it is stale, never the composites it compares (D-233). */
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
