import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../core/prisma/prisma.service';
import { LEVEL_RANK, memberModuleLevel, rankOf } from '../../core/authority/module-vocabulary';
import { isFinancialProposal, isMoneyLabel, proposalTextStatesMoney } from '../business-genome/key-genome/genome-finance-scope';

/**
 * FU-AI-APPROVALS-MONEY-SIGHT (P0; D-100, D-234, D-238): which sights an AiApprovalItem needs, and whether a member
 * may read or act on it. Its writers (createApprovalItem: Flow chat, plan steps, drive and message intake, ingestion,
 * delegation loops; the stale-quote listener writes rows directly) put money amounts and expenses into its title,
 * description, rationale, inputPayload and affectedEntities, and every read of the item was gated by operations read
 * only. An item is classified wherever it is read, from what is stored (so a row written by any writer, before or after
 * this packet, is judged on its content):
 * - money (D-238: isFinancialProposal over the item read as the proposal it becomes, migrateAiApprovalItemToProposal;
 *   or any field that states money by the text rule) needs revenue read;
 * - an expense (any field that states one, D-146) needs expenses read;
 * - an item D-238 holds financial on which neither text rule finds anything (an unmapped tool or module: fail closed)
 *   needs both.
 * Acting on an item (approve, reject, defer) needs write on every sight it needs.
 */
export type ApprovalSight = 'revenue' | 'expenses';

/** The AiApprovalItem columns an item is classified by (every content field it carries). */
export const APPROVAL_ITEM_CLASSIFY_SELECT = {
  toolName: true,
  module: true,
  title: true,
  description: true,
  rationale: true,
  expectedBenefit: true,
  risks: true,
  inputPayload: true,
  affectedEntities: true,
  resolution: true,
} as const;

export interface ApprovalItemContent {
  toolName?: string | null;
  module?: string | null;
  title?: string | null;
  description?: string | null;
  rationale?: string | null;
  expectedBenefit?: string | null;
  risks?: string | null;
  inputPayload?: unknown;
  affectedEntities?: unknown;
  resolution?: string | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// The text rule. Copied (minimal, pure) from FU-INSIGHTS-SIGHT's insight-sight.ts and semantic-memory-sight.ts on
// pkt/V1-FU-INSIGHTS-SIGHT (textIsMoney, textIsExpense, blankControls, readingsOf, fieldsSightNeeds), which are not on
// main yet; the orchestrator dedupes them at wave time.
// ---------------------------------------------------------------------------------------------------------------------

/** Whether free text states money (a money word or a figure). */
function textIsMoney(value: unknown): boolean {
  return typeof value === 'string' && value !== '' && (isMoneyLabel(value) || proposalTextStatesMoney(value));
}

/** D-146: the words of the expenses module and what a business pays out. */
const EXPENSE_WORDS =
  /(?<![a-z])(expenses?|expenditures?|bills?|receipts?|budgets?|vendors?|suppliers?|rent|payroll|salar(?:y|ies)|wages?|utilit(?:y|ies)|overheads?|outgoings?|spend(?:s|ing)?|spent|costs?|payables?|purchases?|purchased|procure(?:ment|d)?|reimburs\w*|leases?|landlords?|insurance|premiums?|electricity|fuel|cogs)(?![a-z])/i;
function textIsExpense(value: unknown): boolean {
  if (typeof value !== 'string' || value === '') return false;
  return EXPENSE_WORDS.test(value) || EXPENSE_WORDS.test(value.replace(/([a-z0-9])([A-Z])/g, '$1 $2'));
}

function blankControls(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/\p{Cc}/gu, ' ');
  if (Array.isArray(value)) return value.map(blankControls);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [blankControls(k) as string, blankControls(v)]));
  }
  return value;
}

function foldText(text: string): string {
  return text.normalize('NFKC').normalize('NFD').replace(/[\p{Cf}\p{Mn}\p{Me}]/gu, '').normalize('NFC');
}

function readingsOf(text: string): string[] {
  const folded = /[^\x20-\x7E]/.test(text) ? foldText(text) : text;
  const base = folded === text ? [text] : [text, folded];
  if (!/[\\\p{Cc}]/u.test(text) && !/[\\\p{Cc}]/u.test(folded)) return base;
  const out = new Set<string>(base);
  for (const candidate of base) {
    const escapesAsSpaces = candidate.replace(/\\+(?:u[0-9a-fA-F]{4}|[bfnrt"/])?/g, ' ');
    const decoded = candidate.replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    const strippedSlashes = decoded.replace(/\\/g, '');
    for (const variant of [candidate, escapesAsSpaces, decoded, strippedSlashes]) {
      out.add(variant);
      out.add(variant.replace(/\p{Cc}/gu, ' '));
      const vf = foldText(variant);
      out.add(vf);
      out.add(vf.replace(/\p{Cc}/gu, ' '));
    }
  }
  return [...out];
}

/** The most characters of one item's fields the text rule reads; past it the item needs both sights, unread. */
export const MAX_ITEM_CLASSIFIED = 50_000;

/** The sights a list of fields needs by every reading of each field and of the list read whole as JSON. */
function fieldsSightNeeds(fields: readonly unknown[]): ApprovalSight[] {
  let whole: string;
  try {
    whole = JSON.stringify(fields) ?? '';
  } catch {
    return ['revenue', 'expenses'];
  }
  if (whole.length > MAX_ITEM_CLASSIFIED) return ['revenue', 'expenses'];
  const texts: string[] = [whole];
  for (const field of fields) {
    if (field === null || field === undefined) continue;
    if (typeof field === 'string') texts.push(field);
    else texts.push(JSON.stringify(field) ?? '', JSON.stringify(blankControls(field)) ?? '');
  }
  const needs = new Set<ApprovalSight>();
  const seen = new Set<string>();
  for (const text of texts) {
    for (const reading of readingsOf(text)) {
      if (seen.has(reading)) continue;
      seen.add(reading);
      if (!needs.has('revenue') && textIsMoney(reading)) needs.add('revenue');
      if (!needs.has('expenses') && textIsExpense(reading)) needs.add('expenses');
      if (needs.size === 2) return ['revenue', 'expenses'];
    }
  }
  return (['revenue', 'expenses'] as const).filter((sight) => needs.has(sight));
}

// ---------------------------------------------------------------------------------------------------------------------

/** Every content field of an item, as the text rule reads them. */
export function approvalItemFields(item: ApprovalItemContent): unknown[] {
  return [
    item.title, item.description, item.rationale, item.expectedBenefit, item.risks, item.inputPayload, item.affectedEntities,
    item.toolName, item.module, item.resolution,
  ];
}

/** The characters one item costs to classify (its fields as JSON). Unserialisable content costs everything. */
export function approvalItemSize(item: ApprovalItemContent): number {
  try {
    return (JSON.stringify(approvalItemFields(item)) ?? '').length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

/**
 * The module an item with none stored is filed under, by its tool's prefix, as createApprovalItem files it
 * (AiOversightService.inferModule) for the prefixes whose module D-238 holds non-money; any other tool keeps none (and
 * is classified by D-238's own rules: an unmapped tool fails closed).
 */
function moduleOfTool(toolName: string | null | undefined): string | null {
  if (typeof toolName !== 'string') return null;
  if (toolName.startsWith('crm_')) return 'crm';
  if (toolName.startsWith('bookings_')) return 'bookings';
  if (toolName.startsWith('social_')) return 'content';
  return null;
}

/** The sights an item needs (see the file comment). */
export function approvalItemNeeds(item: ApprovalItemContent | null | undefined): ApprovalSight[] {
  if (!item) return ['revenue', 'expenses'];
  const byText = fieldsSightNeeds(approvalItemFields(item));
  if (byText.length === 2) return byText;
  // The item as the approval proposal it becomes (migrateAiApprovalItemToProposal), every field of it (D-238).
  // Pass summary/payload as null so description and inputPayload are not double-counted against MAX_PROPOSAL_CLASSIFIED (CR-6).
  const financial = isFinancialProposal({
    actionType: 'EXECUTE_TOOL',
    toolName: item.toolName ?? null,
    module: item.module ?? moduleOfTool(item.toolName),
    title: item.title ?? null,
    summary: null,
    description: item.description ?? null,
    rationale: item.rationale ?? null,
    expectedBenefit: item.expectedBenefit ?? null,
    risks: item.risks ?? null,
    inputPayload: item.inputPayload ?? null,
    payload: null,
    affectedEntities: item.affectedEntities ?? null,
    rejectionReason: item.resolution ?? null,
  } as Parameters<typeof isFinancialProposal>[0]);
  if (!financial) return byText;
  // Financial by D-238 with nothing the text rule names: unclassified money, both sights (fail closed).
  if (byText.length === 0) return ['revenue', 'expenses'];
  return byText.includes('revenue') ? byText : ['revenue', ...byText];
}

/**
 * Who reads or acts on an item: their level (LEVEL_RANK) in revenue and expenses. A member's is their membership's
 * (memberModuleLevel, the rule ModuleScopeGuard enforces: an OWNER on role defaults holds admin, an explicit map binds
 * whoever has one, D-140); a staff position's is the weakest of every membership that acts through it. Nobody else
 * (no member, a SUPER_ADMIN who is no member, a membership read that failed) holds anything.
 */
export interface ApprovalActor {
  rank(sight: ApprovalSight): number;
}

export const NO_APPROVAL_ACTOR: ApprovalActor = { rank: () => 0 };

/** The actor the given memberships act as together: the weakest level of each sight across them; none for none. */
export function approvalActorOfMemberships(memberships: ReadonlyArray<{ role: string; permissionScopes: unknown }>): ApprovalActor {
  if (memberships.length === 0) return NO_APPROVAL_ACTOR;
  const ranks: Record<ApprovalSight, number> = { revenue: LEVEL_RANK.admin, expenses: LEVEL_RANK.admin };
  for (const m of memberships) {
    for (const sight of ['revenue', 'expenses'] as const) ranks[sight] = Math.min(ranks[sight], rankOf(memberModuleLevel(m, sight)));
  }
  return { rank: (sight) => ranks[sight] };
}

/** A user's actor in a business: their membership's levels; none when they are no member or the read fails. */
export async function approvalActorOf(
  prisma: Pick<PrismaService, 'client'> | undefined,
  businessId: string,
  userId: string | null | undefined,
): Promise<ApprovalActor> {
  if (!prisma || typeof userId !== 'string' || !userId) return NO_APPROVAL_ACTOR;
  try {
    const membership = await prisma.client.membership.findUnique({
      where: { userId_businessId: { userId, businessId } },
      select: { role: true, permissionScopes: true },
    });
    return membership ? approvalActorOfMemberships([membership]) : NO_APPROVAL_ACTOR;
  } catch {
    return NO_APPROVAL_ACTOR;
  }
}

/** Whether `actor` holds read on every sight in `needs`. */
export function actorMaySee(actor: ApprovalActor, needs: readonly ApprovalSight[]): boolean {
  return needs.every((sight) => actor.rank(sight) >= LEVEL_RANK.read);
}

/** Whether `actor` holds write on every sight in `needs`. */
export function actorMayAct(actor: ApprovalActor, needs: readonly ApprovalSight[]): boolean {
  return needs.every((sight) => actor.rank(sight) >= LEVEL_RANK.write);
}

/** Whether `actor` holds read and write on both sights (every item is theirs to read; the fast path). */
export function actorReadsEverything(actor: ApprovalActor): boolean {
  return actorMaySee(actor, ['revenue', 'expenses']);
}

/**
 * The check every resolve runs before anything else is said about the item: an item the actor may not read is
 * answered exactly as an item that is not in the business (`notFound`, the caller's own not-found answer); one they
 * may read but not act on is a 403 naming the sights it needs.
 */
export function assertMayActOnApprovalItem(actor: ApprovalActor, item: ApprovalItemContent, notFound: () => Error): void {
  const needs = approvalItemNeeds(item);
  if (!actorMaySee(actor, needs)) throw notFound();
  if (!actorMayAct(actor, needs)) {
    throw new ForbiddenException(`Acting on this approval needs write access to ${needs.join(' and ')}`);
  }
}

/** The read check alone (for the resolve paths that check the act later): the caller's not-found when hidden. */
export function assertMaySeeApprovalItem(actor: ApprovalActor, item: ApprovalItemContent, notFound: () => Error): void {
  if (!actorMaySee(actor, approvalItemNeeds(item))) throw notFound();
}

/** The write check alone, after assertMaySeeApprovalItem. */
export function assertMayWriteApprovalItem(actor: ApprovalActor, item: ApprovalItemContent): void {
  const needs = approvalItemNeeds(item);
  if (!actorMayAct(actor, needs)) {
    throw new ForbiddenException(`Acting on this approval needs write access to ${needs.join(' and ')}`);
  }
}

/** The not-found answer AiApprovalsService.getItem gives, for a hidden item too. */
export const approvalItemNotFound = () => new NotFoundException('Approval item not found');

/**
 * The most characters of item text one request classifies; past it the remaining items are withheld unclassified
 * (fail closed), as FU-INSIGHTS-SIGHT bounds the control tower (keepWithinBudget).
 */
export const APPROVALS_CLASSIFY_BUDGET = 2_000_000;

/**
 * What classifying one item costs against the budget: its size, or nothing for an item over MAX_ITEM_CLASSIFIED (it
 * needs both sights without being read, so no single row can spend the budget for the rows after it).
 */
export function approvalItemCost(item: ApprovalItemContent): number {
  const size = approvalItemSize(item);
  return size > MAX_ITEM_CLASSIFIED ? 0 : size;
}

/** The items of `items` the actor may read, classified in order within the budget (the rest withheld). */
export function approvalItemsVisibleTo<T extends ApprovalItemContent>(actor: ApprovalActor, items: readonly T[], budget = APPROVALS_CLASSIFY_BUDGET): T[] {
  if (actorReadsEverything(actor)) return [...items];
  const kept: T[] = [];
  let spent = 0;
  for (const item of items) {
    spent += approvalItemCost(item);
    if (spent > budget) break;
    if (actorMaySee(actor, approvalItemNeeds(item))) kept.push(item);
  }
  return kept;
}
