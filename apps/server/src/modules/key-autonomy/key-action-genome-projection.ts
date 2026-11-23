import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../../core/prisma/prisma.service';
import { LEVEL_RANK, rankOf } from '../../core/authority/module-vocabulary';
import {
  genomeReaderRevenueLevel,
  isFinanceRecommendation,
  isMoneyLabel,
  proposalTextStatesMoney,
  structuredValueStatesMoney,
  type GenomeReader,
} from '../business-genome/key-genome/genome-finance-scope';

/**
 * FU-KEY-ACTION-GENOME-PROJECTION (owner rulings D-128, D-233, D-238): the KEY action and genome-evolution
 * surfaces a reader without revenue read reaches without going through the KEY genome controller.
 *
 * 1. GenomeEvolutionService writes a timeline row for each decision on a genome evolution proposal
 *    (entityType genome_evolution_proposal; summary `${section} proposal <status>: ${reason}`; payload with the
 *    section and the proposed patch). A proposal of the financial or sales DNA section is finance (D-233: the
 *    finance and sales DNA dimensions are withheld from such a reader, dnaScoresForReader), and so is one whose
 *    reason, patch or evidence states money. The timeline serves such a reader a decision row only when its
 *    proposal is read in the same business, is of a listed non-money section, and nothing in the row or the
 *    proposal states money; anything else (an unknown section, a proposal that cannot be read, a failed read)
 *    is withheld (fail closed, D-227, D-234).
 * 2. GenomeRecommendationActionBridgeService previews and bridges a genome recommendation into a KEY action
 *    proposal, copying its title, diagnosis, insight and recommendation text. For a FINANCIAL recommendation
 *    (isFinanceRecommendation), or one whose own text states money, the preview needs revenue read and the bridge
 *    revenue write, as the KEY genome controller's own recommendation routes do (SEC-GFS-4; D-128's acting clause).
 */

export const GENOME_EVOLUTION_ENTITY = 'genome_evolution_proposal';

/**
 * The DNA sections whose evolution proposals a reader without revenue read may be shown (D-233): every DNA
 * section except financial and sales. A section not listed here fails closed.
 */
const NON_MONEY_EVOLUTION_SECTIONS: ReadonlySet<string> = new Set([
  'founder', 'vision', 'business', 'market', 'legal', 'operations', 'marketing', 'growth', 'technology', 'risk',
]);

export type GenomeEvolutionFields = {
  section?: unknown;
  reason?: unknown;
  proposedPatch?: unknown;
  evidence?: unknown;
};

function textStatesMoney(value: unknown): boolean {
  return typeof value === 'string' && (isMoneyLabel(value) || proposalTextStatesMoney(value));
}

/**
 * Round 4 (security A1): a figure anywhere in a proposed DNA patch: a number, or a string with a digit in it. The
 * blueprint's money fields (monthlyTarget, avgTicket, ...) and targets ("Hit 120k this quarter") carry bare figures the
 * money vocabulary does not read; the genome-evolution generator's own patches are lists of words. Patches only: the
 * generator's evidence counts events ("5 booking events detected.").
 */
export function patchHoldsFigure(value: unknown, depth = 0): boolean {
  if (depth > 8) return true;
  if (typeof value === 'number' || typeof value === 'bigint') return true;
  // Round 6: any decimal digit, ASCII or not (fullwidth figures read as figures).
  if (typeof value === 'string') return /\p{Nd}/u.test(value);
  if (Array.isArray(value)) return value.some((v) => patchHoldsFigure(v, depth + 1));
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).some((v) => patchHoldsFigure(v, depth + 1));
  return false;
}

function nonMoneySection(section: unknown): boolean {
  return typeof section === 'string' && NON_MONEY_EVOLUTION_SECTIONS.has(section.trim().toLowerCase());
}

/** D-233, D-238: a genome evolution proposal is finance by its section or by money in its reason, patch or evidence. */
export function isFinancialGenomeEvolution(row: GenomeEvolutionFields | null | undefined): boolean {
  if (!row) return true;
  if (!nonMoneySection(row.section)) return true;
  // Round 5 (security MAJOR-1): a bare figure in the reason ("Hit 120k this quarter") fails closed as in the patch;
  // the generator's reasons are words.
  if (textStatesMoney(row.reason) || patchHoldsFigure(row.reason)) return true;
  if (patchHoldsFigure(row.proposedPatch)) return true;
  return structuredValueStatesMoney(row.proposedPatch) || structuredValueStatesMoney(row.evidence);
}

/** A timeline row about a genome evolution proposal (GenomeEvolutionService.emitDecisionEvent). */
export function isGenomeEvolutionEvent(e: { entityType?: string | null; type?: string | null }): boolean {
  return e.entityType === GENOME_EVOLUTION_ENTITY || (typeof e.type === 'string' && e.type.startsWith('genome_evolution.'));
}

type EvolutionEvent = {
  entityType?: string | null;
  entityId?: string | null;
  type?: string | null;
  title?: string | null;
  summary?: string | null;
  description?: string | null;
  payload?: unknown;
  signals?: unknown;
};

/** The row's own text and data: its title, summary, description, payload (section, patch) and signals. */
function eventStatesMoney(e: EvolutionEvent): boolean {
  // The row's summary carries the reason (`${section} proposal <status>: ${reason}`): a bare figure there fails closed too.
  if ([e.title, e.summary, e.description].some((t) => textStatesMoney(t) || patchHoldsFigure(t))) return true;
  const payload = e.payload && typeof e.payload === 'object' && !Array.isArray(e.payload) ? (e.payload as Record<string, unknown>) : null;
  if (payload && 'section' in payload && !nonMoneySection(payload.section)) return true;
  if (payload && patchHoldsFigure(payload.proposedPatch)) return true;
  return structuredValueStatesMoney(e.payload) || structuredValueStatesMoney(e.signals);
}

/**
 * Round 6 (security review P-1): approving an evolution proposal writes the DNA section through
 * BlueprintService.updateDnaSection, which records a genome.section_updated row (entityType dna_section, entityId the
 * section, payload { section, data: the patch }); a direct DNA edit writes the same row. It is the same content as the
 * decision row and is projected the same way.
 */
export function isDnaSectionEvent(e: { entityType?: string | null; type?: string | null }): boolean {
  return e.entityType === 'dna_section' || e.type === 'genome.section_updated';
}

/**
 * What a reader without revenue read is served of a DNA section row (round 7):
 * - 'withhold': a money or unknown section (financial, sales, anything not listed), a section the row names two ways
 *   that disagree, a payload that is not a plain object or whose section is not a string, or a row whose own title,
 *   summary or description states money;
 * - 'redact': a listed non-money section whose data holds a figure or money (D-238 "safely redacted"): served with its
 *   data left out, so the edit is visible but not its values;
 * - 'serve': a listed non-money section with neutral data.
 */
export function dnaSectionViewForReader(e: EvolutionEvent): 'serve' | 'redact' | 'withhold' {
  if (!e.payload || typeof e.payload !== 'object' || Array.isArray(e.payload)) return 'withhold';
  const payload = e.payload as Record<string, unknown>;
  if (typeof payload.section !== 'string') return 'withhold';
  if (!nonMoneySection(payload.section)) return 'withhold';
  if (e.entityId != null && (typeof e.entityId !== 'string' || e.entityId.trim().toLowerCase() !== payload.section.trim().toLowerCase())) return 'withhold';
  if ([e.title, e.summary, e.description].some((t) => textStatesMoney(t) || patchHoldsFigure(t))) return 'withhold';
  if (structuredValueStatesMoney(e.signals)) return 'withhold';
  const rest = Object.fromEntries(Object.entries(payload).filter(([k]) => k !== 'data' && k !== 'section'));
  if (Object.keys(rest).length && (patchHoldsFigure(rest) || structuredValueStatesMoney(rest))) return 'withhold';
  return patchHoldsFigure(payload.data) || structuredValueStatesMoney(payload.data) ? 'redact' : 'serve';
}

/** The redacted view of a DNA section row: its payload is reduced to its section, marked redacted. */
export function redactedDnaSectionEvent<E extends { payload?: unknown }>(e: E): E {
  const section = (e.payload as Record<string, unknown>).section;
  return { ...e, payload: { section, redacted: true } };
}

/**
 * For each genome-evolution timeline row, whether a reader without revenue read may be served it. The proposals
 * are read in `businessId` only, in one query; a row with no proposal id, whose proposal is not found there, or
 * read when the query fails, is not served (fail closed).
 */
export async function readableGenomeEvolutionEvents(
  prisma: Pick<PrismaService, 'client'>,
  businessId: string,
  events: EvolutionEvent[],
): Promise<boolean[]> {
  const ids = [...new Set(events.map((e) => e.entityId).filter((id): id is string => typeof id === 'string' && !!id))];
  let rows: Map<string, GenomeEvolutionFields>;
  try {
    const found = ids.length
      ? await prisma.client.genomeEvolutionProposal.findMany({
          where: { businessId, id: { in: ids } },
          select: { id: true, section: true, reason: true, proposedPatch: true, evidence: true },
        })
      : [];
    rows = new Map(found.map((r: { id: string } & GenomeEvolutionFields) => [r.id, r]));
  } catch {
    return events.map(() => false);
  }
  return events.map((e) => {
    const row = e.entityId ? rows.get(e.entityId) : undefined;
    return !!row && !isFinancialGenomeEvolution(row) && !eventStatesMoney(e);
  });
}

/**
 * D-128 (SEC-GFS-4 and the acting clause): before a genome recommendation is previewed (`read`) or bridged
 * (`write`) into a KEY action proposal, a FINANCIAL recommendation of `businessId` needs that revenue level,
 * with ModuleScopeGuard's message. A recommendation not found in `businessId` is left to the bridge service,
 * which answers 404 as before; a failed read throws (fail closed).
 */
export async function requireBridgeRevenue(
  prisma: PrismaService,
  businessId: string,
  recommendationId: string,
  reader: GenomeReader,
  minLevel: 'read' | 'write',
): Promise<void> {
  const recommendation = await prisma.client.genomeRecommendation.findFirst({
    where: { id: recommendationId, businessId },
    select: { domain: true, title: true, diagnosis: true, insight: true, recommendation: true, expectedGain: true },
  });
  if (!recommendation) return;
  // Round 3: the preview copies the diagnosis, insight and recommendation text, so a figure stated as money in any of
  // them gates it too. Round 4 (correctness MAJOR-1): only text with a figure in it; money words alone ("paid channel",
  // "target CAC") are how the marketing and operations genomes write ordinary recommendations, which the list serves.
  const statesMoney = [recommendation.title, recommendation.diagnosis, recommendation.insight, recommendation.recommendation, recommendation.expectedGain]
    .some((t) => typeof t === 'string' && /\p{Nd}/u.test(t) && textStatesMoney(t));
  if (!statesMoney && !isFinanceRecommendation(recommendation)) return;
  const level = await genomeReaderRevenueLevel(prisma, businessId, reader);
  if (rankOf(level) < LEVEL_RANK[minLevel]) {
    throw new ForbiddenException(`Insufficient permissions: revenue requires ${minLevel} access (you have ${level})`);
  }
}

/**
 * Round 9 (security MAJOR-1): a lifecycle row's payload with every autonomy rule-trace entry's `metadata` left out. The
 * orchestrator's metadata holds its counts and scores; the genome gate's scores average the affected domains' health,
 * revenue quality and finance among them (D-233), and a rule may record an amount. A reader without revenue read is
 * served the row this way, and the row is classified as served. Each entry's rule, source, result and reason stay; a
 * trace that is not a list is left as it is (and read whole). Returns the payload itself when there is nothing to drop.
 */
export function ruleTraceWithoutMetadata(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !('ruleTrace' in payload)) return payload;
  const { ruleTrace, ...rest } = payload as Record<string, unknown>;
  // Round 3 (security NOTE-7): a trace that is one object (not a list) loses its metadata too.
  if (ruleTrace && typeof ruleTrace === 'object' && !Array.isArray(ruleTrace)) {
    if (!('metadata' in ruleTrace)) return payload;
    const { metadata: _metadata, ...kept } = ruleTrace as Record<string, unknown>;
    return { ...rest, ruleTrace: kept };
  }
  if (!Array.isArray(ruleTrace)) return payload;
  if (!ruleTrace.some((entry) => entry && typeof entry === 'object' && !Array.isArray(entry) && 'metadata' in entry)) return payload;
  return {
    ...rest,
    ruleTrace: ruleTrace.map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
      const { metadata: _metadata, ...kept } = entry as Record<string, unknown>;
      return kept;
    }),
  };
}

/**
 * FU-GENOME-EVOLUTION-SURFACES (D-233): the genome's composite scores. Each weights the financial (20) and sales (10) DNA
 * sections, so a reader without revenue read could infer their movement from it (BlueprintService genome.updated rows,
 * ConstitutionVersionService constitution rows).
 */
const COMPOSITE_SCORE_KEYS: ReadonlySet<string> = new Set([
  'genomeIntegrity', 'executiveReadinessScore', 'genomeDnaScores', 'genomeDnaConfidence', 'readinessBreakdown', 'sourceDnaScores',
  // Round 3 (security MINOR-3): the genome stage is a grade of the composite and the DNA scores (D-233).
  'genomeStage',
]);

/** Whether a timeline row's payload carries a composite score at its top level. */
export function carriesCompositeScores(payload: unknown): boolean {
  return !!payload && typeof payload === 'object' && !Array.isArray(payload)
    && Object.keys(payload as Record<string, unknown>).some((k) => COMPOSITE_SCORE_KEYS.has(k));
}

/** A payload with its composite scores left out (the payload itself when it has none). */
export function withoutCompositeScores(payload: unknown): unknown {
  if (!carriesCompositeScores(payload)) return payload;
  return Object.fromEntries(Object.entries(payload as Record<string, unknown>).filter(([k]) => !COMPOSITE_SCORE_KEYS.has(k)));
}

/**
 * Round 3 (security MINOR-2): the cross-domain risk level is the maximum over every domain's risk, finance included
 * (GenomeCrossDomainService), so a verdict naming it can tell a revenue-none reader that finance is at risk (D-233).
 */
const CROSS_DOMAIN_RISK = /cross[\s_-]?domain/i;

/**
 * FU-GENOME-DNA-WRITES-AND-INTEGRITY (D-233, D-238): whether an autonomy verdict reason or a genome-policy message states
 * money or the cross-domain risk (as autonomyVerdictForReader judges a verdict's reason).
 */
export function autonomyReasonStatesMoney(reason: unknown): boolean {
  return typeof reason === 'string' && (textStatesMoney(reason) || CROSS_DOMAIN_RISK.test(reason));
}

/** 403 with ModuleScopeGuard's message when the reader's revenue level is below `minLevel` (SUPER_ADMIN passes). */
export async function requireRevenueLevel(
  prisma: PrismaService,
  businessId: string,
  reader: GenomeReader,
  minLevel: 'read' | 'write',
): Promise<void> {
  const level = await genomeReaderRevenueLevel(prisma, businessId, reader);
  if (rankOf(level) < LEVEL_RANK[minLevel]) {
    throw new ForbiddenException(`Insufficient permissions: revenue requires ${minLevel} access (you have ${level})`);
  }
}

/**
 * FU-GENOME-EVOLUTION-SURFACES (D-238): what a reader without revenue read is served of an autonomy verdict (KEY cortex
 * audit). A verdict on a money action, or whose reason or rule-trace text states money, is withheld (null); any other is
 * served with its rule-trace metadata left out (the genome gate's scores average finance in).
 */
export function autonomyVerdictForReader<V extends { actionKey?: unknown; reason?: unknown; ruleTrace?: unknown; confidence?: unknown }>(
  verdict: V,
  /**
   * Round 3 (security MAJOR-1): whether the action key names a money action by its module (a revenue or expenses tool:
   * the graph-action and KEY organ maps, the books tools); the caller supplies it (key-cortex-audit.controller) so this
   * module does not load the AI route maps. Without it, the key is judged by its text alone.
   */
  actionKeyIsMoney: (actionKey: string) => boolean = () => false,
): Omit<V, 'confidence'> | null {
  if (typeof verdict.actionKey !== 'string' || textStatesMoney(verdict.actionKey) || actionKeyIsMoney(verdict.actionKey)) return null;
  if (textStatesMoney(verdict.reason) || CROSS_DOMAIN_RISK.test(String(verdict.reason ?? ''))) return null;
  const trace = ruleTraceWithoutMetadata({ ruleTrace: verdict.ruleTrace }) as { ruleTrace?: unknown };
  if (structuredValueStatesMoney(trace.ruleTrace) || CROSS_DOMAIN_RISK.test(JSON.stringify(trace.ruleTrace ?? null))) return null;
  // Round 2 (security MAJOR-3a): the verdict's confidence is the genome gate's confidence score (min(1, score/100)).
  const { confidence: _confidence, ...rest } = verdict;
  return { ...rest, ruleTrace: trace.ruleTrace };
}

/**
 * FU-GENOME-EVOLUTION-SURFACES (D-128, D-238): for each experiment of `businessId`, whether it is financial. An experiment
 * is financial when its hypothesis, action or success metric states money, or when a FINANCIAL genome recommendation of
 * the same business was bridged to it (GenomeRecommendationActionBridgeService records the experiment as the
 * recommendation's suggestedExperimentId and copies its text into the hypothesis). One query, in `businessId` only; a
 * failed read makes every experiment financial (fail closed).
 */
export async function financialExperimentFlags(
  prisma: Pick<PrismaService, 'client'>,
  businessId: string,
  experiments: Array<{ id: string; hypothesis?: unknown; action?: unknown; successMetric?: unknown; result?: unknown }>,
): Promise<boolean[]> {
  // Round 2 (correctness MAJOR-3): an experiment's own text is financial by a money label, or by the money vocabulary
  // only beside a figure (the bridge preview's rule: "paid channel" is how the marketing genome writes an ordinary
  // recommendation, and the experiment bridged from it is served as the recommendation is). Its completion result is
  // read whole (correctness MINOR-6).
  const ownText = (t: unknown) => typeof t === 'string' && (isMoneyLabel(t) || (/\p{Nd}/u.test(t) && textStatesMoney(t)));
  const own = experiments.map((e) => [e.hypothesis, e.action, e.successMetric].some(ownText) || structuredValueStatesMoney(e.result));
  const ids = experiments.filter((_e, i) => !own[i]).map((e) => e.id);
  if (ids.length === 0) return own;
  let bridged: Set<string>;
  try {
    const recs = await prisma.client.genomeRecommendation.findMany({
      where: { businessId, suggestedExperimentId: { in: ids } },
      select: { suggestedExperimentId: true, domain: true, title: true, diagnosis: true },
    });
    bridged = new Set(
      recs.filter((r: { suggestedExperimentId: string | null } & GenomeRowLike) => isFinanceRecommendation(r)).map((r: { suggestedExperimentId: string | null }) => r.suggestedExperimentId as string),
    );
  } catch {
    return experiments.map(() => true);
  }
  return experiments.map((e, i) => own[i] || bridged.has(e.id));
}

type GenomeRowLike = { domain?: string | null; title?: string | null; diagnosis?: string | null };

