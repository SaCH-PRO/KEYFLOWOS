/**
 * MEM-CLASS-COLUMNS (P125, D-257): Canonical write-side memory classification
 * lattice, module-scope normalization/union, and structural provenance classifiers
 * shared across `ai_memories`, `ai_memory_embeddings`, and `temporal_flow_memories`.
 *
 * Pure leaf module (zero NestJS/Prisma/service circular dependencies) so every
 * memory writer — and downstream `MEM-CLASS-BACKFILL` / `MEM-CLASS-READ` — uses
 * one authoritative definition of:
 *   1. The 5 persisted data classes and their strict restrictiveness ordering:
 *        SECRET_BEARING > PERSONAL > REVENUE > UNCLASSIFIED > GENERAL
 *   2. Canonical `module_scope` normalization and deterministic sorted union.
 *   3. Structural provenance classification for AiMemory rows, TemporalFlowEvent /
 *      TemporalFlowMemory rows, and AiMemoryEmbedding copies.
 */
import {
  isCanonicalModule,
  type CanonicalModule,
} from '../../core/authority/module-vocabulary';
import {
  isMoneyLabel,
  proposalTextStatesMoney,
} from '../business-genome/key-genome/genome-finance-scope';

/** The 5 canonical persisted values for `data_class` columns. */
export const MEMORY_ROW_DATA_CLASSES = [
  'GENERAL',
  'REVENUE',
  'PERSONAL',
  'SECRET_BEARING',
  'UNCLASSIFIED',
] as const;

export type MemoryRowDataClass = (typeof MEMORY_ROW_DATA_CLASSES)[number];

/**
 * Strict restrictiveness lattice (higher rank = more restrictive; wins on merge,
 * embedding copy, temporal summary, or consolidation):
 *   SECRET_BEARING > PERSONAL > REVENUE > UNCLASSIFIED > GENERAL
 */
export const MEMORY_DATA_CLASS_RANK: Readonly<Record<MemoryRowDataClass, number>> = {
  GENERAL: 0,
  UNCLASSIFIED: 1,
  REVENUE: 2,
  PERSONAL: 3,
  SECRET_BEARING: 4,
};

const DATA_CLASS_SET: ReadonlySet<string> = new Set(MEMORY_ROW_DATA_CLASSES);

export function isMemoryRowDataClass(value: unknown): value is MemoryRowDataClass {
  return typeof value === 'string' && DATA_CLASS_SET.has(value);
}

/** Returns the more restrictive of two canonical data classes. */
export function moreRestrictiveDataClass(
  a: MemoryRowDataClass,
  b: MemoryRowDataClass,
): MemoryRowDataClass {
  return MEMORY_DATA_CLASS_RANK[a] >= MEMORY_DATA_CLASS_RANK[b] ? a : b;
}

/**
 * Returns the most restrictive valid data class from `classes`, or `fallback`
 * (defaults to `'UNCLASSIFIED'`, fail-closed) if none are present.
 */
export function mostRestrictiveDataClass(
  classes: Iterable<MemoryRowDataClass | string | null | undefined>,
  fallback: MemoryRowDataClass = 'UNCLASSIFIED',
): MemoryRowDataClass {
  let winner: MemoryRowDataClass | null = null;
  for (const item of classes) {
    if (!isMemoryRowDataClass(item)) continue;
    winner = winner === null ? item : moreRestrictiveDataClass(winner, item);
  }
  return winner ?? fallback;
}

/** Classification tuple persisted onto `data_class` and `module_scope`. */
export interface MemoryClassification {
  dataClass: MemoryRowDataClass;
  moduleScope: CanonicalModule[];
}

/** Expense vocabulary matching `semantic-memory-sight.ts` (D-146). */
const EXPENSE_WORDS =
  /(?<![a-z])(expenses?|expenditures?|bills?|receipts?|budgets?|vendors?|suppliers?|rent|payroll|salar(?:y|ies)|wages?|utilit(?:y|ies)|overheads?|outgoings?|spend(?:s|ing)?|spent|costs?|payables?|purchases?|purchased|procure(?:ment|d)?|reimburs\w*|leases?|landlords?|insurance|premiums?|electricity|fuel|cogs)(?![a-z])/i;

function textStatesMoney(value: unknown): boolean {
  return typeof value === 'string' && value !== '' && (isMoneyLabel(value) || proposalTextStatesMoney(value));
}

function textStatesExpense(value: unknown): boolean {
  if (typeof value !== 'string' || value === '') return false;
  return EXPENSE_WORDS.test(value) || EXPENSE_WORDS.test(value.replace(/([a-z0-9])([A-Z])/g, '$1 $2'));
}

/**
 * Word-to-canonical-module map aligned with `MODULE_WORDS` in
 * `key-cortex-prompt-context.service.ts` plus direct canonical names.
 */
const MODULE_TOKEN_MAP: ReadonlyArray<readonly [CanonicalModule, readonly string[]]> = [
  [
    'revenue',
    [
      'revenue', 'invoice', 'invoices', 'payment', 'payments', 'refund', 'refunds',
      'deposit', 'deposits', 'transaction', 'transactions', 'bank', 'banking',
      'reconciliation', 'quote', 'quotes', 'payout', 'payouts', 'ledger', 'journal',
      'receivable', 'receivables', 'commerce', 'finance', 'financial', 'cash',
      'cashflow', 'treasury', 'charge', 'charges', 'billing', 'payroll', 'claim', 'claims',
    ],
  ],
  [
    'expenses',
    [
      'expense', 'expenses', 'budget', 'budgets', 'bill', 'bills', 'receipt',
      'receipts', 'vendor', 'vendors', 'cost', 'costs',
    ],
  ],
  [
    'crm',
    [
      'crm', 'contact', 'contacts', 'lead', 'leads', 'deal', 'deals',
      'opportunity', 'opportunities', 'outreach', 'sequence', 'sequences',
      'call', 'demo', 'demos',
    ],
  ],
  [
    'bookings',
    [
      'booking', 'bookings', 'reservation', 'reservations', 'appointment',
      'appointments', 'calendar', 'meeting', 'meetings', 'guest', 'guests',
      'visitor', 'visitors', 'checkin',
    ],
  ],
  [
    'projects',
    ['project', 'projects', 'milestone', 'milestones', 'bug', 'bugs', 'qa'],
  ],
  [
    'operations',
    [
      'operations', 'ticket', 'tickets', 'helpdesk', 'support', 'inbox',
      'message', 'messages', 'whatsapp', 'procurement', 'purchase', 'contract',
      'contracts', 'delivery', 'deliveries', 'communications', 'sentiment',
      'legal', 'shift', 'shifts', 'dispatch', 'technician', 'technicians',
    ],
  ],
  [
    'storefront',
    [
      'storefront', 'product', 'products', 'catalog', 'inventory', 'stock',
      'order', 'orders', 'marketplace', 'storelink', 'checkout',
    ],
  ],
  [
    'content',
    [
      'content', 'campaign', 'campaigns', 'asset', 'assets', 'marketing',
      'social', 'mention', 'mentions', 'media', 'audio', 'video', 'design',
    ],
  ],
  ['automations', ['automations', 'automation', 'autopilot']],
  [
    'team',
    [
      'team', 'employee', 'employees', 'hr', 'candidate', 'candidates',
      'recruiting', 'onboarding', 'training', 'course', 'courses',
    ],
  ],
  ['settings', ['settings']],
  ['ai', ['ai']],
  ['analytics', ['analytics']],
  ['connect', ['connect']],
];

const COMPOUND_FAMILY_MAP: ReadonlyMap<string, readonly CanonicalModule[]> = new Map([
  ['check_in', ['bookings']],
  ['front_desk', ['bookings']],
  ['field_service', ['operations']],
  ['fieldservice', ['operations']],
  ['flow_run', ['automations']],
  ['key_inbox', ['operations']],
]);

const WORD_TO_MODULES: ReadonlyMap<string, readonly CanonicalModule[]> = (() => {
  const map = new Map<string, CanonicalModule[]>();
  for (const [mod, words] of MODULE_TOKEN_MAP) {
    for (const w of words) {
      const list = map.get(w) ?? [];
      if (!list.includes(mod)) list.push(mod);
      map.set(w, list);
    }
  }
  return map;
})();

function tokenizeIdentifier(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Extracts canonical modules referenced by structural identifiers (module names,
 * tool names, event types, entity types, memory keys, tags).
 */
export function modulesFromIdentifiers(...values: Array<string | null | undefined>): CanonicalModule[] {
  const found = new Set<CanonicalModule>();
  for (const raw of values) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (isCanonicalModule(lower)) {
      found.add(lower);
      continue;
    }
    const family = lower.split('.')[0];
    for (const m of COMPOUND_FAMILY_MAP.get(lower) ?? []) found.add(m);
    for (const m of COMPOUND_FAMILY_MAP.get(family) ?? []) found.add(m);
    for (const tok of tokenizeIdentifier(trimmed)) {
      for (const m of WORD_TO_MODULES.get(tok) ?? []) found.add(m);
    }
  }
  return [...found].sort();
}

/**
 * Normalizes module names/aliases into a deterministic sorted deduplicated
 * `CanonicalModule[]`. Unknown strings are dropped cleanly.
 */
export function normalizeModuleScope(
  modules: Iterable<string | null | undefined>,
): CanonicalModule[] {
  const found = new Set<CanonicalModule>();
  for (const raw of modules) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (isCanonicalModule(lower)) {
      found.add(lower);
      continue;
    }
    for (const m of modulesFromIdentifiers(trimmed)) {
      found.add(m);
    }
  }
  return [...found].sort();
}

/** Deterministic sorted deduplicated union of canonical module scopes. */
export function unionModuleScopes(
  ...lists: Array<Iterable<string | null | undefined> | null | undefined>
): CanonicalModule[] {
  const combined: Array<string | null | undefined> = [];
  for (const list of lists) {
    if (!list) continue;
    for (const item of list) combined.push(item);
  }
  return normalizeModuleScope(combined);
}

/**
 * Merges multiple classifications by taking the most restrictive `dataClass`
 * and the sorted deduplicated union of `moduleScope`.
 */
export function mergeMemoryClassifications(
  items: ReadonlyArray<
    { dataClass?: MemoryRowDataClass | string | null; moduleScope?: readonly string[] | null } | null | undefined
  >,
  fallbackClass: MemoryRowDataClass = 'UNCLASSIFIED',
): MemoryClassification {
  const classes: Array<MemoryRowDataClass | string | null | undefined> = [];
  const scopes: Array<readonly string[] | null | undefined> = [];
  for (const item of items) {
    if (!item) continue;
    classes.push(item.dataClass);
    scopes.push(item.moduleScope);
  }
  return {
    dataClass: mostRestrictiveDataClass(classes, fallbackClass),
    moduleScope: unionModuleScopes(...scopes),
  };
}

/** Known structural AiMemory categories that are GENERAL unless financial/personal/secret. */
const KNOWN_GENERAL_AI_MEMORY_CATEGORIES = new Set<string>([
  'goals',
  'tone',
  'riskTolerance',
  'risk_tolerance',
  'outreachStyle',
  'reportingCadence',
  'priorities',
  'bottlenecks',
  'corrections',
  'learned_corrections',
  'patterns',
  'preferences',
  'execution_patterns',
  'role_activity',
  'business_fact',
  'past_decision',
  'failed_attempt',
  'successful_action',
  'common_workflow',
  'current_goal',
  'long_term_strategy',
  'learning',
  'suggestion',
  'suggestion_block',
  'evolution_tuning',
]);

const PERSONAL_AI_MEMORY_CATEGORIES = new Set<string>([
  'user_preference',
  'communication_style',
]);

/** Categories whose keys structurally name a module/tool/domain (never generic keys like `preferred`). */
const KEY_SCOPED_AI_MEMORY_CATEGORIES = new Set<string>([
  'corrections',
  'learned_corrections',
  'patterns',
  'execution_patterns',
  'role_activity',
  'past_decision',
  'failed_attempt',
  'successful_action',
  'learning',
  'suggestion',
  'suggestion_block',
]);

export interface AiMemoryClassificationInput {
  category: string;
  key: string;
  value?: string | null;
  source?: string | null;
  userId?: string | null;
  explicitDataClass?: MemoryRowDataClass | null;
  explicitModuleScope?: readonly string[] | null;
}

/**
 * Classifies an `ai_memories` write from its structural provenance.
 * Explicit caller restrictions (`explicitDataClass`, `explicitModuleScope`) are
 * always preserved via restrictiveness merge and scope union.
 */
export function classifyAiMemoryWrite(
  input: AiMemoryClassificationInput,
): MemoryClassification {
  const { category, key, value, userId, explicitDataClass, explicitModuleScope } = input;
  const scopes = new Set<CanonicalModule>(
    explicitModuleScope ? normalizeModuleScope(explicitModuleScope) : [],
  );

  // 1. Settings category (configuration rows)
  if (category === 'settings') {
    let baseClass: MemoryRowDataClass;
    if (key === 'ai_preferences') {
      baseClass = 'SECRET_BEARING';
      scopes.add('ai');
      scopes.add('settings');
    } else if (key === 'autonomy' || key === 'routing_table') {
      baseClass = 'GENERAL';
      scopes.add('ai');
      scopes.add('settings');
    } else {
      baseClass = 'UNCLASSIFIED';
      scopes.add('settings');
    }
    return {
      dataClass: explicitDataClass ? moreRestrictiveDataClass(baseClass, explicitDataClass) : baseClass,
      moduleScope: [...scopes].sort(),
    };
  }

  // 2. Document extraction (MEM-DOC-EXTRACTION-SIGHT: always REVENUE + revenue scope)
  if (category === 'document_extraction') {
    scopes.add('revenue');
    const baseClass: MemoryRowDataClass = 'REVENUE';
    return {
      dataClass: explicitDataClass ? moreRestrictiveDataClass(baseClass, explicitDataClass) : baseClass,
      moduleScope: [...scopes].sort(),
    };
  }

  // 3. Structural module scope from category/key
  if (category === 'evolution_tuning') {
    scopes.add('ai');
  } else if (KEY_SCOPED_AI_MEMORY_CATEGORIES.has(category)) {
    for (const m of modulesFromIdentifiers(key)) scopes.add(m);
  }

  // 4. Financial / expense fail-closed checks on category, key, and value
  const moneyTaint =
    isMoneyLabel(category) ||
    isMoneyLabel(key) ||
    textStatesMoney(value);
  const expenseTaint =
    textStatesExpense(category) ||
    textStatesExpense(key) ||
    textStatesExpense(value);

  if (moneyTaint) scopes.add('revenue');
  if (expenseTaint) scopes.add('expenses');

  // 5. Base class resolution
  const candidates: Array<MemoryRowDataClass | null | undefined> = [explicitDataClass];

  if (userId || PERSONAL_AI_MEMORY_CATEGORIES.has(category)) {
    candidates.push('PERSONAL');
  }
  if (moneyTaint || expenseTaint || scopes.has('revenue') || scopes.has('expenses')) {
    candidates.push('REVENUE');
  }
  if (KNOWN_GENERAL_AI_MEMORY_CATEGORIES.has(category)) {
    candidates.push('GENERAL');
  } else if (!PERSONAL_AI_MEMORY_CATEGORIES.has(category)) {
    candidates.push('UNCLASSIFIED');
  }

  return {
    dataClass: mostRestrictiveDataClass(candidates, 'UNCLASSIFIED'),
    moduleScope: [...scopes].sort(),
  };
}

export interface TemporalEventProvenance {
  id?: string;
  source?: string | null;
  type?: string | null;
  module?: string | null;
  entityType?: string | null;
  title?: string | null;
  summary?: string | null;
  description?: string | null;
}

/**
 * Classifies a single `temporal_flow_events` row from its structural fields
 * (module, type, source, entityType) and text taint (title, summary, description).
 */
export function classifyTemporalEvent(
  event: TemporalEventProvenance,
): MemoryClassification {
  const scopes = new Set<CanonicalModule>(
    modulesFromIdentifiers(event.module, event.type, event.source, event.entityType),
  );
  const isMoney =
    event.entityType === 'key_action_proposal' ||
    [event.type, event.module, event.source].some((v) => isMoneyLabel(v)) ||
    [event.title, event.summary, event.description].some(textStatesMoney);
  const isExpense =
    [event.type, event.module, event.source].some(textStatesExpense) ||
    [event.title, event.summary, event.description].some(textStatesExpense);

  if (isMoney) scopes.add('revenue');
  if (isExpense) scopes.add('expenses');

  let dataClass: MemoryRowDataClass;
  if (isMoney || isExpense || scopes.has('revenue') || scopes.has('expenses')) {
    dataClass = 'REVENUE';
  } else if (scopes.size > 0) {
    dataClass = 'GENERAL';
  } else {
    dataClass = 'UNCLASSIFIED';
  }

  return {
    dataClass,
    moduleScope: [...scopes].sort(),
  };
}

export interface TemporalMemoryClassificationInput {
  entityType: string;
  entityId?: string | null;
  type?: string | null;
  sourceModule?: string | null;
  content?: string | null;
  sourceEvents?: readonly TemporalEventProvenance[] | null;
  sourceEventIds?: readonly string[] | null;
  /** True when caller attempted to load sourceEventIds and one or more were missing. */
  hasMissingSourceEvents?: boolean;
  explicitDataClass?: MemoryRowDataClass | null;
  explicitModuleScope?: readonly string[] | null;
}

/**
 * Classifies a `temporal_flow_memories` write from its own structural metadata
 * and the union / most-restrictive lattice over its source `temporal_flow_events`.
 */
export function classifyTemporalMemoryWrite(
  input: TemporalMemoryClassificationInput,
): MemoryClassification {
  const scopes = new Set<CanonicalModule>(
    explicitModuleScopeOf(input.explicitModuleScope),
  );
  const classes: Array<MemoryRowDataClass | null | undefined> = [input.explicitDataClass];

  // Structural modules from row itself (entityType, sourceModule, and entityId when channel/business key)
  for (const m of modulesFromIdentifiers(input.entityType, input.sourceModule)) {
    scopes.add(m);
  }
  if (input.entityType === 'channel' || input.entityType === 'business') {
    for (const m of modulesFromIdentifiers(input.entityId)) scopes.add(m);
  }

  // Opaque KEY cortex business memories (TemporalAdapterService.storeMemory) store tags in sourceEventIds
  const isOpaqueCortexMemory = input.entityType === 'business' || input.sourceModule === 'key_cortex';
  if (isOpaqueCortexMemory) {
    for (const tag of input.sourceEventIds ?? []) {
      for (const m of modulesFromIdentifiers(tag)) scopes.add(m);
    }
    classes.push('UNCLASSIFIED');
  }

  // Classify every source event and union/restrict; unresolved non-opaque sourceEventIds fail closed
  const sourceEvents = input.sourceEvents ?? [];
  const hasUnresolvedSourceEvents =
    Boolean(input.hasMissingSourceEvents) ||
    (!isOpaqueCortexMemory && (input.sourceEventIds?.length ?? 0) > 0 && sourceEvents.length === 0);
  for (const ev of sourceEvents) {
    const evClass = classifyTemporalEvent(ev);
    classes.push(evClass.dataClass);
    for (const m of evClass.moduleScope) scopes.add(m);
  }
  if (hasUnresolvedSourceEvents) {
    classes.push('UNCLASSIFIED');
  }

  // Row-level financial/expense taint (structural labels + content text)
  const moneyTaint =
    [input.entityType, input.type, input.sourceModule, input.entityId].some((v) => isMoneyLabel(v)) ||
    textStatesMoney(input.content);
  const expenseTaint =
    [input.entityType, input.type, input.sourceModule, input.entityId].some(textStatesExpense) ||
    textStatesExpense(input.content);

  if (moneyTaint) {
    scopes.add('revenue');
    classes.push('REVENUE');
  }
  if (expenseTaint) {
    scopes.add('expenses');
    classes.push('REVENUE');
  }

  if (scopes.has('revenue') || scopes.has('expenses')) {
    classes.push('REVENUE');
  } else if (!isOpaqueCortexMemory && scopes.size > 0 && !hasUnresolvedSourceEvents) {
    classes.push('GENERAL');
  }

  return {
    dataClass: mostRestrictiveDataClass(classes, 'UNCLASSIFIED'),
    moduleScope: [...scopes].sort(),
  };
}

function explicitModuleScopeOf(list: readonly string[] | null | undefined): CanonicalModule[] {
  return list ? normalizeModuleScope(list) : [];
}

export interface EmbeddingClassificationInput {
  sourceType: string;
  content?: string | null;
  metadata?: Record<string, unknown> | null;
  sourceDataClass?: MemoryRowDataClass | string | null;
  sourceModuleScope?: readonly string[] | null;
  explicitDataClass?: MemoryRowDataClass | null;
  explicitModuleScope?: readonly string[] | null;
}

/**
 * Classifies an `ai_memory_embeddings` write, inheriting the most restrictive
 * `dataClass` and union of `moduleScope` from its source row + caller metadata.
 */
export function classifyEmbeddingWrite(
  input: EmbeddingClassificationInput,
): MemoryClassification {
  const scopes = new Set<CanonicalModule>(
    unionModuleScopes(input.sourceModuleScope, input.explicitModuleScope),
  );
  const classes: Array<MemoryRowDataClass | string | null | undefined> = [
    input.sourceDataClass,
    input.explicitDataClass,
  ];
  const meta = input.metadata ?? {};

  const moneyTaint = textStatesMoney(input.content);
  const expenseTaint = textStatesExpense(input.content);
  if (moneyTaint) {
    scopes.add('revenue');
    classes.push('REVENUE');
  }
  if (expenseTaint) {
    scopes.add('expenses');
    classes.push('REVENUE');
  }

  switch (input.sourceType) {
    case 'memory': {
      // Always derive structural provenance from metadata when category/type is present
      // so a weaker caller explicitDataClass cannot downgrade a legacy or sensitive source.
      const category = typeof meta.category === 'string'
        ? meta.category
        : typeof meta.type === 'string'
          ? meta.type
          : '';
      const key = typeof meta.key === 'string' ? meta.key : '';
      if (category) {
        const derived = classifyAiMemoryWrite({
          category,
          key,
          value: input.content,
          source: typeof meta.source === 'string' ? meta.source : null,
        });
        classes.push(derived.dataClass);
        for (const m of derived.moduleScope) scopes.add(m);
      } else if (!isMemoryRowDataClass(input.sourceDataClass) && !isMemoryRowDataClass(input.explicitDataClass)) {
        classes.push('UNCLASSIFIED');
      }
      break;
    }
    case 'temporal_memory': {
      const hasMetaProvenance =
        typeof meta.entityType === 'string' ||
        typeof meta.entityId === 'string' ||
        typeof meta.sourceModule === 'string';
      if (hasMetaProvenance) {
        const derived = classifyTemporalMemoryWrite({
          entityType: typeof meta.entityType === 'string' ? meta.entityType : 'business',
          entityId: typeof meta.entityId === 'string' ? meta.entityId : null,
          type: typeof meta.type === 'string' ? meta.type : null,
          sourceModule: typeof meta.sourceModule === 'string' ? meta.sourceModule : null,
          content: input.content,
        });
        classes.push(derived.dataClass);
        for (const m of derived.moduleScope) scopes.add(m);
      } else if (!isMemoryRowDataClass(input.sourceDataClass) && !isMemoryRowDataClass(input.explicitDataClass)) {
        classes.push('UNCLASSIFIED');
      }
      break;
    }
    case 'document': {
      // Knowledge source chunks carry no type classification (D-234 fail closed: expenses + revenue)
      scopes.add('expenses');
      scopes.add('revenue');
      classes.push('UNCLASSIFIED');
      break;
    }
    case 'conversation': {
      classes.push('PERSONAL');
      for (const m of modulesFromIdentifiers(
        typeof meta.module === 'string' ? meta.module : null,
      )) {
        scopes.add(m);
      }
      break;
    }
    case 'event': {
      const evClass = classifyTemporalEvent({
        source: typeof meta.source === 'string' ? meta.source : null,
        type: typeof meta.type === 'string' ? meta.type : null,
        module: typeof meta.module === 'string' ? meta.module : null,
        entityType: typeof meta.entityType === 'string' ? meta.entityType : null,
        title: typeof meta.title === 'string' ? meta.title : null,
        summary: input.content ?? null,
      });
      classes.push(evClass.dataClass);
      for (const m of evClass.moduleScope) scopes.add(m);
      break;
    }
    case 'action': {
      const mods = modulesFromIdentifiers(
        typeof meta.module === 'string' ? meta.module : null,
        typeof meta.toolName === 'string' ? meta.toolName : null,
        typeof meta.action === 'string' ? meta.action : null,
      );
      for (const m of mods) scopes.add(m);
      if (scopes.has('revenue') || scopes.has('expenses')) {
        classes.push('REVENUE');
      } else if (mods.length > 0) {
        classes.push('GENERAL');
      } else {
        classes.push('UNCLASSIFIED');
      }
      break;
    }
    default: {
      classes.push('UNCLASSIFIED');
      break;
    }
  }

  return {
    dataClass: mostRestrictiveDataClass(classes, 'UNCLASSIFIED'),
    moduleScope: [...scopes].sort(),
  };
}
