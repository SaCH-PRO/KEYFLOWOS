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

function nonMoneySection(section: unknown): boolean {
  return typeof section === 'string' && NON_MONEY_EVOLUTION_SECTIONS.has(section.trim().toLowerCase());
}

/** D-233, D-238: a genome evolution proposal is finance by its section or by money in its reason, patch or evidence. */
export function isFinancialGenomeEvolution(row: GenomeEvolutionFields | null | undefined): boolean {
  if (!row) return true;
  if (!nonMoneySection(row.section)) return true;
  if (textStatesMoney(row.reason)) return true;
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
  if ([e.title, e.summary, e.description].some(textStatesMoney)) return true;
  const payload = e.payload && typeof e.payload === 'object' && !Array.isArray(e.payload) ? (e.payload as Record<string, unknown>) : null;
  if (payload && 'section' in payload && !nonMoneySection(payload.section)) return true;
  return structuredValueStatesMoney(e.payload) || structuredValueStatesMoney(e.signals);
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
  // Round 3: the preview copies the diagnosis, insight and recommendation text, so money in any of them gates it too.
  const statesMoney = [recommendation.title, recommendation.diagnosis, recommendation.insight, recommendation.recommendation, recommendation.expectedGain]
    .some(textStatesMoney);
  if (!statesMoney && !isFinanceRecommendation(recommendation)) return;
  const level = await genomeReaderRevenueLevel(prisma, businessId, reader);
  if (rankOf(level) < LEVEL_RANK[minLevel]) {
    throw new ForbiddenException(`Insufficient permissions: revenue requires ${minLevel} access (you have ${level})`);
  }
}
