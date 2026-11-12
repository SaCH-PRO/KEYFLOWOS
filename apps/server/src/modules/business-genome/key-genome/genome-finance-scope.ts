import { LEVEL_RANK, defaultScopesForRole, rankOf } from '../../../core/authority/module-vocabulary';
import type { PrismaService } from '../../../core/prisma/prisma.service';
import type { GenomeRecommendationService } from './genome-recommendation.service';
import type { GenomeSignalService } from './genome-signal.service';
import type { ListGenomeRecommendationsQuery, ListGenomeSignalsQuery } from './key-genome.types';

/**
 * W11-GENOME-FINANCE-SCOPE review repairs (owner rulings D-128 and D-100;
 * SEC-GFS-1..4, GFS-R1, GFS-R2). The genome's shared tables hold finance rows
 * beside the other domains' rows: FinanceGenomeService writes signals with
 * sourceModule 'finance' (section FINANCIAL, domain 'finance') whose reason is
 * the warning text ("Runway is 0.8 months"), recommendations in domain
 * FINANCIAL, and FINANCE_GENOME memory events carrying the health score and
 * overall risk; outcome learning copies those rows' domain and text into its
 * own memory events. The cross-domain service's events carry the composite's
 * overall health score, which averages the finance health score, and the
 * customer-sales snapshot's event carries the revenue quality worked out from
 * the lifetime value and acquisition cost metrics. D-128: reading them needs
 * revenue read; acting on a finance signal or recommendation needs revenue
 * write. The match is on "financ" in any of the row's module fields, so a row
 * a temporal or KEY writer files under section FINANCIAL is caught too.
 *
 * W11A-SEAM-REPAIR (seam of B1 W11-KEY-ORGAN-AUTHORITY-MAP x B2; D-128, D-131): moved
 * here from KeyGenomeController unchanged, so that the KEY organ tools
 * key_genome.list_signals and key_genome.list_recommendations (KeyGenomeAdapterService),
 * which D-131's map opens to members holding settings read, apply the same
 * projection the REST routes apply (one rule, two doors).
 */
const FINANCE_FIELD = /financ/i;

export type GenomeRowFields = {
  sourceModule?: string | null;
  sourceType?: string | null;
  section?: string | null;
  domain?: string | null;
  eventType?: string | null;
};

function mentionsFinance(...values: Array<string | null | undefined>): boolean {
  return values.some((v) => typeof v === 'string' && FINANCE_FIELD.test(v));
}

/** A genome signal the finance genome (or any writer filing under finance) wrote: D-128. */
export function isFinanceSignal(row: GenomeRowFields): boolean {
  return mentionsFinance(row.sourceModule, row.section, row.domain);
}

/** A genome recommendation in the finance domain (FINANCIAL): D-128. */
export function isFinanceRecommendation(row: GenomeRowFields): boolean {
  return mentionsFinance(row.domain);
}

/** A memory event that carries a finance or composite money signal: D-128, D-100. */
export function isMoneyMemoryEvent(row: GenomeRowFields): boolean {
  return (
    mentionsFinance(row.sourceType, row.domain, row.section) ||
    row.sourceType === 'CROSS_DOMAIN_GENOME' ||
    row.domain === 'CROSS_DOMAIN' ||
    row.eventType === 'CUSTOMER_SALES_SNAPSHOT_COMPUTED'
  );
}

export function firstN<T>(rows: T[], limit: number | undefined): T[] {
  return limit === undefined ? rows : rows.slice(0, limit);
}

/** Who reads the genome: the authenticated user ({ id, role } as AuthMiddleware attaches it), or none. */
export type GenomeReader = { id?: string; role?: string } | undefined;

/**
 * D-128 / D-100: the reader's revenue level in `businessId`, read by ModuleScopeGuard's rule:
 * SUPER_ADMIN passes; else the membership's explicit scope map (a missing key being 'none') or its
 * role's defaults. No reader, or no membership, is 'none': the finance rows fail closed.
 */
export async function genomeReaderRevenueLevel(prisma: PrismaService, businessId: string, reader: GenomeReader): Promise<string> {
  if (reader?.role === 'SUPER_ADMIN') return 'admin';
  if (!reader?.id) return 'none';
  const membership = await prisma.client.membership.findUnique({
    where: { userId_businessId: { userId: reader.id, businessId } },
    select: { role: true, permissionScopes: true },
  });
  if (!membership) return 'none';
  const scopes: Record<string, string> =
    membership.permissionScopes && typeof membership.permissionScopes === 'object'
      ? (membership.permissionScopes as Record<string, string>)
      : defaultScopesForRole(membership.role);
  return scopes.revenue || 'none';
}

/** Whether `reader` reads revenue in `businessId` (D-100), by genomeReaderRevenueLevel. */
export async function genomeReaderReadsRevenue(prisma: PrismaService, businessId: string, reader: GenomeReader): Promise<boolean> {
  return rankOf(await genomeReaderRevenueLevel(prisma, businessId, reader)) >= LEVEL_RANK.read;
}

/**
 * SEC-GFS-4 (D-128 read clause): the genome signals a reader is served. A reader with revenue read
 * gets the list as asked; any other reader gets no finance signal, and the limit counts the signals
 * that reader is served.
 */
export async function listSignalsForReader(
  signals: Pick<GenomeSignalService, 'listSignals'>,
  businessId: string,
  filters: ListGenomeSignalsQuery,
  readsRevenue: boolean,
) {
  if (readsRevenue) return signals.listSignals(businessId, filters);
  const rows = await signals.listSignals(businessId, { ...filters, limit: undefined });
  return firstN(rows.filter((s) => !isFinanceSignal(s)), filters.limit);
}

/**
 * SEC-GFS-4 (D-128 read clause): the genome recommendations a reader is served. A reader with
 * revenue read gets the list as asked; any other reader gets no finance (FINANCIAL) recommendation,
 * and the limit counts the rows that reader is served.
 */
export async function listRecommendationsForReader(
  recommendations: Pick<GenomeRecommendationService, 'listRecommendations'>,
  businessId: string,
  filters: ListGenomeRecommendationsQuery,
  readsRevenue: boolean,
) {
  if (readsRevenue) return recommendations.listRecommendations(businessId, filters);
  const rows = await recommendations.listRecommendations(businessId, { ...filters, limit: undefined });
  return firstN(rows.filter((r) => !isFinanceRecommendation(r)), filters.limit);
}
