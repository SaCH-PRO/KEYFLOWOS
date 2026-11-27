/**
 * MEM-CLASS-READ (P137; D-100, D-128, D-226, D-227, D-233, D-234, D-238, D-257):
 * Single authoritative reader projection deciding EVERY memory read across KEY
 * stores by `data_class`, `module_scope`, `PERSONAL` ownership, read-time
 * classification of legacy `data_class IS NULL` rows, and a fail-closed
 * word-heuristic backstop.
 *
 * Pure leaf module (zero NestJS/Prisma/service circular dependencies) so every
 * memory reader — `UnifiedMemoryRetrievalService`, `readersOwnPromptMemory`,
 * `semanticHitsVisibleTo`, `AiMemoryService`, `AgentController`,
 * `ProactiveSuggestionService`, `TemporalFlowService`, `TemporalFlowMemoryService`,
 * `KeyCortexContextV2Service`, `KeyCortexLearningService`,
 * `KeyCortexAwarenessService`, `KeyCortexSalienceService`,
 * `KeyCortexReflectionService`, `KeyCortexCreativityService` — shares one rule.
 *
 * Feature flag (`MEMORY_CLASS_READ=OFF|SHADOW|ACTIVE`, after #124's
 * `CONTEXT_GENOME_READ` pattern):
 *   - `OFF`: legacy behavior unchanged.
 *   - `SHADOW`: evaluates BOTH legacy and unified projection, emits a structured
 *     diff log containing ONLY counts/IDs/classes/scopes/reasons (ZERO memory
 *     text or PII), and returns legacy behavior.
 *   - `ACTIVE` (default, fail-closed per D-234): enforces unified projection +
 *     fail-closed word-heuristic backstop.
 */
import type { Logger } from '@nestjs/common';
import type { CanonicalModule } from '../../core/authority/module-vocabulary';
import {
  classifyAiMemoryWrite,
  classifyEmbeddingWrite,
  classifyTemporalMemoryWrite,
  isMemoryRowDataClass,
  moreRestrictiveDataClass,
  mostRestrictiveDataClass,
  normalizeModuleScope,
  unionModuleScopes,
  type MemoryClassification,
  type MemoryRowDataClass,
  type TemporalEventProvenance,
} from '../ai/memory-classification';
import {
  isMoneyLabel,
  proposalTextStatesMoney,
} from '../business-genome/key-genome/genome-finance-scope';
import {
  MEMORY_CLASS_METADATA_KEY,
  type MemoryReaderContext,
} from './unified-memory.types';

export { MEMORY_CLASS_METADATA_KEY };
export type { MemoryReaderContext };

/** Rollout mode for `MEMORY_CLASS_READ`. */
export type MemoryClassReadMode = 'OFF' | 'SHADOW' | 'ACTIVE';

/**
 * Parses `MEMORY_CLASS_READ=OFF|SHADOW|ACTIVE`.
 * Unset, empty, or unrecognized values fail closed to `'ACTIVE'` (D-234).
 */
export function getMemoryClassReadMode(
  env: NodeJS.ProcessEnv = process.env,
): MemoryClassReadMode {
  const raw = env.MEMORY_CLASS_READ?.trim().toUpperCase();
  if (raw === 'OFF') return 'OFF';
  if (raw === 'SHADOW') return 'SHADOW';
  return 'ACTIVE';
}

/**
 * All business-domain modules required for opaque/unclassified temporal or
 * event records (matches `EVENT_MODULES` in `key-cortex-prompt-context.service.ts`).
 */
export const ALL_EVENT_DOMAIN_MODULES: readonly CanonicalModule[] = [
  'revenue',
  'expenses',
  'crm',
  'bookings',
  'projects',
  'operations',
  'storefront',
  'content',
  'automations',
  'team',
];

/** Expense vocabulary matching `semantic-memory-sight.ts` and `memory-classification.ts` (D-146). */
const EXPENSE_BACKSTOP_WORDS =
  /(?<![a-z])(expenses?|expenditures?|bills?|receipts?|budgets?|vendors?|suppliers?|rent|payroll|salar(?:y|ies)|wages?|utilit(?:y|ies)|overheads?|outgoings?|spend(?:s|ing)?|spent|costs?|payables?|purchases?|purchased|procure(?:ment|d)?|reimburs\w*|leases?|landlords?|insurance|premiums?|electricity|fuel|cogs)(?![a-z])/i;

/** Fail-closed word-heuristic backstop for money/revenue terms and amounts. */
export function backstopTextStatesMoney(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value !== '' &&
    (isMoneyLabel(value) || proposalTextStatesMoney(value))
  );
}

/** Fail-closed word-heuristic backstop for expense terms (D-146). */
export function backstopTextStatesExpense(value: unknown): boolean {
  if (typeof value !== 'string' || value === '') return false;
  return (
    EXPENSE_BACKSTOP_WORDS.test(value) ||
    EXPENSE_BACKSTOP_WORDS.test(value.replace(/([a-z0-9])([A-Z])/g, '$1 $2'))
  );
}

/** Input to the single authoritative reader projection predicate. */
export interface MemoryAccessInput {
  dataClass: MemoryRowDataClass;
  moduleScope: readonly CanonicalModule[];
  /** Owning member userId on stores that record one (`CognitionMemory`, `KeyCortexMemory`, episodic logs). */
  ownerUserId?: string | null;
  /** True when the underlying store has a per-member owner column. */
  hasOwnerColumn?: boolean;
  /** Free-text/label fields checked by the fail-closed word-heuristic backstop even for `GENERAL` rows. */
  backstopTexts?: ReadonlyArray<string | null | undefined>;
  /** True for `document_extraction` rows whose rule is `revenue:read` (MEM-DOC-EXTRACTION-SIGHT). */
  skipExpenseBackstop?: boolean;
  /** True when an `UNCLASSIFIED` row (e.g. opaque TemporalFlowMemory) requires every event domain module. */
  unclassifiedRequiresAllModules?: boolean;
}

/** Result of evaluating a single memory item against a reader context. */
export interface MemoryAccessDecision {
  allowed: boolean;
  reason: string;
  effectiveDataClass: MemoryRowDataClass;
  effectiveModuleScope: CanonicalModule[];
}

/**
 * Single authoritative reader projection predicate for all KEY memory stores.
 *
 * Rules:
 *   1. `SECRET_BEARING` is ALWAYS withheld — even from OWNER and `revenue:read`.
 *   2. Every module in `moduleScope` must be readable by `ctx.sight(mod)` at read
 *      level; `revenue`/`expenses` also require an authenticated member reader.
 *   3. `REVENUE` requires an authenticated member reader with `revenue:read`.
 *   4. `PERSONAL` requires `ctx.reader === ownerUserId` on stores with an owner
 *      column (`CognitionMemory`, `KeyCortexMemory`, episodic logs), and an
 *      authenticated member reader on stores without one (`AiMemory`).
 *   5. `UNCLASSIFIED` fails closed (D-234): withheld from memberless turns and
 *      any reader lacking `revenue:read` + `expenses:read` (and all domain
 *      modules when `unclassifiedRequiresAllModules` is true).
 *   6. Fail-closed word-heuristic backstop stays active even on `GENERAL` rows
 *      so mistagged financial or expense content never leaks.
 */
export function evaluateMemoryClassAccess(
  input: MemoryAccessInput,
  ctx: MemoryReaderContext,
): MemoryAccessDecision {
  const effectiveDataClass = input.dataClass;
  const effectiveModuleScope = normalizeModuleScope(input.moduleScope);

  // 1. SECRET_BEARING: NEVER served into prompts or memory reads for ANY reader.
  if (effectiveDataClass === 'SECRET_BEARING') {
    return {
      allowed: false,
      reason: 'secret_bearing',
      effectiveDataClass,
      effectiveModuleScope,
    };
  }

  const hasMember = ctx.sightOnly === true ? true : ctx.reader !== null;

  // 2. module_scope: EVERY listed module must be readable at read level.
  for (const mod of effectiveModuleScope) {
    if (!ctx.sight(mod)) {
      return {
        allowed: false,
        reason: `missing_module:${mod}`,
        effectiveDataClass,
        effectiveModuleScope,
      };
    }
    if ((mod === 'revenue' || mod === 'expenses') && !hasMember) {
      return {
        allowed: false,
        reason: `memberless_${mod}`,
        effectiveDataClass,
        effectiveModuleScope,
      };
    }
  }

  // 3. REVENUE: requires authenticated member with revenue:read.
  if (effectiveDataClass === 'REVENUE') {
    if (!hasMember || !ctx.sight('revenue')) {
      return {
        allowed: false,
        reason: 'revenue_denied',
        effectiveDataClass,
        effectiveModuleScope,
      };
    }
  }

  // 4. PERSONAL: requires owning member on member-owned stores; member reader otherwise.
  if (effectiveDataClass === 'PERSONAL') {
    if (input.hasOwnerColumn) {
      if (!ctx.reader || !input.ownerUserId || ctx.reader !== input.ownerUserId) {
        return {
          allowed: false,
          reason: 'personal_owner_mismatch',
          effectiveDataClass,
          effectiveModuleScope,
        };
      }
    } else if (!hasMember) {
      return {
        allowed: false,
        reason: 'personal_memberless',
        effectiveDataClass,
        effectiveModuleScope,
      };
    }
  }

  // 5. UNCLASSIFIED: fails closed for restricted and memberless readers (D-234).
  if (effectiveDataClass === 'UNCLASSIFIED') {
    if (!hasMember) {
      return {
        allowed: false,
        reason: 'unclassified_memberless',
        effectiveDataClass,
        effectiveModuleScope,
      };
    }
    if (!ctx.sight('revenue') || !ctx.sight('expenses')) {
      return {
        allowed: false,
        reason: 'unclassified_fail_closed',
        effectiveDataClass,
        effectiveModuleScope,
      };
    }
    if (
      input.unclassifiedRequiresAllModules &&
      !ALL_EVENT_DOMAIN_MODULES.every((m) => ctx.sight(m))
    ) {
      return {
        allowed: false,
        reason: 'unclassified_all_modules',
        effectiveDataClass,
        effectiveModuleScope,
      };
    }
  }

  // 6. Fail-closed word-heuristic backstop (active even for GENERAL-tagged rows).
  const texts = input.backstopTexts ?? [];
  if (texts.some((t) => backstopTextStatesMoney(t))) {
    if (!hasMember || !ctx.sight('revenue')) {
      return {
        allowed: false,
        reason: 'backstop_money',
        effectiveDataClass,
        effectiveModuleScope,
      };
    }
  }
  if (!input.skipExpenseBackstop && texts.some((t) => backstopTextStatesExpense(t))) {
    if (!hasMember || !ctx.sight('expenses')) {
      return {
        allowed: false,
        reason: 'backstop_expense',
        effectiveDataClass,
        effectiveModuleScope,
      };
    }
  }

  return {
    allowed: true,
    reason: 'allowed',
    effectiveDataClass,
    effectiveModuleScope,
  };
}

/** Structured entry emitted in `MEMORY_CLASS_READ=SHADOW` diff logs (NEVER includes text/PII). */
export interface MemoryClassShadowDiffEntry {
  id: string;
  store: string;
  dataClass: MemoryRowDataClass;
  moduleScope: readonly string[];
  legacyAllowed: boolean;
  projectedAllowed: boolean;
  reason: string;
}

const MAX_SHADOW_DIFF_SAMPLE = 20;

/**
 * Logs structured SHADOW diff metrics without ANY memory text or PII.
 * Emits ONLY counts, IDs, store names, canonical classes, module scopes, and reasons.
 */
export function logMemoryClassShadowDiff(
  logger: Pick<Logger, 'log' | 'warn'> | undefined,
  params: {
    path: string;
    businessId: string;
    readerPresent: boolean;
    totalCandidates: number;
    legacyCount: number;
    projectedCount: number;
    diffs: readonly MemoryClassShadowDiffEntry[];
  },
): void {
  if (!logger || params.diffs.length === 0) return;
  const payload = {
    event: 'memory_class_read_shadow_diff',
    path: params.path,
    businessId: params.businessId,
    readerPresent: params.readerPresent,
    totalCandidates: params.totalCandidates,
    legacyCount: params.legacyCount,
    projectedCount: params.projectedCount,
    diffCount: params.diffs.length,
    sample: params.diffs.slice(0, MAX_SHADOW_DIFF_SAMPLE),
  };
  const line = `[MEMORY_CLASS_READ][SHADOW] ${JSON.stringify(payload)}`;
  if (typeof logger.warn === 'function') {
    logger.warn(line);
  } else {
    logger.log(line);
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   STORE-SPECIFIC READ-TIME CLASSIFICATION (PERSISTED + LEGACY NULL ROWS)
   ═══════════════════════════════════════════════════════════════════════ */

export interface AiMemoryReadRow {
  id?: string;
  category: string;
  key: string;
  value?: string | null;
  source?: string | null;
  dataClass?: string | null;
  moduleScope?: readonly string[] | null;
}

/**
 * Resolves effective `(dataClass, moduleScope)` for an `AiMemory` row at read time:
 * - Persisted `data_class` / `module_scope` are honored directly (and structural
 *   hard invariants for `settings/ai_preferences` and `document_extraction` can
 *   never be weakened).
 * - Legacy rows with `data_class IS NULL` are classified via P125's exact
 *   `classifyAiMemoryWrite` structural provenance classifier so ordinary legacy
 *   memory (`tone`, `goals`, `priorities`, `corrections`, `fact`) stays visible
 *   while financial or ambiguous legacy rows fail closed (D-234).
 */
export function classifyAiMemoryForRead(row: AiMemoryReadRow): MemoryClassification {
  const persistedClass = isMemoryRowDataClass(row.dataClass) ? row.dataClass : null;
  const persistedScope = normalizeModuleScope(row.moduleScope ?? []);

  if (persistedClass !== null) {
    // Structural safety invariants that can never be downgraded even by a stale/mistagged column
    if (row.category === 'settings' && row.key === 'ai_preferences') {
      return {
        dataClass: 'SECRET_BEARING',
        moduleScope: unionModuleScopes(persistedScope, ['ai', 'settings']),
      };
    }
    if (row.category === 'document_extraction') {
      return {
        dataClass: moreRestrictiveDataClass(persistedClass, 'REVENUE'),
        moduleScope: unionModuleScopes(persistedScope, ['revenue']),
      };
    }
    return {
      dataClass: persistedClass,
      moduleScope: persistedScope,
    };
  }

  // Legacy data_class IS NULL: run the exact same structural provenance classifier as P125/backfill
  const derived = classifyAiMemoryWrite({
    category: row.category,
    key: row.key,
    value: row.value ?? null,
    source: row.source ?? null,
    explicitModuleScope: persistedScope.length > 0 ? persistedScope : null,
  });
  return derived;
}

export interface TemporalMemoryReadRow {
  id?: string;
  entityType: string;
  entityId?: string | null;
  type?: string | null;
  sourceModule?: string | null;
  sourceEventIds?: readonly string[] | null;
  metadata?: unknown;
  content?: string | null;
  dataClass?: string | null;
  moduleScope?: readonly string[] | null;
}

/**
 * Resolves effective `(dataClass, moduleScope)` for a `TemporalFlowMemory` row at read time:
 * - Persisted `data_class` / `module_scope` are honored directly.
 * - Legacy rows with `data_class IS NULL` are classified via P125's exact
 *   `classifyTemporalMemoryWrite` using any resolved `sourceEvents` (and failing
 *   closed to `UNCLASSIFIED` when provenance is incomplete or missing).
 */
export function classifyTemporalMemoryForRead(
  row: TemporalMemoryReadRow,
  events?: ReadonlyMap<string, TemporalEventProvenance>,
): MemoryClassification {
  const persistedClass = isMemoryRowDataClass(row.dataClass) ? row.dataClass : null;
  const persistedScope = normalizeModuleScope(row.moduleScope ?? []);

  if (persistedClass !== null) {
    return {
      dataClass: persistedClass,
      moduleScope: persistedScope,
    };
  }

  const eventIds = row.sourceEventIds ?? [];
  const isOpaque = row.entityType === 'business' || row.sourceModule === 'key_cortex';
  const sourceEvents: TemporalEventProvenance[] = [];
  let hasMissingSourceEvents = false;

  if (!isOpaque && eventIds.length > 0) {
    if (!events) {
      hasMissingSourceEvents = true;
    } else {
      for (const id of eventIds) {
        const ev = events.get(id);
        if (ev) sourceEvents.push(ev);
        else hasMissingSourceEvents = true;
      }
    }
  }

  // Match semantic-memory-sight.ts: incomplete eventCount provenance fails closed
  const meta =
    row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};
  const counted = meta.eventCount;
  if (
    counted !== undefined &&
    counted !== null &&
    !(typeof counted === 'number' && counted <= eventIds.length)
  ) {
    hasMissingSourceEvents = true;
  }

  return classifyTemporalMemoryWrite({
    entityType: row.entityType,
    entityId: row.entityId ?? null,
    type: row.type ?? null,
    sourceModule: row.sourceModule ?? null,
    content: row.content ?? null,
    sourceEvents,
    sourceEventIds: eventIds,
    hasMissingSourceEvents,
    explicitModuleScope: persistedScope.length > 0 ? persistedScope : null,
  });
}

export interface EmbeddingReadRow {
  id?: string;
  sourceType: string;
  sourceId?: string;
  content?: string | null;
  metadata?: Record<string, unknown> | null;
  dataClass?: string | null;
  moduleScope?: readonly string[] | null;
}

/**
 * Resolves effective `(dataClass, moduleScope)` for an `AiMemoryEmbedding` hit:
 * inherits the MOST RESTRICTIVE `data_class` and UNION of `module_scope` across
 * the embedding row itself, its live source row (`sourceClassification`), and
 * read-time structural classification when `data_class IS NULL`.
 */
export function classifyEmbeddingForRead(
  hit: EmbeddingReadRow,
  sourceClassification?: MemoryClassification | null,
): MemoryClassification {
  const embClass = isMemoryRowDataClass(hit.dataClass) ? hit.dataClass : null;
  const embScope = normalizeModuleScope(hit.moduleScope ?? []);

  if (embClass !== null && sourceClassification) {
    return {
      dataClass: mostRestrictiveDataClass([embClass, sourceClassification.dataClass]),
      moduleScope: unionModuleScopes(embScope, sourceClassification.moduleScope),
    };
  }

  const derived = classifyEmbeddingWrite({
    sourceType: hit.sourceType,
    content: hit.content ?? null,
    metadata: hit.metadata ?? null,
    sourceDataClass: sourceClassification?.dataClass ?? null,
    sourceModuleScope: sourceClassification?.moduleScope ?? null,
    explicitDataClass: embClass,
    explicitModuleScope: embScope.length > 0 ? embScope : null,
  });

  if (embClass !== null) {
    return {
      dataClass: mostRestrictiveDataClass([embClass, derived.dataClass]),
      moduleScope: unionModuleScopes(embScope, derived.moduleScope),
    };
  }
  return derived;
}

export interface KeyCortexMemoryReadRow {
  id?: string;
  key?: string;
  type?: string | null;
  userId?: string | null;
  value?: string | null;
  dataClass?: string | null;
  moduleScope?: readonly string[] | null;
}

/**
 * Resolves effective classification & ownership for a `KeyCortexMemory` row.
 * Rows recording a `userId` are `PERSONAL` (owned by `userId`); business-wide
 * revenue/reflection/integration kinds require `REVENUE`; unknown rows apply
 * the fail-closed word-heuristic backstop.
 */
export function classifyKeyCortexMemoryForRead(
  row: KeyCortexMemoryReadRow,
  opts: { revenueOnlyTypes?: ReadonlySet<string> } = {},
): MemoryAccessInput {
  const persistedClass = isMemoryRowDataClass(row.dataClass) ? row.dataClass : null;
  const persistedScope = normalizeModuleScope(row.moduleScope ?? []);
  const classes: Array<MemoryRowDataClass | null> = [persistedClass];
  const scopes = new Set<CanonicalModule>(persistedScope);

  if (row.userId) {
    classes.push('PERSONAL');
  }
  if (row.type && opts.revenueOnlyTypes?.has(row.type)) {
    classes.push('REVENUE');
    scopes.add('revenue');
  }
  const dataClass = mostRestrictiveDataClass(classes, 'GENERAL');

  return {
    dataClass,
    moduleScope: [...scopes].sort(),
    hasOwnerColumn: Boolean(row.userId),
    ownerUserId: row.userId ?? null,
    backstopTexts: [row.value],
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   DB-LEVEL PRE-FILTER FOR DIFFERENTIAL INVARIANCE (DESIGN 6.1)
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Builds a Prisma `where` clause fragment for stores carrying `dataClass`
 * (`AiMemory`, `TemporalFlowMemory`) so rows structurally denied by `dataClass`
 * (`SECRET_BEARING`, `REVENUE`, `UNCLASSIFIED`, memberless `PERSONAL`) NEVER
 * consume `take` slots or affect rank/counts.
 *
 * Legacy `dataClass: null` rows remain eligible for the query and are projected
 * in-memory before ranking/counting via read-time structural classification.
 * Note: `module_scope` is nullable `TEXT[]` with no default in Postgres
 * (`20261126000000_memory_class_columns`), so `NOT (module_scope && ...)` would
 * evaluate to SQL `NULL` and drop legacy rows with `module_scope IS NULL`;
 * `module_scope` is therefore enforced in-memory by `evaluateMemoryClassAccess`
 * before ranking and before any count.
 */
export function buildDbMemoryClassPreFilter(
  ctx: MemoryReaderContext,
): Record<string, unknown> {
  const hasMember = ctx.sightOnly === true ? true : ctx.reader !== null;
  const deniedClasses: MemoryRowDataClass[] = ['SECRET_BEARING'];
  if (!hasMember || !ctx.sight('revenue')) {
    deniedClasses.push('REVENUE');
  }
  if (!hasMember || !ctx.sight('revenue') || !ctx.sight('expenses')) {
    deniedClasses.push('UNCLASSIFIED');
  }
  if (!hasMember) {
    deniedClasses.push('PERSONAL');
  }

  return {
    OR: [{ dataClass: null }, { dataClass: { notIn: deniedClasses } }],
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   COLLECTION PROJECTION HELPERS WITH OFF | SHADOW | ACTIVE SUPPORT
   ═══════════════════════════════════════════════════════════════════════ */

export interface RowProjectionOptions<T> {
  businessId?: string;
  path?: string;
  logger?: Pick<Logger, 'log' | 'warn'>;
  legacyFilter?: (row: T) => boolean;
}

/** Projects `AiMemory` rows for `ctx` respecting `MEMORY_CLASS_READ=OFF|SHADOW|ACTIVE`. */
export function projectAiMemoryRowsForReader<T extends AiMemoryReadRow>(
  rows: readonly T[],
  ctx: MemoryReaderContext,
  opts: RowProjectionOptions<T> = {},
): T[] {
  const mode = getMemoryClassReadMode();
  const legacyPredicate = opts.legacyFilter ?? (() => true);

  if (mode === 'OFF') {
    return rows.filter(legacyPredicate);
  }

  const evaluate = (row: T): MemoryAccessDecision => {
    const classified = classifyAiMemoryForRead(row);
    const isDocExtraction = row.category === 'document_extraction';
    return evaluateMemoryClassAccess(
      {
        dataClass: classified.dataClass,
        moduleScope: classified.moduleScope,
        hasOwnerColumn: false,
        backstopTexts: [row.category, row.key, row.value],
        skipExpenseBackstop: isDocExtraction,
      },
      ctx,
    );
  };

  if (mode === 'SHADOW') {
    const legacyOut: T[] = [];
    let projectedCount = 0;
    const diffs: MemoryClassShadowDiffEntry[] = [];

    for (const row of rows) {
      const legacyAllowed = legacyPredicate(row);
      const decision = evaluate(row);
      if (legacyAllowed) legacyOut.push(row);
      if (decision.allowed) projectedCount += 1;
      if (legacyAllowed !== decision.allowed) {
        diffs.push({
          id: row.id ?? `${row.category}:${row.key}`,
          store: 'ai_memory',
          dataClass: decision.effectiveDataClass,
          moduleScope: decision.effectiveModuleScope,
          legacyAllowed,
          projectedAllowed: decision.allowed,
          reason: decision.reason,
        });
      }
    }

    logMemoryClassShadowDiff(opts.logger, {
      path: opts.path ?? 'ai_memory',
      businessId: opts.businessId ?? 'unknown',
      readerPresent: ctx.reader !== null,
      totalCandidates: rows.length,
      legacyCount: legacyOut.length,
      projectedCount,
      diffs,
    });
    return legacyOut;
  }

  return rows.filter((row) => evaluate(row).allowed);
}

/** Projects `TemporalFlowMemory` rows for `ctx` respecting `MEMORY_CLASS_READ=OFF|SHADOW|ACTIVE`. */
export function projectTemporalMemoryRowsForReader<T extends TemporalMemoryReadRow>(
  rows: readonly T[],
  ctx: MemoryReaderContext,
  opts: RowProjectionOptions<T> & {
    events?: ReadonlyMap<string, TemporalEventProvenance>;
  } = {},
): T[] {
  const mode = getMemoryClassReadMode();
  const legacyPredicate = opts.legacyFilter ?? (() => true);

  if (mode === 'OFF') {
    return rows.filter(legacyPredicate);
  }

  const evaluate = (row: T): MemoryAccessDecision => {
    const classified = classifyTemporalMemoryForRead(row, opts.events);
    return evaluateMemoryClassAccess(
      {
        dataClass: classified.dataClass,
        moduleScope: classified.moduleScope,
        hasOwnerColumn: false,
        backstopTexts: [row.entityType, row.type, row.sourceModule, row.content],
        unclassifiedRequiresAllModules: true,
      },
      ctx,
    );
  };

  if (mode === 'SHADOW') {
    const legacyOut: T[] = [];
    let projectedCount = 0;
    const diffs: MemoryClassShadowDiffEntry[] = [];

    for (const row of rows) {
      const legacyAllowed = legacyPredicate(row);
      const decision = evaluate(row);
      if (legacyAllowed) legacyOut.push(row);
      if (decision.allowed) projectedCount += 1;
      if (legacyAllowed !== decision.allowed) {
        diffs.push({
          id: row.id ?? `${row.entityType}:${row.type ?? 'memory'}`,
          store: 'temporal_flow_memory',
          dataClass: decision.effectiveDataClass,
          moduleScope: decision.effectiveModuleScope,
          legacyAllowed,
          projectedAllowed: decision.allowed,
          reason: decision.reason,
        });
      }
    }

    logMemoryClassShadowDiff(opts.logger, {
      path: opts.path ?? 'temporal_flow_memory',
      businessId: opts.businessId ?? 'unknown',
      readerPresent: ctx.reader !== null,
      totalCandidates: rows.length,
      legacyCount: legacyOut.length,
      projectedCount,
      diffs,
    });
    return legacyOut;
  }

  return rows.filter((row) => evaluate(row).allowed);
}

/** Projects `KeyCortexMemory` rows for `ctx` respecting `MEMORY_CLASS_READ=OFF|SHADOW|ACTIVE`. */
export function projectKeyCortexMemoryRowsForReader<T extends KeyCortexMemoryReadRow>(
  rows: readonly T[],
  ctx: MemoryReaderContext,
  opts: RowProjectionOptions<T> & {
    revenueOnlyTypes?: ReadonlySet<string>;
    backstopTextsOf?: (row: T) => ReadonlyArray<string | null | undefined>;
  } = {},
): T[] {
  const mode = getMemoryClassReadMode();
  const legacyPredicate = opts.legacyFilter ?? (() => true);

  if (mode === 'OFF') {
    return rows.filter(legacyPredicate);
  }

  const evaluate = (row: T): MemoryAccessDecision => {
    const base = classifyKeyCortexMemoryForRead(row, {
      revenueOnlyTypes: opts.revenueOnlyTypes,
    });
    return evaluateMemoryClassAccess(
      {
        ...base,
        backstopTexts: opts.backstopTextsOf ? opts.backstopTextsOf(row) : base.backstopTexts,
      },
      ctx,
    );
  };

  if (mode === 'SHADOW') {
    const legacyOut: T[] = [];
    let projectedCount = 0;
    const diffs: MemoryClassShadowDiffEntry[] = [];

    for (const row of rows) {
      const legacyAllowed = legacyPredicate(row);
      const decision = evaluate(row);
      if (legacyAllowed) legacyOut.push(row);
      if (decision.allowed) projectedCount += 1;
      if (legacyAllowed !== decision.allowed) {
        diffs.push({
          id: row.id ?? row.key ?? 'unknown',
          store: 'key_cortex_memory',
          dataClass: decision.effectiveDataClass,
          moduleScope: decision.effectiveModuleScope,
          legacyAllowed,
          projectedAllowed: decision.allowed,
          reason: decision.reason,
        });
      }
    }

    logMemoryClassShadowDiff(opts.logger, {
      path: opts.path ?? 'key_cortex_memory',
      businessId: opts.businessId ?? 'unknown',
      readerPresent: ctx.reader !== null,
      totalCandidates: rows.length,
      legacyCount: legacyOut.length,
      projectedCount,
      diffs,
    });
    return legacyOut;
  }

  return rows.filter((row) => evaluate(row).allowed);
}
