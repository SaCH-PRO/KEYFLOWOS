/**
 * MEM-CLASS-READ (P137; D-100, D-128, D-226, D-227, D-233, D-234, D-238, D-257):
 * Single authoritative reader projection deciding EVERY memory read across KEY
 * stores by `data_class`, `module_scope`, `PERSONAL` ownership, read-time
 * classification of legacy `data_class IS NULL` rows, and a fail-closed
 * word-heuristic + secret-pattern backstop.
 *
 * Pure leaf module (zero NestJS/Prisma/service circular dependencies) shared by:
 *   - `UnifiedMemoryRetrievalService`
 *   - `KeyCortexPromptContextService` (`readersOwnPromptMemory`)
 *   - `semantic-memory-sight.ts` (`aiMemoryRowVisibleTo`, `semanticHitsVisibleTo`)
 *   - `AiMemoryService`, `AgentController`, `ProactiveSuggestionService`,
 *     `RoleEngineService`, `AiExecutionLogService`
 *   - `TemporalFlowService`, `TemporalFlowMemoryService`
 *   - `KeyCortexContextV2Service`, `KeyCortexLearningService`,
 *     `KeyCortexAwarenessService`, `KeyCortexSalienceService`,
 *     `KeyCortexReflectionService`, `KeyCortexCreativityService`,
 *     `KeyCortexImmuneService`, `KeyCortexActionsService`,
 *     `KeyCortexEventService`, `KeyCortexEthicsService`,
 *     `KeyCortexMetacognitionService`, `BusinessEventService`
 *
 * Feature flag (`MEMORY_CLASS_READ=OFF|SHADOW|ACTIVE`, after #124's
 * `CONTEXT_GENOME_READ` pattern):
 *   - `OFF`: legacy behavior unchanged.
 *   - `SHADOW`: crash-isolated; evaluates BOTH legacy and unified projection,
 *     emits a structured diff log containing ONLY counts/IDs/classes/scopes/
 *     reasons (ZERO memory text, keys, or PII), and returns legacy behavior.
 *   - `ACTIVE` (default, fail-closed per D-234): enforces unified projection +
 *     fail-closed word-heuristic & secret-pattern backstop.
 */
import type { Logger } from '@nestjs/common';
import {
  isCanonicalModule,
  type CanonicalModule,
} from '../../core/authority/module-vocabulary';
import {
  classifyAiMemoryWrite,
  classifyEmbeddingWrite,
  classifyTemporalMemoryWrite,
  isMemoryRowDataClass,
  modulesFromIdentifiers,
  moreRestrictiveDataClass,
  mostRestrictiveDataClass,
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

/**
 * Fail-closed secret-pattern backstop (R1): catches leaked provider API keys,
 * PEM private keys, Bearer tokens, credential assignments, and encrypted
 * ciphertext envelopes even if a row was mislabeled `GENERAL`.
 */
const SECRET_BACKSTOP_PATTERNS: readonly RegExp[] = [
  // Provider API keys (OpenAI, Stripe, GitHub, Google, Slack, AWS)
  /\b(?:sk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{16,}|(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{28,}|xox[baprs]-[0-9A-Za-z-]{10,}|AKIA[0-9A-Z]{16})\b/,
  // PEM private key blocks
  /-----BEGIN\s+[A-Z0-9 ]*PRIVATE KEY-----/,
  // Bearer credentials
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/i,
  // Explicit credential/secret assignments (requires key=value or key: value with >= 6-char value)
  /\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|private[_-]?key|webhook[_-]?secret|signing[_-]?secret|secret[_-]?key|passwd|password)\s*[:=]\s*["']?[^\s"',;}{]{6,}/i,
  // Encrypted ciphertext envelopes (KEYFLOWOS `enc:v1:...` or AES-GCM `iv:authTag:ciphertext` hex tuples)
  /\b(?:enc:v\d+:[A-Za-z0-9+/=._:-]{12,}|[0-9a-f]{24,}:[0-9a-f]{24,}:[0-9a-f]{16,})\b/i,
];

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

/** Fail-closed secret-pattern backstop (withheld from EVERY reader including OWNER). */
export function backstopTextStatesSecret(value: unknown): boolean {
  if (typeof value !== 'string' || value === '') return false;
  return SECRET_BACKSTOP_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * True when a row MUST be unconditionally withheld regardless of reader role
 * (persisted `SECRET_BEARING` or secret-pattern backstop match).
 */
export function isRowUnconditionallySecret(
  dataClass: unknown,
  backstopTexts: ReadonlyArray<string | null | undefined>,
): boolean {
  if (dataClass === 'SECRET_BEARING') return true;
  return backstopTexts.some((t) => backstopTextStatesSecret(t));
}

/**
 * Filters out unconditionally secret rows (`dataClass === 'SECRET_BEARING'` or
 * secret-pattern text) even on read paths invoked without a `readerContext`.
 */
export function filterOutSecretRows<T>(
  rows: readonly T[],
  extract: (row: T) => { dataClass?: unknown; texts: ReadonlyArray<string | null | undefined> },
): T[] {
  if (getMemoryClassReadMode() === 'OFF') return [...rows];
  return rows.filter((row) => {
    const { dataClass, texts } = extract(row);
    return !isRowUnconditionallySecret(dataClass, texts);
  });
}

/**
 * Validates raw persisted `module_scope` BEFORE normalization (fail-closed R1):
 * - `null` / `undefined` -> valid, empty scope `[]`.
 * - Non-array -> invalid (fail closed).
 * - Any element that is not a non-empty string or does not map to a canonical
 *   module via `normalizeModule` -> invalid (fail closed; NEVER silently drop!).
 */
export function validateRawModuleScope(raw: unknown): {
  valid: boolean;
  modules: CanonicalModule[];
} {
  if (raw === null || raw === undefined) {
    return { valid: true, modules: [] };
  }
  if (!Array.isArray(raw)) {
    return { valid: false, modules: [] };
  }
  const set = new Set<CanonicalModule>();
  for (const item of raw) {
    if (typeof item !== 'string' || item.trim() === '') {
      return { valid: false, modules: [] };
    }
    const lower = item.trim().toLowerCase();
    if (!isCanonicalModule(lower)) {
      return { valid: false, modules: [] };
    }
    set.add(lower);
  }
  return { valid: true, modules: [...set].sort() };
}

/**
 * Parses a raw persisted `data_class` column (fail-closed R1):
 * - `null` / `undefined` -> `{ present: false, valid: true, value: null }` (legacy row).
 * - Recognized `MemoryRowDataClass` -> `{ present: true, valid: true, value }`.
 * - Any other non-null value -> `{ present: true, valid: false, value: null }` (fail closed;
 *   NEVER coerced to `null` / `GENERAL`).
 */
export function parsePersistedDataClass(raw: unknown): {
  present: boolean;
  valid: boolean;
  value: MemoryRowDataClass | null;
} {
  if (raw === null || raw === undefined) {
    return { present: false, valid: true, value: null };
  }
  if (isMemoryRowDataClass(raw)) {
    return { present: true, valid: true, value: raw };
  }
  return { present: true, valid: false, value: null };
}

/** Classification result returned by read-time classifiers (carries fail-closed invalidity flags). */
export interface ReadMemoryClassification extends MemoryClassification {
  invalidDataClass?: boolean;
  invalidModuleScope?: boolean;
}

/** Input to the single authoritative reader projection predicate. */
export interface MemoryAccessInput {
  dataClass: MemoryRowDataClass | string;
  moduleScope: readonly (CanonicalModule | string)[] | unknown;
  /** True when a non-null persisted `data_class` failed enum validation. */
  invalidDataClass?: boolean;
  /** True when a non-null persisted `module_scope` contained non-canonical/invalid entries. */
  invalidModuleScope?: boolean;
  /** Owning member userId on stores that record one (`CognitionMemory`, `KeyCortexMemory`, episodic logs). */
  ownerUserId?: string | null;
  /** True when the underlying store has a per-member owner column. */
  hasOwnerColumn?: boolean;
  /** Free-text/label fields checked by the fail-closed word-heuristic & secret-pattern backstop even for `GENERAL` rows. */
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
 *   1. `SECRET_BEARING` and secret-pattern backstop matches are ALWAYS withheld
 *      — even from OWNER and `revenue:read`.
 *   2. Unrecognized non-null `data_class` or invalid/unknown `module_scope`
 *      values ALWAYS fail closed (`invalid_data_class` / `invalid_module_scope`).
 *   3. Every module in `moduleScope` must be readable by `ctx.sight(mod)` at
 *      read level; `revenue`/`expenses` also require an authenticated member.
 *   4. `REVENUE` requires an authenticated member reader with `revenue:read`.
 *   5. `PERSONAL` requires `ctx.reader === ownerUserId` on stores with an owner
 *      column (`CognitionMemory`, `KeyCortexMemory`, episodic logs), and an
 *      authenticated member reader on stores without one (`AiMemory`).
 *   6. `UNCLASSIFIED` fails closed (D-234): withheld from memberless turns and
 *      any reader lacking `revenue:read` + `expenses:read` (and all domain
 *      modules when `unclassifiedRequiresAllModules` is true).
 *   7. Fail-closed word-heuristic backstop stays active even on `GENERAL` rows
 *      so mistagged financial or expense content never leaks.
 */
export function evaluateMemoryClassAccess(
  input: MemoryAccessInput,
  ctx: MemoryReaderContext,
): MemoryAccessDecision {
  const texts = input.backstopTexts ?? [];

  // 1a. SECRET_BEARING: NEVER served into prompts or memory reads for ANY reader.
  if (input.dataClass === 'SECRET_BEARING') {
    const scopeCheck = validateRawModuleScope(input.moduleScope);
    return {
      allowed: false,
      reason: 'secret_bearing',
      effectiveDataClass: 'SECRET_BEARING',
      effectiveModuleScope: scopeCheck.valid ? scopeCheck.modules : [],
    };
  }

  // 1b. Secret-pattern backstop: even a mislabeled GENERAL row carrying secrets is ALWAYS withheld.
  if (texts.some((t) => backstopTextStatesSecret(t))) {
    const scopeCheck = validateRawModuleScope(input.moduleScope);
    return {
      allowed: false,
      reason: 'backstop_secret',
      effectiveDataClass: 'SECRET_BEARING',
      effectiveModuleScope: scopeCheck.valid ? scopeCheck.modules : [],
    };
  }

  // 2a. Unrecognized/corrupted data_class fails closed unconditionally.
  if (input.invalidDataClass === true || !isMemoryRowDataClass(input.dataClass)) {
    return {
      allowed: false,
      reason: 'invalid_data_class',
      effectiveDataClass: 'UNCLASSIFIED',
      effectiveModuleScope: [],
    };
  }
  const effectiveDataClass: MemoryRowDataClass = input.dataClass;

  // 2b. Invalid/unknown module_scope fails closed unconditionally (NEVER drop unknown strings).
  const scopeCheck = validateRawModuleScope(input.moduleScope);
  if (input.invalidModuleScope === true || !scopeCheck.valid) {
    return {
      allowed: false,
      reason: 'invalid_module_scope',
      effectiveDataClass,
      effectiveModuleScope: [],
    };
  }
  const effectiveModuleScope = scopeCheck.modules;

  const hasMember = ctx.reader !== null;

  // 3. module_scope: EVERY listed module must be readable at read level.
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

  // 4. REVENUE: requires authenticated member with revenue:read.
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

  // 5. PERSONAL: requires owning member on member-owned stores; member reader otherwise.
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

  // 6. UNCLASSIFIED: fails closed for restricted and memberless readers (D-234).
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

  // 7. Fail-closed word-heuristic backstop (active even for GENERAL-tagged rows).
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

/**
 * Sight-only evaluation strictly for non-personal business aggregate surfaces
 * (such as `KeyCortexSalienceService.describeForPrompt` when invoked with a
 * boolean `readsRevenue` sight rather than a member userId).
 *
 * Unconditionally refuses `PERSONAL` and `SECRET_BEARING` items so a caller
 * without a member userId can NEVER access personal or secret records.
 */
export function evaluateSightOnlyAggregateAccess(
  input: MemoryAccessInput,
  sight: (module: CanonicalModule) => boolean,
): MemoryAccessDecision {
  if (input.dataClass === 'PERSONAL') {
    const scopeCheck = validateRawModuleScope(input.moduleScope);
    return {
      allowed: false,
      reason: 'personal_sight_only_denied',
      effectiveDataClass: 'PERSONAL',
      effectiveModuleScope: scopeCheck.valid ? scopeCheck.modules : [],
    };
  }
  return evaluateMemoryClassAccess(input, {
    reader: '__sight_only_aggregate__',
    sight,
  });
}

/** Structured entry emitted in `MEMORY_CLASS_READ=SHADOW` diff logs (NEVER includes text, keys, or PII). */
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
 * Logs structured SHADOW diff metrics without ANY memory text, keys, or PII.
 * Emits ONLY counts, IDs, store names, canonical classes, module scopes, and reasons.
 * Crash-isolated: logging errors NEVER propagate into live requests.
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
  try {
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
    } else if (typeof logger.log === 'function') {
      logger.log(line);
    }
  } catch {
    // SHADOW logging must never break a live request.
  }
}

/**
 * Crash-isolated SHADOW helper: runs both legacy and projected predicates,
 * logs sanitized diff metrics (id-only, zero keys/text/PII), and ALWAYS
 * returns the legacy output even if shadow evaluation throws.
 */
export function runCrashIsolatedShadow<T>(params: {
  rows: readonly T[];
  store: string;
  path: string;
  businessId: string;
  readerPresent: boolean;
  logger?: Pick<Logger, 'log' | 'warn'>;
  idOf: (row: T) => string | undefined | null;
  legacyFilter: (row: T) => boolean;
  evaluate: (row: T) => MemoryAccessDecision;
}): T[] {
  const legacyOut = params.rows.filter(params.legacyFilter);
  try {
    let projectedCount = 0;
    const diffs: MemoryClassShadowDiffEntry[] = [];

    for (const row of params.rows) {
      const legacyAllowed = params.legacyFilter(row);
      const decision = params.evaluate(row);
      if (decision.allowed) projectedCount += 1;
      if (legacyAllowed !== decision.allowed) {
        const rawId = params.idOf(row);
        diffs.push({
          id: typeof rawId === 'string' && rawId.length > 0 ? rawId : 'unknown',
          store: params.store,
          dataClass: decision.effectiveDataClass,
          moduleScope: decision.effectiveModuleScope,
          legacyAllowed,
          projectedAllowed: decision.allowed,
          reason: decision.reason,
        });
      }
    }

    logMemoryClassShadowDiff(params.logger, {
      path: params.path,
      businessId: params.businessId,
      readerPresent: params.readerPresent,
      totalCandidates: params.rows.length,
      legacyCount: legacyOut.length,
      projectedCount,
      diffs,
    });
  } catch {
    // Crash-isolated: shadow failure never impacts live requests.
  }
  return legacyOut;
}

/* ═══════════════════════════════════════════════════════════════════════
   BOUNDED BATCH PAGINATION FOR DIFFERENTIAL INVARIANCE (DESIGN 6.1)
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Paginates past withheld rows (`module_scope`-restricted, legacy `data_class IS NULL`,
 * or backstop-dropped rows) using bounded offset batches so fixed `take` limits NEVER
 * starve allowed rows for restricted readers.
 *
 * Deduplicates by `id` across pages so unit-test mocks that ignore `skip` exit
 * cleanly after one page without ever looping infinitely.
 */
export async function fetchProjectedBatch<T>(opts: {
  targetCount: number;
  batchSize?: number;
  maxScanRows?: number;
  idOf?: (row: T) => string | undefined;
  fetchPage: (skip: number, take: number) => Promise<T[]>;
  projectPage: (rows: T[]) => Promise<T[]> | T[];
}): Promise<T[]> {
  if (typeof opts.targetCount !== 'number' || Number.isNaN(opts.targetCount) || opts.targetCount <= 0) {
    return [];
  }
  const finiteTarget = Number.isFinite(opts.targetCount);
  const target = finiteTarget ? Math.floor(opts.targetCount) : Number.POSITIVE_INFINITY;
  if (target <= 0) return [];

  const batchSize =
    typeof opts.batchSize === 'number' && Number.isFinite(opts.batchSize) && opts.batchSize >= 1
      ? Math.floor(opts.batchSize)
      : finiteTarget
        ? Math.min(Math.max(target, 50), 500)
        : 100;
  const maxScanRows =
    typeof opts.maxScanRows === 'number' && Number.isFinite(opts.maxScanRows) && opts.maxScanRows >= 1
      ? Math.floor(opts.maxScanRows)
      : finiteTarget
        ? Math.max(target * 20, 2000)
        : 5000;
  const idOf = opts.idOf ?? ((r: T) => (r as { id?: string } | null)?.id);

  const accepted: T[] = [];
  const seenIds = new Set<string>();
  let skip = 0;

  while (skip < maxScanRows) {
    const pageTake = Math.min(batchSize, maxScanRows - skip);
    const page = await opts.fetchPage(skip, pageTake);
    if (!Array.isArray(page) || page.length === 0) break;

    const unseen: T[] = [];
    for (const row of page) {
      const id = idOf(row);
      if (typeof id === 'string' && id.length > 0) {
        if (seenIds.has(id)) continue;
        seenIds.add(id);
      }
      unseen.push(row);
    }

    if (unseen.length === 0) break;

    const kept = await opts.projectPage(unseen);
    for (const item of kept) {
      accepted.push(item);
      if (finiteTarget && accepted.length >= target) {
        return accepted.slice(0, target);
      }
    }

    skip += page.length;
    if (page.length < pageTake) break;
  }

  return finiteTarget ? accepted.slice(0, target) : accepted;
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
 * - Persisted `data_class` / `module_scope` are validated fail-closed (unrecognized
 *   non-null `data_class` or unknown `module_scope` entries fail closed!).
 * - Structural hard invariants for `settings/ai_preferences` and `document_extraction`
 *   can never be weakened.
 * - Legacy rows with `data_class IS NULL` are classified via P125's exact
 *   `classifyAiMemoryWrite` structural provenance classifier so ordinary legacy
 *   memory (`tone`, `goals`, `priorities`, `corrections`, `fact`) stays visible
 *   while financial or ambiguous legacy rows fail closed (D-234).
 */
export function classifyAiMemoryForRead(row: AiMemoryReadRow): ReadMemoryClassification {
  const parsedClass = parsePersistedDataClass(row.dataClass);
  const scopeCheck = validateRawModuleScope(row.moduleScope);

  // Structural hard invariant: settings/ai_preferences is ALWAYS SECRET_BEARING.
  if (row.category === 'settings' && row.key === 'ai_preferences') {
    return {
      dataClass: 'SECRET_BEARING',
      moduleScope: unionModuleScopes(scopeCheck.modules, ['ai', 'settings']),
      invalidDataClass: !parsedClass.valid,
      invalidModuleScope: !scopeCheck.valid,
    };
  }

  // Fail closed on corrupted/unrecognized non-null data_class or invalid module_scope.
  if (!parsedClass.valid || !scopeCheck.valid) {
    return {
      dataClass: parsedClass.value ?? 'UNCLASSIFIED',
      moduleScope: scopeCheck.modules,
      invalidDataClass: !parsedClass.valid,
      invalidModuleScope: !scopeCheck.valid,
    };
  }

  if (parsedClass.value !== null) {
    if (row.category === 'document_extraction') {
      return {
        dataClass: moreRestrictiveDataClass(parsedClass.value, 'REVENUE'),
        moduleScope: unionModuleScopes(scopeCheck.modules, ['revenue']),
      };
    }
    return {
      dataClass: parsedClass.value,
      moduleScope: scopeCheck.modules,
    };
  }

  // Legacy data_class IS NULL: run P125's exact structural provenance classifier.
  const derived = classifyAiMemoryWrite({
    category: row.category,
    key: row.key,
    value: row.value ?? null,
    source: row.source ?? null,
    explicitModuleScope: scopeCheck.modules.length > 0 ? scopeCheck.modules : null,
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
 * - Persisted `data_class` / `module_scope` are validated fail-closed.
 * - Legacy rows with `data_class IS NULL` are classified via P125's exact
 *   `classifyTemporalMemoryWrite` using any resolved `sourceEvents` (and failing
 *   closed to `UNCLASSIFIED` when provenance is incomplete or missing).
 */
export function classifyTemporalMemoryForRead(
  row: TemporalMemoryReadRow,
  events?: ReadonlyMap<string, TemporalEventProvenance>,
): ReadMemoryClassification {
  const parsedClass = parsePersistedDataClass(row.dataClass);
  const scopeCheck = validateRawModuleScope(row.moduleScope);

  if (parsedClass.value === 'SECRET_BEARING') {
    return {
      dataClass: 'SECRET_BEARING',
      moduleScope: scopeCheck.modules,
      invalidModuleScope: !scopeCheck.valid,
    };
  }

  if (!parsedClass.valid || !scopeCheck.valid) {
    return {
      dataClass: parsedClass.value ?? 'UNCLASSIFIED',
      moduleScope: scopeCheck.modules,
      invalidDataClass: !parsedClass.valid,
      invalidModuleScope: !scopeCheck.valid,
    };
  }

  if (parsedClass.value !== null) {
    return {
      dataClass: parsedClass.value,
      moduleScope: scopeCheck.modules,
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
    explicitModuleScope: scopeCheck.modules.length > 0 ? scopeCheck.modules : null,
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
 * read-time structural classification when `data_class IS NULL`, failing closed
 * on any invalid persisted `data_class` or `module_scope`.
 */
export function classifyEmbeddingForRead(
  hit: EmbeddingReadRow,
  sourceClassification?: ReadMemoryClassification | null,
): ReadMemoryClassification {
  const parsedClass = parsePersistedDataClass(hit.dataClass);
  const scopeCheck = validateRawModuleScope(hit.moduleScope);

  if (parsedClass.value === 'SECRET_BEARING' || sourceClassification?.dataClass === 'SECRET_BEARING') {
    return {
      dataClass: 'SECRET_BEARING',
      moduleScope: unionModuleScopes(scopeCheck.modules, sourceClassification?.moduleScope),
    };
  }

  const invalidDataClass = !parsedClass.valid || sourceClassification?.invalidDataClass === true;
  const invalidModuleScope = !scopeCheck.valid || sourceClassification?.invalidModuleScope === true;
  if (invalidDataClass || invalidModuleScope) {
    return {
      dataClass: mostRestrictiveDataClass(
        [parsedClass.value, sourceClassification?.dataClass],
        'UNCLASSIFIED',
      ),
      moduleScope: unionModuleScopes(scopeCheck.modules, sourceClassification?.moduleScope),
      invalidDataClass,
      invalidModuleScope,
    };
  }

  if (parsedClass.value !== null && sourceClassification) {
    return {
      dataClass: mostRestrictiveDataClass([parsedClass.value, sourceClassification.dataClass]),
      moduleScope: unionModuleScopes(scopeCheck.modules, sourceClassification.moduleScope),
    };
  }

  const derived = classifyEmbeddingWrite({
    sourceType: hit.sourceType,
    content: hit.content ?? null,
    metadata: hit.metadata ?? null,
    sourceDataClass: sourceClassification?.dataClass ?? null,
    sourceModuleScope: sourceClassification?.moduleScope ?? null,
    explicitDataClass: parsedClass.value,
    explicitModuleScope: scopeCheck.modules.length > 0 ? scopeCheck.modules : null,
  });

  if (parsedClass.value !== null) {
    return {
      dataClass: mostRestrictiveDataClass([parsedClass.value, derived.dataClass]),
      moduleScope: unionModuleScopes(scopeCheck.modules, derived.moduleScope),
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
 * revenue/reflection/integration kinds require `REVENUE`; invalid persisted
 * `data_class` / `module_scope` fail closed; unknown rows apply the backstop.
 */
export function classifyKeyCortexMemoryForRead(
  row: KeyCortexMemoryReadRow,
  opts: { revenueOnlyTypes?: ReadonlySet<string> } = {},
): MemoryAccessInput {
  const parsedClass = parsePersistedDataClass(row.dataClass);
  const scopeCheck = validateRawModuleScope(row.moduleScope);

  if (parsedClass.value === 'SECRET_BEARING') {
    return {
      dataClass: 'SECRET_BEARING',
      moduleScope: scopeCheck.modules,
      hasOwnerColumn: Boolean(row.userId),
      ownerUserId: row.userId ?? null,
      backstopTexts: [row.value],
    };
  }

  if (!parsedClass.valid || !scopeCheck.valid) {
    return {
      dataClass: parsedClass.value ?? 'UNCLASSIFIED',
      moduleScope: scopeCheck.modules,
      invalidDataClass: !parsedClass.valid,
      invalidModuleScope: !scopeCheck.valid,
      hasOwnerColumn: Boolean(row.userId),
      ownerUserId: row.userId ?? null,
      backstopTexts: [row.value],
    };
  }

  const classes: Array<MemoryRowDataClass | null> = [parsedClass.value];
  const scopes = new Set<CanonicalModule>(scopeCheck.modules);

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
 * Builds a strict fail-closed Prisma `where` clause fragment for stores carrying
 * `dataClass` (`AiMemory`, `TemporalFlowMemory`).
 *
 * Uses a strict whitelist (`{ in: allowedClasses }`) alongside `{ dataClass: null }`
 * so `SECRET_BEARING`, denied classes (`REVENUE`, `UNCLASSIFIED`, memberless
 * `PERSONAL`), AND any unrecognized non-null `data_class` values NEVER pass SQL
 * pre-filtering or consume `take` slots.
 *
 * Note: `module_scope` is nullable `TEXT[]` with no default in Postgres
 * (`20261126000000_memory_class_columns`), so `NOT (module_scope && ...)` would
 * evaluate to SQL `NULL` and drop legacy rows with `module_scope IS NULL`;
 * `module_scope` is enforced in-memory by `evaluateMemoryClassAccess` alongside
 * `fetchProjectedBatch` pagination before ranking and before any count.
 */
export function buildDbMemoryClassPreFilter(
  ctx: MemoryReaderContext,
): Record<string, unknown> {
  const hasMember = ctx.reader !== null;
  const allowedClasses: MemoryRowDataClass[] = ['GENERAL'];
  if (hasMember) {
    allowedClasses.push('PERSONAL');
  }
  if (hasMember && ctx.sight('revenue')) {
    allowedClasses.push('REVENUE');
  }
  if (hasMember && ctx.sight('revenue') && ctx.sight('expenses')) {
    allowedClasses.push('UNCLASSIFIED');
  }

  return {
    OR: [{ dataClass: null }, { dataClass: { in: allowedClasses } }],
  };
}

/**
 * Strict SQL pre-filter excluding `SECRET_BEARING` and unrecognized non-null
 * `data_class` values for read paths invoked without a `readerContext`.
 */
export function buildDbNonSecretPreFilter(): Record<string, unknown> {
  return {
    OR: [
      { dataClass: null },
      { dataClass: { in: ['GENERAL', 'REVENUE', 'PERSONAL', 'UNCLASSIFIED'] } },
    ],
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
        invalidDataClass: classified.invalidDataClass,
        invalidModuleScope: classified.invalidModuleScope,
        hasOwnerColumn: false,
        backstopTexts: [row.category, row.key, row.value],
        skipExpenseBackstop: isDocExtraction,
      },
      ctx,
    );
  };

  if (mode === 'SHADOW') {
    return runCrashIsolatedShadow({
      rows,
      store: 'ai_memory',
      path: opts.path ?? 'ai_memory',
      businessId: opts.businessId ?? 'unknown',
      readerPresent: ctx.reader !== null,
      logger: opts.logger,
      idOf: (row) => row.id,
      legacyFilter: legacyPredicate,
      evaluate,
    });
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
        invalidDataClass: classified.invalidDataClass,
        invalidModuleScope: classified.invalidModuleScope,
        hasOwnerColumn: false,
        backstopTexts: [row.entityType, row.type, row.sourceModule, row.content],
        unclassifiedRequiresAllModules: true,
      },
      ctx,
    );
  };

  if (mode === 'SHADOW') {
    return runCrashIsolatedShadow({
      rows,
      store: 'temporal_flow_memory',
      path: opts.path ?? 'temporal_flow_memory',
      businessId: opts.businessId ?? 'unknown',
      readerPresent: ctx.reader !== null,
      logger: opts.logger,
      idOf: (row) => row.id,
      legacyFilter: legacyPredicate,
      evaluate,
    });
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
    return runCrashIsolatedShadow({
      rows,
      store: 'key_cortex_memory',
      path: opts.path ?? 'key_cortex_memory',
      businessId: opts.businessId ?? 'unknown',
      readerPresent: ctx.reader !== null,
      logger: opts.logger,
      idOf: (row) => row.id,
      legacyFilter: legacyPredicate,
      evaluate,
    });
  }

  return rows.filter((row) => evaluate(row).allowed);
}

export interface BusinessEventReadRow {
  id?: string;
  eventType?: string | null;
  subjectType?: string | null;
  action?: string | null;
  source?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
}

function safeJsonText(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') return val;
  try {
    return JSON.stringify(val);
  } catch {
    return null;
  }
}

/**
 * Evaluates a `BusinessEvent` row through the unified projection (module scope
 * from eventType/subjectType/action/source + REVENUE taint + secret/money/expense backstop).
 */
export function evaluateBusinessEventForReader(
  row: BusinessEventReadRow,
  ctx: MemoryReaderContext,
): MemoryAccessDecision {
  const metaModule =
    row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>).module
      : undefined;
  const scopes = modulesFromIdentifiers(
    row.eventType,
    row.subjectType,
    row.action,
    row.source,
    typeof metaModule === 'string' ? metaModule : null,
  );
  const isMoney =
    scopes.includes('revenue') ||
    scopes.includes('expenses') ||
    isMoneyLabel(row.eventType) ||
    isMoneyLabel(row.subjectType) ||
    isMoneyLabel(row.action);
  const texts = [
    row.eventType,
    row.subjectType,
    row.action,
    safeJsonText(row.before),
    safeJsonText(row.after),
    safeJsonText(row.metadata),
  ];
  return evaluateMemoryClassAccess(
    {
      dataClass: isMoney ? 'REVENUE' : 'GENERAL',
      moduleScope: scopes,
      hasOwnerColumn: false,
      backstopTexts: texts,
    },
    ctx,
  );
}

/** Projects `BusinessEvent` rows for `ctx` respecting `MEMORY_CLASS_READ=OFF|SHADOW|ACTIVE`. */
export function projectBusinessEventRowsForReader<T extends BusinessEventReadRow>(
  rows: readonly T[],
  ctx: MemoryReaderContext,
  opts: RowProjectionOptions<T> = {},
): T[] {
  const mode = getMemoryClassReadMode();
  const legacyPredicate = opts.legacyFilter ?? (() => true);
  if (mode === 'OFF') return rows.filter(legacyPredicate);

  const evaluate = (row: T) => evaluateBusinessEventForReader(row, ctx);

  if (mode === 'SHADOW') {
    return runCrashIsolatedShadow({
      rows,
      store: 'business_event',
      path: opts.path ?? 'business_event',
      businessId: opts.businessId ?? 'unknown',
      readerPresent: ctx.reader !== null,
      logger: opts.logger,
      idOf: (row) => row.id,
      legacyFilter: legacyPredicate,
      evaluate,
    });
  }

  return rows.filter((row) => evaluate(row).allowed);
}

export interface EpisodicLogReadRow {
  id?: string;
  userId?: string | null;
  module?: string | null;
  toolName?: string | null;
  action?: string | null;
  actionType?: string | null;
  rationale?: string | null;
  description?: string | null;
  inputSummary?: unknown;
  outputSummary?: unknown;
  result?: unknown;
  errorMessage?: string | null;
  error?: string | null;
}

/**
 * Evaluates a member-owned episodic log row (`AiExecutionLog` or `CortexActionLog`):
 * enforces `PERSONAL` ownership (`ownerUserId === ctx.reader`), module scope from
 * `module`/`toolName`/`action`/`actionType`, and money/expense/secret backstops.
 */
export function evaluateEpisodicLogForReader(
  row: EpisodicLogReadRow,
  ctx: MemoryReaderContext,
): MemoryAccessDecision {
  const scopes = modulesFromIdentifiers(row.module, row.toolName, row.action, row.actionType);
  const texts = [
    row.action,
    row.actionType,
    row.toolName,
    row.module,
    row.rationale,
    row.description,
    safeJsonText(row.inputSummary),
    safeJsonText(row.outputSummary),
    safeJsonText(row.result),
    row.errorMessage,
    row.error,
  ];
  return evaluateMemoryClassAccess(
    {
      dataClass: 'PERSONAL',
      moduleScope: scopes,
      hasOwnerColumn: true,
      ownerUserId: row.userId ?? null,
      backstopTexts: texts,
    },
    ctx,
  );
}

/** Projects `AiExecutionLog` / `CortexActionLog` rows for `ctx` respecting `MEMORY_CLASS_READ=OFF|SHADOW|ACTIVE`. */
export function projectEpisodicLogRowsForReader<T extends EpisodicLogReadRow>(
  rows: readonly T[],
  ctx: MemoryReaderContext,
  opts: RowProjectionOptions<T> & { store?: string } = {},
): T[] {
  const mode = getMemoryClassReadMode();
  const legacyPredicate = opts.legacyFilter ?? (() => true);
  if (mode === 'OFF') return rows.filter(legacyPredicate);

  const evaluate = (row: T) => evaluateEpisodicLogForReader(row, ctx);

  if (mode === 'SHADOW') {
    return runCrashIsolatedShadow({
      rows,
      store: opts.store ?? 'ai_execution_log',
      path: opts.path ?? 'episodic_log',
      businessId: opts.businessId ?? 'unknown',
      readerPresent: ctx.reader !== null,
      logger: opts.logger,
      idOf: (row) => row.id,
      legacyFilter: legacyPredicate,
      evaluate,
    });
  }

  return rows.filter((row) => evaluate(row).allowed);
}
