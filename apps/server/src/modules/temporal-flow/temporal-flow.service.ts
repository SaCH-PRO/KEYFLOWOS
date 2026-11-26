import { ForbiddenException, Injectable, Logger, Inject } from '@nestjs/common';
import { genomeReaderReadsRevenue, financialProposalsWithProvenance, isMoneyLabel, PROPOSAL_CLASSIFY_SELECT, proposalTextStatesMoney, structuredValueStatesMoney, type GenomeReader } from '../business-genome/key-genome/genome-finance-scope';
import { dnaSectionViewForReader, isDnaSectionEvent, isGenomeEvolutionEvent, readableGenomeEvolutionEvents, redactedDnaSectionEvent } from '../key-autonomy/key-action-genome-projection';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../core/prisma/prisma.service';
import { LEVEL_RANK, memberModuleLevel, rankOf } from '../../core/authority/module-vocabulary';
import { SemanticMemoryService } from '../ai/semantic-memory.service';
import { TemporalFlowMemoryService } from './temporal-flow-memory.service';
import type { SemanticReader } from '../ai/semantic-memory-sight';

/**
 * MEM-TEMPORAL-MEMORY-ROUTES-SIGHT: MEM-SEMANTIC-SIGHT's helpers, loaded on first use. They import KEY's prompt stack,
 * which reaches services that inject this one (BlueprintService): imported at load time, the cycle leaves an injected
 * constructor type undefined and the server does not start (app-module-boots).
 */
const sightHelpers = async () => {
  const [sight, promptContext] = await Promise.all([
    import('../ai/semantic-memory-sight'),
    import('../key-cortex/key-cortex-prompt-context.service'),
  ]);
  return { ...sight, readersModuleSight: promptContext.readersModuleSight };
};

/** MEM-SEMANTIC-SIGHT's source type of a temporal-memory copy (semantic-memory-sight.ts TEMPORAL_MEMORY_SOURCE_TYPE). */
const TEMPORAL_MEMORY_SOURCE_TYPE = 'temporal_memory';
import type {
  TemporalFlowAnalysis,
  TemporalFlowEventInput,
  TemporalFlowGenomeCandidate,
  TemporalFlowMemoryInsight,
} from './temporal-flow.types';

export interface TemporalFlowListQuery {
  source?: string;
  type?: string;
  module?: string;
  status?: string;
  importance?: string;
  genomeImpactPotential?: boolean;
  from?: string;
  to?: string;
  limit?: number;
}

/**
 * D-238 (round 3, security m1): whether a proposal event's own payload or metadata text (a rejection reason, a title, a
 * summary) states money, so a non-financial proposal's event that names a figure is not handed on.
 */
function eventTextStatesMoney(e: { payload?: unknown; metadata?: unknown }): boolean {
  const texts: unknown[] = [];
  for (const o of [e.payload, e.metadata]) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) continue;
    for (const key of ['reason', 'rejectionReason', 'failureReason', 'title', 'summary', 'description']) texts.push((o as Record<string, unknown>)[key]);
  }
  // The proposal vocabulary, as the proposal's own row is read (review of the Codex fixes, security MAJOR-1: 'card
  // declined', 'paid late' and 'balance owed' are not money labels).
  if (texts.some((t) => typeof t === 'string' && (isMoneyLabel(t) || proposalTextStatesMoney(t)))) return true;
  // The event's own copy of the execution result: the row may not hold it (confirmation review m5).
  for (const o of [e.payload, e.metadata]) {
    const result = o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>).executionResult : undefined;
    if (structuredValueStatesMoney(result)) return true;
  }
  return false;
}

/**
 * Round 9 (security MAJOR-1): a lifecycle row's payload with every autonomy rule-trace entry's `metadata` left out. The
 * orchestrator's metadata holds its counts and scores; the genome gate's scores average the affected domains' health,
 * revenue quality and finance among them (D-233), and a rule may record an amount. A reader without revenue read is
 * served the row this way, and the row is classified as served. Each entry's rule, source, result and reason stay; a
 * trace that is not a list is left as it is (and read whole). Returns the payload itself when there is nothing to drop.
 */
function ruleTraceWithoutMetadata(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !('ruleTrace' in payload)) return payload;
  const { ruleTrace, ...rest } = payload as Record<string, unknown>;
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

/** The most rows a reader may ask one timeline read for, and the most rows that read scans before it answers what it has. */
const MAX_READER_LIMIT = 500;
const MAX_READER_SCAN = 5_000;

/**
 * FU-TEMPORAL-FLOW-INBOX-SCOPE (NAV-A1 security review; D-100, D-179): who reads the timeline. The member a request
 * acts for (AuthMiddleware's `req.user`). A read given a reader's filter answers only the events of the modules they
 * may read. A call given none reads as before: TemporalFlowController's routes pass one; the other callers (the
 * command center snapshot, the executive brief and KEY modes, KEY's timeline tools, the genome evolution's signals)
 * do not yet, and are the review's follow-ups (FU-TEMPORAL-FLOW-INBOX-SCOPE review N-1), not readers this rule covers.
 */
export type TemporalFlowReader = { id?: string; role?: string } | null | undefined;

/**
 * MEM-TEMPORAL-MEMORY-ROUTES-SIGHT (D-257, D-234, D-100): what a temporal memory read may hand its reader. `filter` is
 * FU-TEMPORAL-FLOW-INBOX-SCOPE's readerMemoryFilter (in the query: a memory's source module and the events withheld from
 * the reader); `who` is MEM-SEMANTIC-SIGHT's reader (semanticHitsVisibleTo: the modules a summary's entity, source module,
 * source events and own text name, money and expenses by taint). A memory reaches the reader only when both admit it.
 */
export interface TemporalMemorySight {
  filter?: Record<string, unknown>;
  who: SemanticReader;
}

/** The rows a projected memory read pages through at most before it answers what it has. */
const MAX_MEMORY_SCAN = 5_000;
/**
 * Review round 1: the most rows one findMany answers (the database client's default-take guard, packages/db client.ts):
 * a page is never asked for more, or a short page would read as the end of the rows. A memory read answers at most this
 * many, as TemporalFlowMemoryService.findMany does under the same guard.
 */
const MEMORY_PAGE_CAP = 1_000;

/**
 * FU-TEMPORAL-FLOW-INBOX-SCOPE: the modules that own timeline events. Withholding is computed over these only, so a
 * reader who reads all four (the owner, an ADMIN or STAFF member on role defaults) sees every event, as before
 * (orchestrator delta M-1: a module none for every role, such as connect, withholds nothing).
 */
const EVENT_OWNERS = ['operations', 'bookings', 'revenue', 'storefront'] as const;
type EventOwner = (typeof EVENT_OWNERS)[number];

/**
 * FU-TEMPORAL-FLOW-INBOX-SCOPE: how an event names the module that owns it, by its `module`, its `source` and its
 * `type` (case-insensitive). An event names a module when any of the three does; a reader sees it only when they read
 * every module it names. Every writer of the timeline, and the module its own reads require:
 *   - TemporalFlowKeyInboxListener: module key_inbox, type key_inbox.*, source key_inbox or the thread's channel
 *     (whatsapp, instagram, email, ...) -> operations (KeyInboxController: @RequireModuleScope('operations'));
 *   - GoogleCalendarTemporalSyncService: module calendar, source GOOGLE_CALENDAR, type google_calendar.* ->
 *     bookings (CalendarController's event reads: bookings read); booking.* types too;
 *   - money-bearing types (invoice.*, payment.*, ...) and a module that names finance -> revenue (D-100);
 *   - KEY's timeline notes and reminders (KeyCortex temporal_flow.create_event / set_reminder: source key_cortex,
 *     free text that can carry money) -> revenue, unless their module names another owner or a business-wide module;
 *   - Shopify events (source SHOPIFY, type shopify.*) -> storefront and revenue (orders are money);
 *   - business-wide (BUSINESS_WIDE, their owners' own reads being membership only): BusinessAssetsService (module
 *     business-assets), BlueprintService and ConstitutionVersionService (module business-genome), the KEY action
 *     services (module key-autonomy), and an event recorded by hand (source MANUAL, the Schedule hub's form);
 *   - anything else (an unknown module, source or type: WEBHOOK, module connect, an unclassified APP type) fails
 *     closed (D-63, D-227, D-234): it is withheld from a reader who misses any event-owning module.
 * A `_` in a pattern is a one-character wildcard to ILIKE: it can only match more events, so withhold more.
 */
const OWNER_PATTERNS: Record<EventOwner, { modules: string[]; sources: string[]; typePrefixes: string[] }> = {
  operations: {
    modules: ['operations', 'key_inbox', 'key-inbox', 'keyinbox', 'inbox'],
    sources: ['key_inbox', 'whatsapp', 'instagram', 'email', 'gmail', 'meta', 'facebook', 'messenger', 'slack', 'sms', 'telegram', 'tiktok'],
    typePrefixes: ['key_inbox.', 'whatsapp.', 'instagram.', 'email.', 'gmail.', 'meta.', 'facebook.', 'messenger.', 'slack.', 'sms.', 'telegram.', 'tiktok.'],
  },
  bookings: {
    modules: ['bookings', 'booking', 'calendar'],
    sources: ['google_calendar'],
    typePrefixes: ['google_calendar.', 'calendar.', 'booking.'],
  },
  revenue: {
    modules: ['revenue', 'finance', 'invoice', 'invoices', 'payment', 'payments', 'billing', 'money'],
    sources: ['stripe', 'paypal', 'wipay', 'shopify'],
    typePrefixes: [
      'invoice.', 'payment.', 'quote.', 'estimate.', 'refund.', 'payout.', 'deposit.', 'subscription.',
      'credit_note.', 'revenue.', 'finance.', 'money.', 'stripe.', 'paypal.', 'wipay.', 'shopify.', 'order.',
    ],
  },
  storefront: {
    modules: ['storefront', 'shop', 'store'],
    sources: ['shopify'],
    typePrefixes: ['shopify.', 'storefront.', 'order.'],
  },
};

/** Business-wide modules (their owners' reads are membership only) and the hand-recorded source. */
const BUSINESS_WIDE = { modules: ['business-assets', 'business-genome', 'key-autonomy'], sources: ['manual'] };
/** KEY's own timeline writes: revenue-owned unless their module names an owner or a business-wide module. */
const KEY_NOTE_SOURCE = 'key_cortex';

/**
 * FU-TEMPORAL-FLOW-INBOX-SCOPE delta (item 1): the temporal memories' sourceModule values and the modules a reader
 * needs to see one (TemporalFlowMemoryService.summarize* write key_inbox). Any other value (the genome bridge's
 * temporal_flow patterns, built from events of every module) fails closed.
 */
const MEMORY_SOURCE_OWNERS: Record<string, readonly EventOwner[]> = { key_inbox: ['operations'] };

const ci = (value: string) => ({ equals: value, mode: 'insensitive' as const });
const ciPrefix = (value: string) => ({ startsWith: value, mode: 'insensitive' as const });

/**
 * `module` is nullable: each of its terms is bound to a non-null value, so a NOT around it keeps an event whose module
 * is null (SQL's NOT of a NULL comparison would drop it).
 */
const moduleIs = (value: string) => ({ AND: [{ module: { not: null } }, { module: ci(value) }] });

/** An event whose module names an event-owning module or a business-wide one. */
const KNOWN_MODULE = {
  OR: [...EVENT_OWNERS.flatMap((o) => OWNER_PATTERNS[o].modules), ...BUSINESS_WIDE.modules].map(moduleIs),
};

/** FU-TEMPORAL-FLOW-INBOX-SCOPE: the condition an event owned by `owner` meets. */
function ownedBy(owner: EventOwner): Record<string, unknown> {
  const p = OWNER_PATTERNS[owner];
  return {
    OR: [
      ...p.modules.map(moduleIs),
      ...p.sources.map((src) => ({ source: ci(src) })),
      ...p.typePrefixes.map((prefix) => ({ type: ciPrefix(prefix) })),
      ...(owner === 'revenue' ? [{ AND: [{ source: ci(KEY_NOTE_SOURCE) }, { NOT: KNOWN_MODULE }] }] : []),
    ],
  };
}

/** FU-TEMPORAL-FLOW-INBOX-SCOPE delta (item 2): an event no rule classifies (fails closed). */
const UNCLASSIFIED = {
  AND: [
    { NOT: { OR: EVENT_OWNERS.map(ownedBy) } },
    { NOT: { OR: [...BUSINESS_WIDE.modules.map(moduleIs), ...BUSINESS_WIDE.sources.map((src) => ({ source: ci(src) }))] } },
  ],
};

/** The events withheld from a reader who misses the `withheld` owners (non-empty). */
const withheldEvents = (withheld: readonly EventOwner[]) => ({ OR: [...withheld.map(ownedBy), UNCLASSIFIED] });

/**
 * FU-TIMELINE-CALLERS-SCOPE (R1-SEC-02, R2-SEC-01): classifies an event's owning module(s) from
 * `(module, source, type)` using the exact canonical rules as `ownedBy` / `UNCLASSIFIED`, for write-side
 * authorization on creates/upserts.
 *
 * Permissive checks (`knownModule`, `isBusinessWide`) use UNTRIMMED lowercased values so whitespace-padded
 * strings (e.g. `' business-assets '`, `' manual '`) never bypass SQL `ILIKE` (`ci()`) into `UNCLASSIFIED`
 * or `revenue`-owned storage. Restrictive checks (`OWNER_PATTERNS`, `KEY_NOTE_SOURCE`) match both raw and
 * trimmed values so padded owner labels remain conservatively classified as owned.
 */
function classifyEventOwners(input: { module?: string | null; source?: string | null; type?: string | null }): {
  owners: EventOwner[];
  unclassified: boolean;
} {
  const rawMod = typeof input.module === 'string' ? input.module.toLowerCase() : '';
  const rawSrc = typeof input.source === 'string' ? input.source.toLowerCase() : '';
  const rawTyp = typeof input.type === 'string' ? input.type.toLowerCase() : '';
  const trimMod = rawMod.trim();
  const trimSrc = rawSrc.trim();
  const trimTyp = rawTyp.trim();

  const knownModule =
    rawMod.length > 0 &&
    (EVENT_OWNERS.some((o) => OWNER_PATTERNS[o].modules.includes(rawMod)) || BUSINESS_WIDE.modules.includes(rawMod));

  const owners: EventOwner[] = [];
  let hasRawOwner = false;
  for (const owner of EVENT_OWNERS) {
    const p = OWNER_PATTERNS[owner];
    const rawMatch =
      (rawMod.length > 0 && p.modules.includes(rawMod)) ||
      (rawSrc.length > 0 && p.sources.includes(rawSrc)) ||
      (rawTyp.length > 0 && p.typePrefixes.some((prefix) => rawTyp.startsWith(prefix))) ||
      (owner === 'revenue' && rawSrc === KEY_NOTE_SOURCE && !knownModule);
    const trimMatch =
      (trimMod.length > 0 && p.modules.includes(trimMod)) ||
      (trimSrc.length > 0 && p.sources.includes(trimSrc)) ||
      (trimTyp.length > 0 && p.typePrefixes.some((prefix) => trimTyp.startsWith(prefix))) ||
      (owner === 'revenue' && trimSrc === KEY_NOTE_SOURCE && !knownModule);
    if (rawMatch) hasRawOwner = true;
    if (rawMatch || trimMatch) {
      owners.push(owner);
    }
  }

  const isBusinessWide =
    (rawMod.length > 0 && BUSINESS_WIDE.modules.includes(rawMod)) ||
    (rawSrc.length > 0 && BUSINESS_WIDE.sources.includes(rawSrc));
  const unclassified = !hasRawOwner && !isBusinessWide;
  return { owners, unclassified };
}

@Injectable()
export class TemporalFlowService {
  private readonly logger = new Logger(TemporalFlowService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TemporalFlowMemoryService) private readonly memoryService?: TemporalFlowMemoryService,
    @Inject(SemanticMemoryService) private readonly semanticMemory?: SemanticMemoryService,
  ) {}

  /**
   * FU-TIMELINE-CALLERS-SCOPE (R1-SEC-02): whether `writer` may emit an event naming `(module, source, type)`
   * in `businessId`. Fails closed when `writer` is null/missing or has no membership (unless active SUPER_ADMIN).
   * A writer who misses any owning module of the event (or emits an unclassified event while missing any owner)
   * is refused.
   */
  async canWriteEvent(
    businessId: string,
    input: Pick<TemporalFlowEventInput, 'module' | 'source' | 'type'>,
    writer: TemporalFlowReader,
  ): Promise<boolean> {
    const writerId = typeof writer?.id === 'string' ? writer.id.trim() : '';
    if (!writerId) return false;
    const normalized: TemporalFlowReader = { id: writerId, role: writer?.role };
    if (await this.isSuperAdmin(normalized)) return true;
    const membership = await this.prisma.client.membership.findUnique({
      where: { userId_businessId: { userId: writerId, businessId } },
      select: { role: true, permissionScopes: true },
    });
    if (!membership) return false;
    const reads = (module: EventOwner) =>
      rankOf(memberModuleLevel(membership, module)) >= LEVEL_RANK.read;
    const withheld = EVENT_OWNERS.filter((module) => !reads(module));
    if (withheld.length === 0) return true;
    const { owners, unclassified } = classifyEventOwners(input);
    if (unclassified) return false;
    return owners.every((o) => !withheld.includes(o));
  }

  /**
   * FU-TEMPORAL-FLOW-INBOX-SCOPE review repair (SEC N-3) + FU-TIMELINE-CALLERS-SCOPE (R1-SEC-02):
   * - When `writer` is provided (including `null` fail-closed), refuses writes whose owning module(s) are
   *   withheld from `writer` (or when `writer` is missing/non-member) BEFORE inserting or upserting.
   * - Given a writer's filter (readerFilter), an upsert whose (source, externalId) names an existing event the
   *   writer cannot read is refused (403) before anything is written.
   */
  async emit(
    input: TemporalFlowEventInput,
    writerFilter?: Record<string, unknown>,
    writer?: TemporalFlowReader,
  ) {
    if (writer !== undefined) {
      const allowed = await this.canWriteEvent(input.businessId, input, writer);
      if (!allowed) {
        throw new ForbiddenException('This event belongs to a module you cannot access');
      }
    }

    const effectiveWriterFilter =
      writer !== undefined && writerFilter === undefined && input.externalId
        ? await this.readerFilter(input.businessId, writer)
        : writerFilter;

    const data = this.buildCreateData(input);

    if (input.externalId && effectiveWriterFilter) {
      return this.emitScoped(input, data, effectiveWriterFilter);
    }

    if (input.externalId) {
      return this.prisma.client.temporalFlowEvent.upsert({
        where: {
          businessId_source_externalId: {
            businessId: input.businessId,
            source: input.source,
            externalId: input.externalId,
          },
        },
        create: data,
        update: this.buildUpdateData(input),
      });
    }

    return this.prisma.client.temporalFlowEvent.create({
      data: { ...data, id: randomUUID() },
    });
  }

  /**
   * FU-TEMPORAL-FLOW-INBOX-SCOPE, Codex P1 on #226: a write by external id for a writer with a filter, authorized and
   * written in one statement, so no row inserted between a check and the write can be reached. A check-then-upsert had a
   * window: a protected event a connector inserted after the check was updated in place.
   *
   * Create first. A new key is the writer's own event. On the key's unique conflict (the row exists, whenever it
   * arrived), update it only through a conditional updateMany whose where carries the writer's filter: Postgres
   * evaluates the filter on the row it updates, in the UPDATE itself, so a row the writer cannot read is never written.
   * No row updated (invisible, or gone since the conflict) answers the same 403 as before. The row is read back under
   * the same filter.
   *
   * Why not a locked or serializable transaction: the race is an insert of a row that does not exist yet, which
   * SELECT ... FOR UPDATE cannot lock; serializable isolation would need a retry loop for its serialization failures.
   * The unique key already serializes the two inserts, and a conditional update leaves no window.
   */
  private async emitScoped(
    input: TemporalFlowEventInput,
    data: ReturnType<TemporalFlowService['buildCreateData']>,
    writerFilter: Record<string, unknown>,
  ) {
    try {
      return await this.prisma.client.temporalFlowEvent.create({ data });
    } catch (err) {
      if ((err as { code?: unknown } | null)?.code !== 'P2002') throw err;
    }
    const key = { businessId: input.businessId, source: input.source, externalId: input.externalId };
    const { count } = await this.prisma.client.temporalFlowEvent.updateMany({
      where: this.scoped(key, writerFilter),
      data: this.buildUpdateData(input),
    });
    const row = count
      ? await this.prisma.client.temporalFlowEvent.findFirst({ where: this.scoped(key, writerFilter) })
      : null;
    if (!row) throw new ForbiddenException('This event belongs to a module you cannot read');
    return row;
  }

  /**
   * FU-TEMPORAL-FLOW-INBOX-SCOPE (D-100, D-179): the condition that withholds from `reader` the events of every
   * event-owning module (EVENT_OWNERS) they cannot read, and, when they miss any, every unclassified event (fails
   * closed, delta item 2), applied in the query itself, before its order and limit, so a page holds as many events as the
   * reader may see and no count or page boundary counts a withheld one. The reader's levels are read as
   * ModuleScopeGuard reads them (memberModuleLevel: the membership of this business, its explicit permissionScopes
   * map, a JSON array included, a missing key being none, D-179; else its role's defaults); a platform SUPER_ADMIN
   * passes, as the guard passes them. No reader, or no membership of this business: every owning module is withheld.
   * undefined: nothing is withheld (a reader of every event-owning module sees every event, as before: delta M-1).
   */
  async readerFilter(businessId: string, reader: TemporalFlowReader): Promise<Record<string, unknown> | undefined> {
    const withheld = await this.withheldOwners(businessId, reader);
    return withheld.length ? { NOT: withheldEvents(withheld) } : undefined;
  }

  /**
   * FU-TIMELINE-CALLERS-SCOPE (matching genomeReaderRevenueLevel, D-238): a reader passed by id alone
   * (KEY tool ctx.userId, connector command userId) is checked for platform SUPER_ADMIN so a SUPER_ADMIN
   * without a membership row is not mistaken for a non-member, while any error fails closed.
   */
  private async isSuperAdmin(reader: TemporalFlowReader): Promise<boolean> {
    if (!reader?.id) return false;
    if (reader.role === 'SUPER_ADMIN') return true;
    if (reader.role !== undefined) return false;
    try {
      const user = await this.prisma.client.user?.findUnique({
        where: { id: reader.id },
        select: { role: true, deletedAt: true, bannedAt: true },
      });
      return user?.role === 'SUPER_ADMIN' && !user.deletedAt && !user.bannedAt;
    } catch {
      return false;
    }
  }

  /**
   * FU-TEMPORAL-FLOW-INBOX-SCOPE: the event-owning modules `reader` cannot read in `businessId` (read as readerFilter
   * says). [] for a reader of all of them and for a platform SUPER_ADMIN.
   */
  private async withheldOwners(businessId: string, reader: TemporalFlowReader): Promise<EventOwner[]> {
    if (await this.isSuperAdmin(reader)) return [];
    const membership = reader?.id
      ? await this.prisma.client.membership.findUnique({
          where: { userId_businessId: { userId: reader.id, businessId } },
          select: { role: true, permissionScopes: true },
        })
      : null;
    const reads = (module: EventOwner) =>
      !!membership && rankOf(memberModuleLevel(membership, module)) >= LEVEL_RANK.read;
    return EVENT_OWNERS.filter((module) => !reads(module));
  }

  /**
   * FU-TEMPORAL-FLOW-INBOX-SCOPE delta (item 1): the condition that withholds from `reader` the temporal memories they
   * may not see, in the query before its order and limit: a memory whose sourceModule needs a module they cannot read
   * (MEMORY_SOURCE_OWNERS; an unknown one fails closed), and a memory built from an event withheld from them (its
   * sourceEventIds name one). undefined: nothing is withheld (a reader of every event-owning module).
   */
  async readerMemoryFilter(businessId: string, reader: TemporalFlowReader): Promise<Record<string, unknown> | undefined> {
    const withheld = await this.withheldOwners(businessId, reader);
    if (!withheld.length) return undefined;
    const allowed = Object.entries(MEMORY_SOURCE_OWNERS)
      .filter(([, owners]) => owners.every((o) => !withheld.includes(o)))
      .map(([sourceModule]) => sourceModule);
    if (!allowed.length) return { id: { in: [] } };
    const hidden = await this.prisma.client.temporalFlowEvent.findMany({
      where: { AND: [{ businessId }, withheldEvents(withheld)] },
      select: { id: true },
    });
    const hiddenIds = hidden.map((e: { id: string }) => e.id);
    return {
      AND: [
        { sourceModule: { in: allowed } },
        ...(hiddenIds.length ? [{ NOT: { sourceEventIds: { hasSome: hiddenIds } } }] : []),
      ],
    };
  }

  /**
   * FU-TEMPORAL-FLOW-INBOX-SCOPE delta (item 1), MEM-TEMPORAL-MEMORY-ROUTES-SIGHT: the memories of `businessId` a reader
   * with `ms` may see, as TemporalFlowMemoryService.findMany reads them (newest updated first, 100 unless a limit is
   * given): readerMemoryFilter in the query, then MEM-SEMANTIC-SIGHT's rule (visibleMemories), page by page until the
   * limit is filled, so a withheld memory takes no place. An entity id that is not a string matches nothing.
   */
  async listMemory(
    businessId: string,
    query: { entityType?: string; entityId?: string | null; type?: string; limit?: number | string },
    ms: TemporalMemorySight,
  ) {
    if (query.entityId !== undefined && query.entityId !== null && typeof query.entityId !== 'string') return [];
    const asked = Number(query.limit);
    const limit = Number.isInteger(asked) && asked > 0 ? asked : 100;
    const where = this.scoped(
      {
        businessId,
        ...(query.entityType ? { entityType: String(query.entityType) } : {}),
        ...(query.entityId !== undefined ? { entityId: query.entityId ?? null } : {}),
        ...(query.type ? { type: String(query.type) } : {}),
      },
      ms.filter,
    );
    const wanted = Math.min(limit, MEMORY_PAGE_CAP);
    // Review round 1: pages grow (fewer reads past many withheld rows) up to the client's cap; a row seen on an earlier
    // page (a summary rewritten in place while the scan runs moves up the order) is not answered twice.
    const out: Awaited<ReturnType<typeof this.prisma.client.temporalFlowMemory.findMany>> = [];
    const seen = new Set<string>();
    let page = Math.min(Math.max(wanted, 50), MEMORY_PAGE_CAP);
    for (let skip = 0; out.length < wanted && skip < MAX_MEMORY_SCAN; ) {
      const rows = await this.prisma.client.temporalFlowMemory.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip,
        take: page,
      });
      const fresh = rows.filter((row) => !seen.has(row.id));
      fresh.forEach((row) => seen.add(row.id));
      out.push(...(await this.visibleMemories(businessId, fresh, { who: ms.who })));
      if (rows.length < page) break;
      skip += rows.length;
      page = Math.min(page * 2, MEMORY_PAGE_CAP);
    }
    return out.slice(0, wanted);
  }

  /** FU-TEMPORAL-FLOW-INBOX-SCOPE delta (item 1): of `memoryIds`, the ones of `businessId` `memoryFilter` lets through. */
  async visibleMemoryIds(businessId: string, memoryIds: string[], memoryFilter: Record<string, unknown>): Promise<Set<string>> {
    const ids = memoryIds.filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (!ids.length) return new Set();
    const rows = await this.prisma.client.temporalFlowMemory.findMany({
      where: this.scoped({ businessId, id: { in: ids } }, memoryFilter),
      select: { id: true },
    });
    return new Set(rows.map((r: { id: string }) => r.id));
  }

  /**
   * MEM-TEMPORAL-MEMORY-ROUTES-SIGHT (D-257, D-234, D-100): the sight of `reader`'s temporal memory reads in `businessId`:
   * readerMemoryFilter, and the member's module sight read as ModuleScopeGuard reads it (readersModuleSight: no member,
   * no module). A platform SUPER_ADMIN passes, as readerFilter passes them (the guard admits them). No reader: nothing
   * (every summary names a module, or every module).
   */
  async memorySight(businessId: string, reader: TemporalFlowReader): Promise<TemporalMemorySight> {
    const filter = await this.readerMemoryFilter(businessId, reader);
    if (await this.isSuperAdmin(reader)) return { filter, who: { reader: reader!.id!, sight: () => true } };
    const id = reader?.id ?? null;
    const { readersModuleSight } = await sightHelpers();
    const sight = await readersModuleSight(this.prisma, businessId, id, this.logger, 'temporalMemory');
    return { filter, who: { reader: id, sight } };
  }

  /**
   * MEM-TEMPORAL-MEMORY-ROUTES-SIGHT: of `rows` (temporal memories of `businessId`), the ones `ms` admits, in order: its
   * filter (readerMemoryFilter) and MEM-SEMANTIC-SIGHT's rule for a summary (semanticHitsVisibleTo over the row's own
   * copy form, so the row is read again within the business and a row changed since is left out). A read that fails
   * raises (nothing is served).
   */
  async visibleMemories<R extends { id: string; entityType: string; type: string; content: string }>(
    businessId: string,
    rows: R[],
    ms: TemporalMemorySight,
  ): Promise<R[]> {
    if (!rows.length) return rows;
    const passed = ms.filter ? await this.visibleMemoryIds(businessId, rows.map((row) => row.id), ms.filter) : undefined;
    const candidates = passed ? rows.filter((row) => passed.has(row.id)) : rows;
    if (!candidates.length) return candidates;
    const { semanticHitsVisibleTo, temporalCopyOf } = await sightHelpers();
    const keep = await semanticHitsVisibleTo(
      this.prisma,
      businessId,
      ms.who,
      candidates.map((row) => ({ sourceType: TEMPORAL_MEMORY_SOURCE_TYPE, sourceId: row.id, content: temporalCopyOf(row) })),
      this.logger,
    );
    return candidates.filter((_, i) => keep[i]);
  }

  /**
   * MEM-TEMPORAL-SCOPE / MEM-TEMPORAL-MEMORY-ROUTES-SIGHT: one memory of `businessId` by id when `ms` admits it, else
   * null: a memory withheld from the reader reads as a missing one (and as another business's).
   */
  async visibleMemoryById(businessId: string, memoryId: unknown, ms: TemporalMemorySight) {
    if (typeof memoryId !== 'string' || !memoryId || typeof businessId !== 'string' || !businessId) return null;
    const row = await this.prisma.client.temporalFlowMemory.findFirst({ where: { id: memoryId, businessId } });
    if (!row) return null;
    const [visible] = await this.visibleMemories(businessId, [row], ms);
    return visible ?? null;
  }

  /**
   * MEM-TEMPORAL-MEMORY-ROUTES-SIGHT (delta A1): writes `data` onto `row` (a memory of `businessId` an actor's sight
   * admitted, visibleMemoryById) only while the row is still the one that was checked (its updatedAt and its content
   * unchanged: the content term holds when a rewrite is stamped in the same millisecond, @updatedAt being the app
   * clock's), in one
   * statement that answers the row it wrote. null when the row is gone or was rewritten since the check (a summarizer
   * may write money text into it): the caller answers as for a missing memory, and nothing is written.
   */
  async updateMemoryIfUnchanged(
    businessId: string,
    row: { id: string; updatedAt: Date; content: string },
    data: { content?: string; confidence?: number; sourceEventIds?: string[]; metadata?: Record<string, unknown> },
  ) {
    try {
      return await this.prisma.client.temporalFlowMemory.update({
        where: { id: row.id, businessId, updatedAt: row.updatedAt, content: row.content },
        data: {
          content: data.content,
          confidence: data.confidence,
          sourceEventIds: data.sourceEventIds,
          metadata: data.metadata as never,
        },
      });
    } catch (err) {
      if ((err as { code?: unknown } | null)?.code === 'P2025') return null;
      throw err;
    }
  }

  /**
   * MEM-TEMPORAL-MEMORY-ROUTES-SIGHT (delta A2): deletes `row` (as updateMemoryIfUnchanged takes it) only while it is
   * still the one that was checked, in one statement. false when it is gone or was rewritten since the check.
   */
  async deleteMemoryIfUnchanged(businessId: string, row: { id: string; updatedAt: Date; content: string }): Promise<boolean> {
    const { count } = await this.prisma.client.temporalFlowMemory.deleteMany({
      where: { id: row.id, businessId, updatedAt: row.updatedAt, content: row.content },
    });
    return count > 0;
  }

  /**
   * MEM-TEMPORAL-MEMORY-ROUTES-SIGHT (D-257, D-234): the semantic search of `businessId`'s temporal memories for a reader:
   * as TemporalFlowMemoryService.searchMemory searches (temporal_memory copies, similarity 0.7 or more), each hit kept only
   * when MEM-SEMANTIC-SIGHT's reader projection (readerSearchOptions) and readerMemoryFilter both admit it, before the
   * limit is cut (the search pages on past withheld hits). A query that is not one non-empty string reads nothing.
   */
  async searchVisibleMemory(
    businessId: string,
    query: unknown,
    limit: number,
    ms: TemporalMemorySight,
    minSimilarity = 0.7,
  ) {
    if (!this.semanticMemory || typeof query !== 'string' || !query.trim()) return [];
    const max = Number.isInteger(limit) && limit > 0 ? limit : 10;
    const { readerSearchOptions } = await sightHelpers();
    const reader = readerSearchOptions(this.prisma, businessId, ms.who, this.logger);
    return this.semanticMemory.search({
      businessId,
      query,
      limit: max,
      sourceTypes: [TEMPORAL_MEMORY_SOURCE_TYPE],
      minSimilarity,
      includeDocumentExtractionCopies: reader.includeDocumentExtractionCopies,
      visibleTo: async (hits) => {
        const keep = await reader.visibleTo(hits);
        if (!ms.filter) return keep;
        const passed = await this.visibleMemoryIds(businessId, hits.map((hit) => hit.sourceId), ms.filter);
        return hits.map((hit, i) => keep[i] && passed.has(hit.sourceId));
      },
    });
  }

  /** FU-TEMPORAL-FLOW-INBOX-SCOPE: `where` with the reader's filter (readerFilter) added, when one is given. */
  private scoped(where: Record<string, unknown>, filter: Record<string, unknown> | undefined) {
    return filter ? { AND: [where, filter] } : where;
  }

  /**
   * FU-PROPOSAL-REVENUE-SIGHT (owner ruling D-238; security review MAJOR-5): KeyActionProposalService writes each KEY
   * proposal's lifecycle here (entityType key_action_proposal: proposed, executed with its result, approval lapsed with
   * its reason). For a reader without revenue read, an event of a financial proposal, of a proposal that cannot be read
   * (fail closed) or whose own title or description states money is left out; every other event is unchanged. A call
   * with no `reader` argument (the scheduler, KEY tools applying their own authority) is unchanged; a request with no
   * user passes `null` and reads none.
   */
  private async forReader<E extends { entityType?: string | null; entityId?: string | null; type?: string | null; title?: string | null; summary?: string | null; description?: string | null; payload?: unknown; metadata?: unknown; signals?: unknown }>(
    businessId: string,
    events: E[],
    reader: GenomeReader | null | undefined,
    /** The reader's revenue read when the caller has already resolved it (the paged list resolves it once). */
    readsRevenue?: boolean,
  ): Promise<E[]> {
    if (reader === undefined) return events;
    const proposals = events.filter((e) => e.entityType === 'key_action_proposal');
    const evolutions = events.filter((e) => isGenomeEvolutionEvent(e));
    const dnaSections = events.filter((e) => isDnaSectionEvent(e));
    if (proposals.length === 0 && evolutions.length === 0 && dnaSections.length === 0) return events;
    if (readsRevenue ?? (await genomeReaderReadsRevenue(this.prisma, businessId, reader ?? undefined))) return events;
    // FU-KEY-ACTION-GENOME-PROJECTION (D-233, D-238): a genome-evolution decision row is served only when its proposal
    // is read in this business, is of a non-money DNA section and nothing in it or the row states money (fail closed).
    const evolutionFlags = await readableGenomeEvolutionEvents(this.prisma, businessId, evolutions);
    const withheld = new Set<E>(evolutions.filter((_e, i) => !evolutionFlags[i]));
    // Round 6: the DNA section row an approval (or a DNA edit) writes carries the same patch. Round 7: a non-money
    // section's row whose data holds a figure or money is served with its data left out.
    const redacted = new Map<E, E>();
    for (const e of dnaSections) {
      const view = dnaSectionViewForReader(e);
      if (view === 'withhold') withheld.add(e);
      else if (view === 'redact') redacted.set(e, redactedDnaSectionEvent(e));
    }
    if (withheld.size || redacted.size) events = events.filter((e) => !withheld.has(e)).map((e) => redacted.get(e) ?? e);
    if (proposals.length === 0) return events;
    const ids = [...new Set(proposals.map((e) => e.entityId).filter((id): id is string => typeof id === 'string' && !!id))];
    let rows: Map<string, Record<string, unknown>>;
    try {
      const found = ids.length
        ? await this.prisma.client.keyActionProposal.findMany({
            where: { businessId, id: { in: ids } },
            select: PROPOSAL_CLASSIFY_SELECT,
          })
        : [];
      rows = new Map(found.map((r: { id: string }) => [r.id, r as Record<string, unknown>]));
    } catch {
      return events.filter((e) => e.entityType !== 'key_action_proposal');
    }
    // Financial by the proposal row (its own fields or the recommendation it was bridged from), fail closed.
    const entries = [...rows.entries()];
    const flags = await financialProposalsWithProvenance(this.prisma, businessId, entries.map(([, row]) => row as never));
    const financial = new Map<string, boolean>(entries.map(([id], i) => [id, flags[i]]));
    const served: E[] = [];
    for (const e of events) {
      if (e.entityType !== 'key_action_proposal') {
        served.push(e);
        continue;
      }
      const known = e.entityId ? financial.get(e.entityId) : undefined;
      // Round 9: the row as it is served (its rule-trace metadata left out) is the row that is classified.
      const payload = ruleTraceWithoutMetadata(e.payload);
      const view = payload === e.payload ? e : ({ ...e, payload } as E);
      // The row's summary too (FU-KEY-ACTION-GENOME-PROJECTION: key.action.create_task copies the proposal's rationale there).
      // Round 3 (security MINOR-1): the row's whole payload and signals are read, not only their named keys.
      // Round 6 (correctness MINOR-2): the title and description are read as the summary is.
      const readable = known === false && !isMoneyLabel(e.title) && !isMoneyLabel(e.description) && !isMoneyLabel(e.summary)
        && !proposalTextStatesMoney(e.title) && !proposalTextStatesMoney(e.description)
        && !proposalTextStatesMoney(e.summary) && !eventTextStatesMoney(view)
        && !structuredValueStatesMoney(payload) && !structuredValueStatesMoney(e.signals);
      if (readable) served.push(view);
    }
    return served;
  }

  /**
   * FU-TEMPORAL-FLOW-INBOX-SCOPE (merge with D-238): `reader` is D-238's proposal projection (forReader, after the
   * query, paging on until the page is full); `readerFilter` is the module filter (readerFilter, in the query, before
   * order and limit). Each is applied when given; a route passes both.
   */
  async list(
    businessId: string,
    query: TemporalFlowListQuery = {},
    reader?: GenomeReader | null,
    readerFilter?: Record<string, unknown>,
  ) {
    const where: Record<string, unknown> = { businessId };

    if (query.source) where.source = query.source;
    if (query.type) where.type = query.type;
    if (query.module) where.module = query.module;
    if (query.status) where.status = query.status;
    if (query.importance) where.importance = query.importance;
    if (query.genomeImpactPotential != null) where.genomeImpactPotential = query.genomeImpactPotential;

    if (query.from || query.to) {
      where.occurredAt = {
        ...(query.from && { gte: new Date(query.from) }),
        ...(query.to && { lte: new Date(query.to) }),
      };
    }

    where.visibility = { not: 'HIDDEN' };

    const limit = query.limit ?? 100;
    const scopedWhere = this.scoped(where, readerFilter);
    if (reader === undefined) {
      return this.prisma.client.temporalFlowEvent.findMany({ where: scopedWhere, orderBy: { occurredAt: 'desc' }, take: limit });
    }
    // Codex P2 on #218 and its reviews: when the rows are filtered for a reader, the limit counts what the reader may
    // see. A reader's limit is capped (MAX_READER_LIMIT); a negative limit serves nothing and a fraction is truncated.
    // The reader's revenue read is resolved once. A revenue reader costs one read of `limit` rows. For any other reader
    // the first read is `limit` rows; while rows were withheld the read pages on, in a stable order and never serving a
    // row twice, until the limit is met, the rows end, or MAX_READER_SCAN rows have been scanned (then the page may be
    // short).
    const want = Math.min(Math.max(0, Math.trunc(Number(limit)) || 0), MAX_READER_LIMIT);
    if (want === 0) return [];
    const orderBy = [{ occurredAt: 'desc' as const }, { id: 'desc' as const }];
    const readsRevenue = await genomeReaderReadsRevenue(this.prisma, businessId, reader ?? undefined);
    if (readsRevenue) return this.prisma.client.temporalFlowEvent.findMany({ where: scopedWhere, orderBy, take: want });
    const visible: Awaited<ReturnType<typeof this.prisma.client.temporalFlowEvent.findMany>> = [];
    const seen = new Set<string>();
    let skip = 0;
    while (visible.length < want && skip < MAX_READER_SCAN) {
      const take = Math.min(skip === 0 ? want : Math.max(want, 100), MAX_READER_SCAN - skip);
      const page = await this.prisma.client.temporalFlowEvent.findMany({ where: scopedWhere, orderBy, skip, take });
      for (const event of await this.forReader(businessId, page, reader, false)) {
        if (seen.has(event.id)) continue;
        seen.add(event.id);
        visible.push(event);
      }
      skip += page.length;
      if (page.length < take) break;
    }
    return visible.slice(0, want);
  }

  async calendarRange(
    businessId: string,
    from: string,
    to: string,
    reader?: GenomeReader | null,
    readerFilter?: Record<string, unknown>,
  ) {
    const fromDate = new Date(from);
    const toDate = new Date(to);

    const events = await this.prisma.client.temporalFlowEvent.findMany({
      where: this.scoped(
        {
          businessId,
          visibility: { not: 'HIDDEN' },
          OR: [
            { startsAt: { gte: fromDate, lte: toDate } },
            { occurredAt: { gte: fromDate, lte: toDate } },
            { reminderAt: { gte: fromDate, lte: toDate } },
          ],
        },
        readerFilter,
      ),
      orderBy: [{ startsAt: 'asc' }, { occurredAt: 'asc' }],
    });
    return this.forReader(businessId, events, reader);
  }

  async remindersDue(businessId: string, reader?: GenomeReader | null, readerFilter?: Record<string, unknown>) {
    const events = await this.prisma.client.temporalFlowEvent.findMany({
      where: this.scoped(
        {
          businessId,
          reminderAt: { lte: new Date() },
          status: { in: ['RECORDED', 'ACTION_REQUIRED'] },
          visibility: { not: 'HIDDEN' },
        },
        readerFilter,
      ),
      orderBy: { reminderAt: 'asc' },
      take: 50,
    });
    return this.forReader(businessId, events, reader);
  }

  /**
   * FU-TEMPORAL-FLOW-INBOX-SCOPE review repair (SEC N-2) + FU-TIMELINE-CALLERS-SCOPE (R1-SEC-03/04, R1-COR-02):
   * - If `reader` is supplied without `writerFilter`, derives `readerFilter(businessId, reader)` automatically
   *   so callers cannot accidentally fail open on module ownership.
   * - When scoped (`effectiveFilter !== undefined || reader !== undefined`), excludes `HIDDEN` events so
   *   members cannot probe or mutate hidden timeline rows.
   * - When `reader !== undefined`, verifies D-238 `forReader` visibility and closes the check-then-write
   *   TOCTOU window by pinning `updatedAt`, `entityType`, `entityId`, `title`, and `summary` on `updateMany`.
   */
  async markResolved(
    businessId: string,
    eventId: string,
    writerFilter?: Record<string, unknown>,
    reader?: GenomeReader | null,
  ) {
    const effectiveFilter =
      reader !== undefined && writerFilter === undefined
        ? await this.readerFilter(businessId, reader)
        : writerFilter;
    const baseWhere: Record<string, unknown> = { id: eventId, businessId };
    if (effectiveFilter !== undefined || reader !== undefined) {
      baseWhere.visibility = { not: 'HIDDEN' };
    }
    const where = this.scoped(baseWhere, effectiveFilter);
    if (reader !== undefined) {
      const existing = await this.prisma.client.temporalFlowEvent.findFirst({ where });
      if (!existing) return { count: 0 };
      const visible = await this.forReader(businessId, [existing], reader);
      if (visible.length === 0) return { count: 0 };
      return this.prisma.client.temporalFlowEvent.updateMany({
        where: this.scoped(
          {
            ...baseWhere,
            ...(existing.updatedAt ? { updatedAt: existing.updatedAt } : {}),
            entityType: existing.entityType,
            entityId: existing.entityId,
            title: existing.title,
            summary: existing.summary,
          },
          effectiveFilter,
        ),
        data: {
          status: 'RESOLVED',
          completedAt: new Date(),
        },
      });
    }
    return this.prisma.client.temporalFlowEvent.updateMany({
      where,
      data: {
        status: 'RESOLVED',
        completedAt: new Date(),
      },
    });
  }

  async analyze(
    businessId: string,
    readerFilter?: Record<string, unknown>,
    memorySight?: TemporalMemorySight,
    reader?: GenomeReader | null,
  ): Promise<TemporalFlowAnalysis> {
    const recent = await this.list(businessId, { limit: 500 }, reader, readerFilter);

    const urgentItems: TemporalFlowAnalysis['urgentItems'] = [];
    const opportunities: TemporalFlowAnalysis['opportunities'] = [];
    const risks: TemporalFlowAnalysis['risks'] = [];

    const now = new Date();
    const overdueInvoices = recent.filter(
      (e) => e.source === 'APP' && e.type === 'invoice.overdue' && e.status !== 'RESOLVED',
    );
    if (overdueInvoices.length) {
      urgentItems.push({
        title: 'Overdue invoices need follow-up',
        reason: `${overdueInvoices.length} invoice(s) are overdue.`,
      });
      risks.push({
        title: 'Cash flow risk from overdue invoices',
        severity: 'HIGH',
        evidence: overdueInvoices.map((e) => e.title),
      });
    }

    const assetExpiryReminders = recent.filter(
      (e) => e.type === 'asset.expiring_soon' && e.status !== 'RESOLVED',
    );
    if (assetExpiryReminders.length) {
      urgentItems.push({
        title: 'Assets expiring soon',
        reason: `${assetExpiryReminders.length} asset reminder(s) require attention.`,
      });
      risks.push({
        title: 'Operational/legal risk from expiring assets',
        severity: 'MEDIUM',
        evidence: assetExpiryReminders.map((e) => e.title),
      });
    }

    const criticalRecorded = recent.filter(
      (e) => e.importance === 'CRITICAL' && e.status !== 'RESOLVED' && e.status !== 'DISMISSED',
    );
    for (const event of criticalRecorded) {
      urgentItems.push({
        title: event.title,
        reason: 'Critical event requires attention.',
        eventId: event.id,
      });
    }

    const whatsappLeads = recent.filter((e) => e.source === 'WHATSAPP' && e.type.includes('lead'));
    if (whatsappLeads.length >= 3) {
      opportunities.push({
        title: 'WhatsApp is becoming a lead channel',
        evidence: whatsappLeads.slice(0, 5).map((e) => e.title),
      });
    }

    const instagramDms = recent.filter((e) => e.source === 'INSTAGRAM' && e.type === 'instagram.dm.received');
    if (instagramDms.length >= 5) {
      opportunities.push({
        title: 'Instagram DM volume suggests marketing momentum',
        evidence: instagramDms.slice(0, 5).map((e) => e.title),
      });
    }

    const bookings = recent.filter((e) => e.type === 'booking.created');
    if (bookings.length >= 5) {
      opportunities.push({
        title: 'Booking volume rising — review Operations DNA',
        evidence: [`${bookings.length} bookings recorded recently.`],
      });
    }

    const genomeProposalCandidates = await this.findGenomeSignals(businessId, recent);

    const memoryInsights = await this.buildMemoryInsights(businessId, memorySight);

    const summaryParts = [
      `${recent.length} events analyzed.`,
      urgentItems.length ? `${urgentItems.length} urgent item(s).` : 'No urgent items.',
      opportunities.length ? `${opportunities.length} opportunity(s) detected.` : 'No major opportunities detected.',
      risks.length ? `${risks.length} risk(s) flagged.` : 'No risks flagged.',
      genomeProposalCandidates.length
        ? `${genomeProposalCandidates.length} Genome evolution candidate(s).`
        : 'No Genome candidates yet.',
      memoryInsights.length ? `${memoryInsights.length} memory-backed insight(s).` : '',
    ].filter(Boolean);

    return {
      summary: summaryParts.join(' '),
      urgentItems,
      opportunities,
      risks,
      genomeProposalCandidates,
      memoryInsights: memoryInsights.length ? memoryInsights : undefined,
    };
  }

  /**
   * FU-TEMPORAL-FLOW-INBOX-SCOPE delta (item 1), MEM-TEMPORAL-MEMORY-ROUTES-SIGHT (D-257, D-234): given a reader's memory
   * sight (memorySight), the listed summaries and the semantic recall carry only memories the reader may see, each
   * filtered before its limit (listMemory, searchVisibleMemory). With none (the command center, the executive brief,
   * KEY's analyze_timeline, which apply their own authority), every memory, as before.
   */
  private async buildMemoryInsights(
    businessId: string,
    memorySight?: TemporalMemorySight,
  ): Promise<TemporalFlowMemoryInsight[]> {
    const insights: NonNullable<TemporalFlowAnalysis['memoryInsights']> = [];
    if (!this.memoryService) return insights;

    const recentMemory = memorySight
      ? await this.listMemory(businessId, { limit: 20 }, memorySight)
      : await this.memoryService.findMany(businessId, { limit: 20 });
    for (const memory of recentMemory) {
      if (memory.confidence < 0.6) continue;
      if (memory.type === 'summary') {
        insights.push({
          title: `Memory: ${memory.entityType} ${memory.entityId ?? ''}`,
          reason: memory.content,
          memoryId: memory.id,
        });
      }
    }

    if (this.semanticMemory) {
      try {
        const recallQuery = 'overdue invoice complaint urgent follow-up';
        const recall = memorySight
          ? await this.searchVisibleMemory(businessId, recallQuery, 3, memorySight, 0.72)
          : await this.semanticMemory.search({
              businessId,
              query: recallQuery,
              limit: 3,
              sourceTypes: [TEMPORAL_MEMORY_SOURCE_TYPE],
              minSimilarity: 0.72,
            });
        for (const hit of recall) {
          insights.push({
            title: 'Memory recall: follow-up context',
            reason: hit.content,
            evidence: [`similarity ${hit.similarity.toFixed(2)}`],
          });
        }
      } catch {
        // semantic search is optional; ignore failures (a projected recall that fails serves nothing)
      }
    }

    return insights;
  }

  async findGenomeSignals(
    businessId: string,
    recent?: Awaited<ReturnType<typeof this.list>>,
    reader?: GenomeReader | null,
    readerFilter?: Record<string, unknown>,
  ): Promise<TemporalFlowGenomeCandidate[]> {
    const effectiveFilter =
      reader !== undefined && readerFilter === undefined
        ? await this.readerFilter(businessId, reader)
        : readerFilter;
    const events = recent ?? (await this.list(businessId, { limit: 500 }, reader, effectiveFilter));
    const candidates: TemporalFlowGenomeCandidate[] = [];

    const whatsappLeads = events.filter(
      (e) => e.source === 'WHATSAPP' && e.type.includes('lead'),
    );
    if (whatsappLeads.length >= 3) {
      candidates.push({
        section: 'marketing',
        reason: 'WhatsApp appears to be a meaningful acquisition source.',
        evidence: [`${whatsappLeads.length} WhatsApp lead events detected.`],
        eventIds: whatsappLeads.map((e) => e.id),
      });
    }

    const instagramDms = events.filter(
      (e) => e.source === 'INSTAGRAM' && e.type === 'instagram.dm.received',
    );
    if (instagramDms.length >= 5) {
      candidates.push({
        section: 'marketing',
        reason: 'Instagram DM volume indicates active audience engagement.',
        evidence: [`${instagramDms.length} Instagram DM events detected.`],
        eventIds: instagramDms.map((e) => e.id),
      });
    }

    const bookings = events.filter((e) => e.type === 'booking.created');
    if (bookings.length >= 5) {
      candidates.push({
        section: 'operations',
        reason: 'Rising booking volume suggests operations workflows are material.',
        evidence: [`${bookings.length} booking events detected.`],
        eventIds: bookings.map((e) => e.id),
      });
    }

    const invoices = events.filter((e) => e.type === 'invoice.paid');
    if (invoices.length >= 3) {
      candidates.push({
        section: 'sales',
        reason: 'Paid invoice activity confirms a working sales channel.',
        evidence: [`${invoices.length} paid invoice events detected.`],
        eventIds: invoices.map((e) => e.id),
      });
    }

    const assetExpiries = events.filter((e) => e.type === 'asset.expiring_soon');
    if (assetExpiries.length >= 1) {
      candidates.push({
        section: 'risk',
        reason: 'Expiring assets indicate active risk management needs.',
        evidence: [`${assetExpiries.length} asset expiry reminder(s) detected.`],
        eventIds: assetExpiries.map((e) => e.id),
      });
    }

    return candidates;
  }

  private buildCreateData(input: TemporalFlowEventInput) {
    return {
      businessId: input.businessId,
      userId: input.userId,
      source: input.source,
      type: input.type,
      module: input.module,
      entityType: input.entityType,
      entityId: input.entityId,
      title: input.title,
      summary: input.summary,
      description: input.description,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      occurredAt: input.occurredAt ?? new Date(),
      status: input.status ?? 'RECORDED',
      importance: input.importance ?? 'NORMAL',
      visibility: input.visibility ?? 'USER',
      payload: input.payload ?? {},
      signals: input.signals ?? {},
      tags: input.tags ?? [],
      reminderAt: input.reminderAt,
      genomeImpactPotential: input.genomeImpactPotential ?? false,
      keyAnalysisStatus: input.keyAnalysisStatus ?? 'PENDING',
      threadId: input.threadId,
      messageId: input.messageId,
      contactId: input.contactId,
      memoryEmbeddingId: input.memoryEmbeddingId,
      externalId: input.externalId,
      externalUrl: input.externalUrl,
    };
  }

  private buildUpdateData(input: TemporalFlowEventInput) {
    return {
      userId: input.userId,
      type: input.type,
      module: input.module,
      entityType: input.entityType,
      entityId: input.entityId,
      title: input.title,
      summary: input.summary,
      description: input.description,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      occurredAt: input.occurredAt ?? new Date(),
      status: input.status ?? 'RECORDED',
      importance: input.importance ?? 'NORMAL',
      visibility: input.visibility ?? 'USER',
      payload: input.payload ?? {},
      signals: input.signals ?? {},
      tags: input.tags ?? [],
      reminderAt: input.reminderAt,
      genomeImpactPotential: input.genomeImpactPotential ?? false,
      keyAnalysisStatus: input.keyAnalysisStatus ?? 'PENDING',
      threadId: input.threadId,
      messageId: input.messageId,
      contactId: input.contactId,
      memoryEmbeddingId: input.memoryEmbeddingId,
      externalUrl: input.externalUrl,
    };
  }
}
