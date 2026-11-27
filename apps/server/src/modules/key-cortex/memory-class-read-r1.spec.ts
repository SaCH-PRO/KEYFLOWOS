/**
 * P137 (MEM-CLASS-READ) — R1 Security & Correctness Hardening Unit Suite.
 *
 * Dedicated R1 verification suite (keeping the pure RED spec
 * `memory-class-read.spec.ts` 100% untouched) covering:
 *   1. Fail-closed invalid `module_scope` & unrecognized non-null `data_class`
 *      (including strict SQL whitelist in `buildDbMemoryClassPreFilter`).
 *   2. Fail-closed legacy `ai_memory_embedding` (`document`, unknown source,
 *      category-less `memory`) in `readersOwnPromptMemory`.
 *   3. Pre-backfill legacy `TemporalFlowMemory` (`data_class IS NULL`) with
 *      benign `sourceEventIds` staying visible through `UnifiedMemoryRetrievalService`
 *      -> `readersOwnPromptMemory`.
 *   4. Secret-pattern backstop (`backstopTextStatesSecret`) withholding leaked
 *      API keys, PEM blocks, Bearer tokens, credential assignments, and
 *      ciphertext blobs even on `GENERAL`-tagged rows for `OWNER`.
 *   5. Crash-isolated `SHADOW` mode + zero `row.key` / text / PII in shadow logs.
 *   6. `KeyCortexContextV2Service.getFullContext` Redis cache isolation across
 *      readers and `KeyCortexLearningService.retrieveLessons` backstop +
 *      `evaluateSightOnlyAggregateAccess` refusing `PERSONAL`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { CanonicalModule } from '../../core/authority/module-vocabulary';
import {
  backstopTextStatesSecret,
  buildDbMemoryClassPreFilter,
  classifyAiMemoryForRead,
  classifyEmbeddingForRead,
  classifyKeyCortexMemoryForRead,
  classifyTemporalMemoryForRead,
  evaluateMemoryClassAccess,
  evaluateSightOnlyAggregateAccess,
  fetchProjectedBatch,
  projectAiMemoryRowsForReader,
  runCrashIsolatedShadow,
  validateRawModuleScope,
  type MemoryReaderContext,
} from './memory-class-read-projection';
import { readersOwnPromptMemory, type ModuleSight } from './key-cortex-prompt-context.service';
import { UnifiedMemoryRetrievalService } from './unified-memory-retrieval.service';
import { KeyCortexContextV2Service } from './key-cortex-context-v2.service';
import { KeyCortexLearningService } from './key-cortex-learning.service';
import { KeyCortexAwarenessService } from './key-cortex-awareness.service';
import { TemporalFlowMemoryService } from '../temporal-flow/temporal-flow-memory.service';

const OWNER_SIGHT: ModuleSight = () => true;
const CRM_ONLY_SIGHT: ModuleSight = (m: CanonicalModule) => m === 'crm';
const REV_NO_EXP_SIGHT: ModuleSight = (m: CanonicalModule) => m === 'crm' || m === 'revenue';

const OWNER_CTX: MemoryReaderContext = { reader: 'owner_1', sight: OWNER_SIGHT };
const CRM_CTX: MemoryReaderContext = { reader: 'staff_crm', sight: CRM_ONLY_SIGHT };
const REV_NO_EXP_CTX: MemoryReaderContext = { reader: 'staff_rev', sight: REV_NO_EXP_SIGHT };

describe('MEM-CLASS-READ R1 Hardening Suite', () => {
  const prevFlag = process.env.MEMORY_CLASS_READ;

  beforeEach(() => {
    delete process.env.MEMORY_CLASS_READ;
  });

  afterEach(() => {
    if (prevFlag === undefined) delete process.env.MEMORY_CLASS_READ;
    else process.env.MEMORY_CLASS_READ = prevFlag;
  });

  describe('R1-1: Fail-closed module_scope and unrecognized non-null data_class', () => {
    it('validateRawModuleScope rejects non-arrays, empty strings, and unknown module identifiers', () => {
      expect(validateRawModuleScope(null)).toEqual({ valid: true, modules: [] });
      expect(validateRawModuleScope(undefined)).toEqual({ valid: true, modules: [] });
      expect(validateRawModuleScope(['crm', 'bookings'])).toEqual({
        valid: true,
        modules: ['bookings', 'crm'],
      });
      expect(validateRawModuleScope('crm' as unknown)).toEqual({ valid: false, modules: [] });
      expect(validateRawModuleScope([''])).toEqual({ valid: false, modules: [] });
      expect(validateRawModuleScope(['crm', 'unknown_secret_module'])).toEqual({
        valid: false,
        modules: [],
      });
      expect(validateRawModuleScope([123 as unknown])).toEqual({ valid: false, modules: [] });
    });

    it('evaluateMemoryClassAccess denies unknown module_scope and unrecognized data_class even for OWNER', () => {
      const badScope = evaluateMemoryClassAccess(
        { dataClass: 'GENERAL', moduleScope: ['unknown_secret_module'] },
        OWNER_CTX,
      );
      expect(badScope.allowed).toBe(false);
      expect(badScope.reason).toBe('invalid_module_scope');

      const nonArrayScope = evaluateMemoryClassAccess(
        { dataClass: 'GENERAL', moduleScope: 'crm' as unknown },
        OWNER_CTX,
      );
      expect(nonArrayScope.allowed).toBe(false);
      expect(nonArrayScope.reason).toBe('invalid_module_scope');

      const badClass = evaluateMemoryClassAccess(
        { dataClass: 'RESTRICTED', moduleScope: [] },
        OWNER_CTX,
      );
      expect(badClass.allowed).toBe(false);
      expect(badClass.reason).toBe('invalid_data_class');
    });

    it('read-time classifiers never coerce unrecognized non-null dataClass to GENERAL or drop unknown moduleScope', () => {
      const aiBadClass = classifyAiMemoryForRead({
        category: 'tone',
        key: 'preferred',
        value: 'Warm',
        dataClass: 'RESTRICTED',
        moduleScope: [],
      });
      expect(aiBadClass.invalidDataClass).toBe(true);
      expect(
        evaluateMemoryClassAccess(
          {
            dataClass: aiBadClass.dataClass,
            moduleScope: aiBadClass.moduleScope,
            invalidDataClass: aiBadClass.invalidDataClass,
            invalidModuleScope: aiBadClass.invalidModuleScope,
          },
          OWNER_CTX,
        ).allowed,
      ).toBe(false);

      const aiBadScope = classifyAiMemoryForRead({
        category: 'tone',
        key: 'preferred',
        value: 'Warm',
        dataClass: 'GENERAL',
        moduleScope: ['crm', 'payroll_vault'],
      });
      expect(aiBadScope.invalidModuleScope).toBe(true);
      expect(
        evaluateMemoryClassAccess(
          {
            dataClass: aiBadScope.dataClass,
            moduleScope: aiBadScope.moduleScope,
            invalidDataClass: aiBadScope.invalidDataClass,
            invalidModuleScope: aiBadScope.invalidModuleScope,
          },
          OWNER_CTX,
        ).allowed,
      ).toBe(false);

      const tempBad = classifyTemporalMemoryForRead({
        entityType: 'contact',
        sourceModule: 'crm',
        dataClass: 'CONFIDENTIAL_X',
        moduleScope: ['crm'],
      });
      expect(tempBad.invalidDataClass).toBe(true);

      const embBad = classifyEmbeddingForRead({
        sourceType: 'memory',
        content: 'hello',
        dataClass: 'GENERAL',
        moduleScope: ['not_a_module'],
      });
      expect(embBad.invalidModuleScope).toBe(true);

      const kcBad = classifyKeyCortexMemoryForRead({
        key: 'k1',
        type: 'weak_signal',
        dataClass: 'TOP_SECRET',
        moduleScope: ['weird_mod'],
      });
      expect(kcBad.invalidDataClass).toBe(true);
      expect(kcBad.invalidModuleScope).toBe(true);
      expect(evaluateMemoryClassAccess(kcBad, OWNER_CTX).allowed).toBe(false);
    });

    it('buildDbMemoryClassPreFilter uses strict whitelist (excludes SECRET_BEARING and arbitrary unrecognized strings)', () => {
      const ownerFilter = buildDbMemoryClassPreFilter(OWNER_CTX) as { OR: Array<Record<string, unknown>> };
      const ownerIn = (ownerFilter.OR[1] as { dataClass: { in: string[] } }).dataClass.in;
      expect(ownerIn).toEqual(['GENERAL', 'PERSONAL', 'REVENUE', 'UNCLASSIFIED']);
      expect(ownerIn).not.toContain('SECRET_BEARING');
      expect(ownerIn).not.toContain('RESTRICTED');

      const crmFilter = buildDbMemoryClassPreFilter(CRM_CTX) as { OR: Array<Record<string, unknown>> };
      const crmIn = (crmFilter.OR[1] as { dataClass: { in: string[] } }).dataClass.in;
      expect(crmIn).toEqual(['GENERAL', 'PERSONAL']);

      const memberlessFilter = buildDbMemoryClassPreFilter({ reader: null, sight: OWNER_SIGHT }) as {
        OR: Array<Record<string, unknown>>;
      };
      const memberlessIn = (memberlessFilter.OR[1] as { dataClass: { in: string[] } }).dataClass.in;
      expect(memberlessIn).toEqual(['GENERAL']);
    });
  });

  describe('R1-2: Fail-closed legacy ai_memory_embedding in readersOwnPromptMemory', () => {
    const mockPrisma = {
      client: {
        membership: {
          findUnique: vi.fn(async ({ where }: any) => {
            const uid = where.userId_businessId.userId;
            if (uid === 'owner_1') return { role: 'OWNER', permissionScopes: null };
            if (uid === 'staff_rev') return { role: 'STAFF', permissionScopes: { crm: 'read', revenue: 'read', expenses: 'none' } };
            return { role: 'STAFF', permissionScopes: { crm: 'read', revenue: 'none', expenses: 'none' } };
          }),
        },
        cognitionMemory: { findMany: vi.fn(async () => []) },
        keyActionProposal: { findMany: vi.fn(async () => []) },
      },
    };

    it('withholds legacy document, unknown-source, and category-less memory embeddings from restricted readers', async () => {
      const fragments = [
        {
          id: 'emb_doc_legacy',
          sourceType: 'ai_memory_embedding' as const,
          entityType: null,
          title: 'Knowledge chunk',
          content: 'Internal handbook section 4',
          metadata: { semanticSource: { sourceType: 'document', sourceId: 'ks_1:0' } },
        },
        {
          id: 'emb_unknown_legacy',
          sourceType: 'ai_memory_embedding' as const,
          entityType: null,
          title: 'Unknown chunk',
          content: 'Opaque record without classification',
          metadata: { semanticSource: { sourceType: 'legacy_blob', sourceId: 'b_1' } },
        },
        {
          id: 'emb_catless_memory',
          sourceType: 'ai_memory_embedding' as const,
          entityType: null,
          title: 'Memory chunk',
          content: 'Uncategorized memory text',
          metadata: { semanticSource: { sourceType: 'memory', sourceId: 'm_1' } },
        },
        {
          id: 'emb_benign_fact',
          sourceType: 'ai_memory_embedding' as const,
          entityType: null,
          title: 'Fact',
          content: 'We open at 9am',
          metadata: {
            category: 'fact',
            key: 'hours',
            semanticSource: { sourceType: 'memory', sourceId: 'm_2' },
          },
        },
      ];

      const crmOut = await readersOwnPromptMemory(mockPrisma as any, 'biz_1', 'staff_crm', fragments, 20);
      expect(crmOut.map((f) => f.id)).toEqual(['emb_benign_fact']);

      // Revenue-only without expenses STILL cannot see legacy document/unclassified embeddings (D-234)
      const revOnlyOut = await readersOwnPromptMemory(mockPrisma as any, 'biz_1', 'staff_rev', fragments, 20);
      expect(revOnlyOut.map((f) => f.id)).toEqual(['emb_benign_fact']);

      // Owner with full sight sees all four
      const ownerOut = await readersOwnPromptMemory(mockPrisma as any, 'biz_1', 'owner_1', fragments, 20);
      expect(ownerOut.map((f) => f.id)).toEqual([
        'emb_doc_legacy',
        'emb_unknown_legacy',
        'emb_catless_memory',
        'emb_benign_fact',
      ]);
    });
  });

  describe('R1-3: Legacy TemporalFlowMemory with benign sourceEventIds stays visible downstream', () => {
    it('stamps resolved classification from sourceEventIds so readersOwnPromptMemory keeps benign CRM temporal rows for STAFF', async () => {
      const now = new Date();
      const prisma = {
        client: {
          aiMemory: { findMany: vi.fn(async () => []) },
          genomeMemoryEvent: { findMany: vi.fn(async () => []) },
          temporalFlowMemory: {
            findMany: vi.fn(async () => [
              {
                id: 'tf_legacy_crm',
                businessId: 'biz_1',
                entityType: 'contact',
                entityId: 'c_1',
                type: 'summary',
                content: 'Client prefers morning calls',
                sourceModule: 'crm',
                sourceEventIds: ['ev_crm_1'],
                metadata: { eventCount: 1 },
                confidence: 0.9,
                dataClass: null,
                moduleScope: null,
                createdAt: now,
              },
            ]),
          },
          temporalFlowEvent: {
            findMany: vi.fn(async () => [
              {
                id: 'ev_crm_1',
                source: 'crm',
                type: 'contact.updated',
                module: 'crm',
                entityType: 'contact',
                title: 'Updated preferred contact time',
                summary: 'Client prefers morning calls',
                description: null,
              },
            ]),
          },
          cognitionMemory: { findMany: vi.fn(async () => []) },
          cognitiveEvent: { findMany: vi.fn(async () => []) },
          businessEvent: { findMany: vi.fn(async () => []) },
          aiExecutionLog: { findMany: vi.fn(async () => []) },
          cortexActionLog: { findMany: vi.fn(async () => []) },
          keyActionProposal: { findMany: vi.fn(async () => []) },
          membership: {
            findUnique: vi.fn(async () => ({
              role: 'STAFF',
              permissionScopes: { crm: 'read', revenue: 'none', expenses: 'none' },
            })),
          },
        },
      };

      const retrieval = new UnifiedMemoryRetrievalService(prisma as any, { search: vi.fn(async () => []) } as any);
      const fragments = await retrieval.retrieveContext('biz_1', {
        limit: 10,
        readerContext: CRM_CTX,
      });
      expect(fragments.map((f) => f.id)).toEqual(['tf_legacy_crm']);
      const stamped = (fragments[0].metadata as Record<string, any>).__memoryClass;
      expect(stamped.dataClass).toBe('GENERAL');
      expect(stamped.moduleScope).toEqual(['crm']);

      // Downstream readersOwnPromptMemory MUST NOT re-classify without events and drop it!
      const promptKept = await readersOwnPromptMemory(
        prisma as any,
        'biz_1',
        'staff_crm',
        fragments,
        10,
        undefined,
        'r1Test',
        CRM_ONLY_SIGHT,
      );
      expect(promptKept.map((f) => f.id)).toEqual(['tf_legacy_crm']);
    });
  });

  describe('R1-6: Secret-pattern backstop & crash-isolated SHADOW without row.key', () => {
    it('backstopTextStatesSecret detects keys, PEM blocks, Bearer tokens, credentials, and ciphertext envelopes without false positives', () => {
      expect(backstopTextStatesSecret('Use key sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz123456')).toBe(true);
      expect(backstopTextStatesSecret('Stripe key sk_live_51NxAbCdEfGhIjKlMnOpQr')).toBe(true);
      expect(backstopTextStatesSecret('-----BEGIN RSA PRIVATE KEY-----\nMIIE...')).toBe(true);
      expect(backstopTextStatesSecret('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')).toBe(true);
      expect(backstopTextStatesSecret('client_secret=super_secret_value_99')).toBe(true);
      expect(backstopTextStatesSecret('password: MyProdPassword2026!')).toBe(true);
      expect(backstopTextStatesSecret('enc:v1:YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4')).toBe(true);
      expect(
        backstopTextStatesSecret(
          '0123456789abcdef0123456789abcdef:fedcba9876543210fedcba9876543210:deadbeefcafebabe',
        ),
      ).toBe(true);

      // Benign business copy must NOT false-positive
      expect(backstopTextStatesSecret('Send password reset guide to customer')).toBe(false);
      expect(backstopTextStatesSecret('Update API key onboarding documentation')).toBe(false);
      expect(backstopTextStatesSecret('Client prefers Tuesday morning appointments')).toBe(false);

      // Mislabeled GENERAL row containing a secret is withheld even from OWNER
      const decision = evaluateMemoryClassAccess(
        {
          dataClass: 'GENERAL',
          moduleScope: [],
          backstopTexts: ['backup key: sk_live_51NxAbCdEfGhIjKlMnOpQr'],
        },
        OWNER_CTX,
      );
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('backstop_secret');
      expect(decision.effectiveDataClass).toBe('SECRET_BEARING');
    });

    it('SHADOW mode is crash-isolated and never logs row.key or memory text', () => {
      process.env.MEMORY_CLASS_READ = 'SHADOW';
      const throwingLogger = {
        warn: vi.fn(() => {
          throw new Error('logger boom');
        }),
        log: vi.fn(),
      };
      const rows = [
        {
          id: 'row_1',
          category: 'business_fact',
          key: 'SENSITIVE_KEY_NAME_DO_NOT_LOG',
          value: 'SECRET_MEMORY_VALUE_DO_NOT_LOG',
          dataClass: 'REVENUE',
          moduleScope: ['revenue'],
        },
      ];

      // Must NOT throw when logger fails in SHADOW
      const out = projectAiMemoryRowsForReader(rows, CRM_CTX, {
        businessId: 'biz_1',
        path: 'r1ShadowCrashTest',
        logger: throwingLogger,
      });
      expect(out).toHaveLength(1);

      // Must NOT throw when shadow evaluator itself fails
      const crashOut = runCrashIsolatedShadow({
        rows,
        store: 'ai_memory',
        path: 'r1ShadowEvalCrash',
        businessId: 'biz_1',
        readerPresent: true,
        logger: { warn: vi.fn(), log: vi.fn() },
        idOf: (r) => r.id,
        legacyFilter: () => true,
        evaluate: () => {
          throw new Error('eval boom');
        },
      });
      expect(crashOut).toHaveLength(1);

      // When row.id is missing, SHADOW logs 'unknown' and NEVER leaks row.key or row.value
      const logs: string[] = [];
      const captureLogger = { warn: (m: string) => logs.push(m), log: (m: string) => logs.push(m) };
      projectAiMemoryRowsForReader(
        [
          {
            category: 'business_fact',
            key: 'PRIVATE_KEY_LABEL_XYZ',
            value: 'PRIVATE_VALUE_ABC',
            dataClass: 'REVENUE',
            moduleScope: ['revenue'],
          },
        ],
        CRM_CTX,
        { businessId: 'biz_1', path: 'r1ShadowNoKey', logger: captureLogger },
      );
      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain('"id":"unknown"');
      expect(logs[0]).not.toContain('PRIVATE_KEY_LABEL_XYZ');
      expect(logs[0]).not.toContain('PRIVATE_VALUE_ABC');
    });

    it('evaluateSightOnlyAggregateAccess unconditionally denies PERSONAL rows', () => {
      const decision = evaluateSightOnlyAggregateAccess(
        { dataClass: 'PERSONAL', moduleScope: [] },
        OWNER_SIGHT,
      );
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('personal_sight_only_denied');
    });
  });

  describe('R1-4 & R1-5: Live caller isolation (getFullContext cache, Awareness SQL userId, Learning backstop)', () => {
    it('KeyCortexContextV2Service.getFullContext does not leak Owner temporalContext from Redis cache to STAFF', async () => {
      const now = new Date();
      const cache = new Map<string, string>();
      const redis = {
        get: vi.fn(async (k: string) => cache.get(k) ?? null),
        set: vi.fn(async (k: string, v: string) => {
          cache.set(k, v);
        }),
      };
      const cachedOwnerCtx = {
        businessId: 'biz_1',
        timestamp: now,
        crm: {},
        commerce: {},
        bookings: {},
        communications: {},
        autopilot: {},
        temporal: {
          recentMemories: [{ id: 'tm_rev', content: 'Owner confidential cadence', type: 'revenue_note', importance: 0.9, createdAt: now }],
          patternsDetected: [{ pattern: 'revenue_note', frequency: 1, confidence: 0.9, firstSeen: now, lastSeen: now }],
          contextWindow: 20,
        },
        inbox: {},
        genome: {},
        device: {},
        summary: {},
      };
      cache.set('key_cortex:context:biz_1', JSON.stringify(cachedOwnerCtx));

      const prisma = {
        client: {
          temporalFlowMemory: {
            findMany: vi.fn(async () => [
              {
                id: 'tm_rev',
                entityType: 'contact',
                entityId: 'c1',
                type: 'revenue_note',
                content: 'Owner confidential cadence',
                sourceModule: 'crm',
                sourceEventIds: [],
                metadata: {},
                confidence: 0.9,
                dataClass: 'REVENUE',
                moduleScope: ['revenue'],
                createdAt: now,
              },
              {
                id: 'tm_crm',
                entityType: 'contact',
                entityId: 'c1',
                type: 'summary',
                content: 'Prefers email updates',
                sourceModule: 'crm',
                sourceEventIds: [],
                metadata: {},
                confidence: 0.8,
                dataClass: 'GENERAL',
                moduleScope: ['crm'],
                createdAt: now,
              },
            ]),
          },
          temporalFlowEvent: { findMany: vi.fn(async () => []) },
        },
      };

      const svc = new KeyCortexContextV2Service(prisma as any, redis as any);
      const staffRes = await svc.getFullContext('biz_1', CRM_CTX);
      expect(staffRes.temporal.recentMemories.map((m) => m.id)).toEqual(['tm_crm']);
      expect(staffRes.temporal.patternsDetected.map((p) => p.pattern)).toEqual(['summary']);
    });

    it('KeyCortexAwarenessService pushes userId ownership filter into SQL WHERE clause', async () => {
      const findMany = vi.fn(async () => []);
      const svc = new KeyCortexAwarenessService({
        client: { keyCortexMemory: { findMany } },
      } as any);
      await svc.getAwareness('biz_1', {
        kinds: ['weakSignal'],
        readsRevenue: false,
        readerContext: CRM_CTX,
      });
      expect(findMany).toHaveBeenCalledTimes(1);
      const where = (findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
      expect(where.OR).toEqual([{ userId: null }, { userId: 'staff_crm' }]);
    });

    it('KeyCortexLearningService.retrieveLessons enforces money & secret backstop on own lessons', async () => {
      const now = new Date();
      const prisma = {
        client: {
          cognitionMemory: {
            findMany: vi.fn(async () => [
              {
                id: 'l_ok',
                userId: 'staff_crm',
                query: 'How to tag VIP contact?',
                recommendation: 'Apply VIP tag',
                userResponse: 'accepted',
                lessonsLearned: ['Tag VIP contacts after onboarding'],
                createdAt: now,
              },
              {
                id: 'l_money',
                userId: 'staff_crm',
                query: 'Check invoice $4,200 overdue',
                recommendation: 'Escalate billing',
                userResponse: 'accepted',
                lessonsLearned: ['Follow up on overdue invoice $4,200'],
                createdAt: now,
              },
              {
                id: 'l_secret',
                userId: 'staff_crm',
                query: 'Save key',
                recommendation: 'Store sk_live_51NxAbCdEfGhIjKlMnOpQr',
                userResponse: 'accepted',
                lessonsLearned: ['Never commit keys'],
                createdAt: now,
              },
            ]),
          },
        },
      };
      const svc = new KeyCortexLearningService(prisma as any);
      const crmLessons = await svc.retrieveLessons('biz_1', 'tag contact', {
        userId: 'staff_crm',
        readerContext: CRM_CTX,
      });
      expect(crmLessons).toEqual(['[accepted] Tag VIP contacts after onboarding']);

      // Even revenue-capable reader never sees secret-pattern lesson
      const revLessons = await svc.retrieveLessons('biz_1', 'invoice', {
        userId: 'staff_crm',
        readerContext: { reader: 'staff_crm', sight: REV_NO_EXP_SIGHT },
      });
      expect(revLessons).toHaveLength(2);
      expect(revLessons.join(' ')).not.toContain('sk_live_');
    });
  });

  describe('COR-R2-1: fetchProjectedBatch & TemporalFlowMemoryService.getStats always pass finite integer take and respect maxScanRows', () => {
    it('fetchProjectedBatch sanitizes non-finite/NaN targetCount, batchSize, and maxScanRows and never exceeds maxScanRows', async () => {
      const nanFetch = vi.fn(async () => [{ id: 'x' }]);
      expect(
        await fetchProjectedBatch({
          targetCount: Number.NaN,
          fetchPage: nanFetch,
          projectPage: (rows) => rows,
        }),
      ).toEqual([]);
      expect(
        await fetchProjectedBatch({
          targetCount: 0,
          fetchPage: nanFetch,
          projectPage: (rows) => rows,
        }),
      ).toEqual([]);
      expect(nanFetch).not.toHaveBeenCalled();

      const allRows = Array.from({ length: 250 }, (_, i) => ({ id: `row_${i}` }));
      const calls: Array<{ skip: number; take: number }> = [];
      const scanned = await fetchProjectedBatch({
        targetCount: Number.POSITIVE_INFINITY,
        batchSize: Number.POSITIVE_INFINITY,
        maxScanRows: 120,
        fetchPage: async (skip, take) => {
          calls.push({ skip, take });
          return allRows.slice(skip, skip + take);
        },
        projectPage: (rows) => rows,
      });

      // Fallback finite batchSize (100) then remaining budget (20); never Infinity, never > 120 rows scanned
      expect(calls).toEqual([
        { skip: 0, take: 100 },
        { skip: 100, take: 20 },
      ]);
      for (const c of calls) {
        expect(Number.isInteger(c.take)).toBe(true);
        expect(Number.isFinite(c.take)).toBe(true);
        expect(c.take).toBeGreaterThanOrEqual(1);
      }
      expect(scanned).toHaveLength(120);
    });

    it('TemporalFlowMemoryService.getStats passes finite integer take (never Infinity) to Prisma findMany and respects bounded pagination', async () => {
      const now = new Date();
      const rows = Array.from({ length: 260 }, (_, i) => ({
        id: `tf_${i}`,
        businessId: 'biz_1',
        entityType: 'contact',
        entityId: `c_${i}`,
        type: i % 2 === 0 ? 'summary' : 'insight',
        content: `CRM note ${i}`,
        sourceModule: 'crm',
        sourceEventIds: [],
        metadata: {},
        confidence: 0.9,
        dataClass: 'GENERAL',
        moduleScope: ['crm'],
        createdAt: now,
        updatedAt: now,
      }));
      const findManyCalls: Array<{ skip?: number; take?: number }> = [];
      const prisma = {
        client: {
          temporalFlowMemory: {
            findMany: vi.fn(async (args: { skip?: number; take?: number }) => {
              findManyCalls.push({ skip: args.skip, take: args.take });
              const start = args.skip ?? 0;
              return args.take !== undefined ? rows.slice(start, start + args.take) : rows.slice(start);
            }),
          },
          temporalFlowEvent: { findMany: vi.fn(async () => []) },
        },
      };
      const svc = new TemporalFlowMemoryService(prisma as any, {} as any);
      const stats = await svc.getStats('biz_1', CRM_CTX);

      expect(stats).toEqual({ total: 260, byType: { summary: 130, insight: 130 } });
      expect(findManyCalls).toEqual([
        { skip: undefined, take: 200 },
        { skip: 200, take: 200 },
      ]);
      for (const call of findManyCalls) {
        expect(Number.isFinite(call.take)).toBe(true);
        expect(Number.isInteger(call.take)).toBe(true);
      }
    });
  });
});

