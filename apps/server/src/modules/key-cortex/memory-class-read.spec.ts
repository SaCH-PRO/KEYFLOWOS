/**
 * P137 (MEM-CLASS-READ) — D-100, D-128, D-226, D-227, D-233, D-234, D-238, D-257
 *
 * Comprehensive specification suite for the single unified reader projection
 * deciding every memory read by `data_class`, `module_scope`, ownership,
 * read-time classification of legacy `data_class IS NULL` rows, fail-closed
 * word-heuristic backstop, filter-before-rank differential invariance, and the
 * `MEMORY_CLASS_READ=OFF|SHADOW|ACTIVE` rollout flag.
 *
 * Covers EVALUATION-PLAN.md §3 (`E-REV-DIRECT`, `E-REV-INDIRECT`, differential
 * invariance 0 vs 50 REVENUE items, multi-module scope, SECRET_BEARING,
 * PERSONAL ownership, legacy NULL classification, OWNER/revenue:read invariance,
 * and every active read path registered in MEM-CENSUS).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { CanonicalModule } from '../../core/authority/module-vocabulary';
import {
  readersOwnPromptMemory,
  type ModuleSight,
} from './key-cortex-prompt-context.service';
import { UnifiedMemoryRetrievalService } from './unified-memory-retrieval.service';
import { semanticHitsVisibleTo } from '../ai/semantic-memory-sight';
import { AiMemoryService } from '../ai/ai-memory.service';
import { AgentController } from '../ai/agent.controller';
import { ProactiveSuggestionService } from '../ai/proactive-suggestion.service';
import { TemporalFlowMemoryService } from '../temporal-flow/temporal-flow-memory.service';
import { KeyCortexContextV2Service } from './key-cortex-context-v2.service';
import { KeyCortexLearningService } from './key-cortex-learning.service';
import { KeyCortexAwarenessService } from './key-cortex-awareness.service';
import { KeyCortexSalienceService } from './key-cortex-salience.service';

const STAFF_NO_REV_SIGHT: ModuleSight = (m: CanonicalModule) =>
  m === 'crm' || m === 'bookings' || m === 'operations';

const STAFF_CRM_ONLY_SIGHT: ModuleSight = (m: CanonicalModule) => m === 'crm';

const STAFF_REV_NO_EXP_SIGHT: ModuleSight = (m: CanonicalModule) =>
  m === 'crm' || m === 'bookings' || m === 'revenue';

const STAFF_REV_AND_EXP_SIGHT: ModuleSight = (m: CanonicalModule) =>
  m === 'crm' || m === 'bookings' || m === 'revenue' || m === 'expenses';

const OWNER_SIGHT: ModuleSight = () => true;

const MEMBERSHIPS: Record<string, { role: string; permissionScopes: Record<string, string> | null }> = {
  staff_no_rev: {
    role: 'STAFF',
    permissionScopes: { crm: 'read', bookings: 'read', operations: 'read', revenue: 'none', expenses: 'none' },
  },
  staff_crm_only: {
    role: 'STAFF',
    permissionScopes: { crm: 'read', bookings: 'none', operations: 'none', revenue: 'none', expenses: 'none' },
  },
  staff_rev: {
    role: 'STAFF',
    permissionScopes: { crm: 'read', bookings: 'read', revenue: 'read', expenses: 'none' },
  },
  staff_rev_exp: {
    role: 'STAFF',
    permissionScopes: { crm: 'read', bookings: 'read', revenue: 'read', expenses: 'read' },
  },
  owner_1: {
    role: 'OWNER',
    permissionScopes: null,
  },
};

function makeMembershipPrisma(extra: Record<string, unknown> = {}) {
  return {
    client: {
      membership: {
        findUnique: vi.fn(async ({ where }: { where: { userId_businessId: { userId: string; businessId: string } } }) =>
          where.userId_businessId.businessId === 'biz_1'
            ? MEMBERSHIPS[where.userId_businessId.userId] ?? null
            : null,
        ),
      },
      cognitionMemory: { findMany: vi.fn(async () => []) },
      keyActionProposal: { findMany: vi.fn(async () => []) },
      aiMemory: { findMany: vi.fn(async () => []) },
      temporalFlowMemory: { findMany: vi.fn(async () => []) },
      temporalFlowEvent: { findMany: vi.fn(async () => []) },
      knowledgeSource: { findMany: vi.fn(async () => []) },
      ...extra,
    },
  };
}

/**
 * Minimal Prisma `where` evaluator for in-memory table mocks so differential
 * invariance tests faithfully simulate Postgres `WHERE` + `ORDER BY` + `TAKE`.
 */
function matchesPrismaWhere(row: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'AND') {
      const clauses = Array.isArray(cond) ? cond : [cond];
      if (!clauses.every((c) => matchesPrismaWhere(row, c as Record<string, unknown>))) return false;
      continue;
    }
    if (key === 'OR') {
      const clauses = Array.isArray(cond) ? cond : [cond];
      if (!clauses.some((c) => matchesPrismaWhere(row, c as Record<string, unknown>))) return false;
      continue;
    }
    if (key === 'NOT') {
      const clauses = Array.isArray(cond) ? cond : [cond];
      if (clauses.some((c) => matchesPrismaWhere(row, c as Record<string, unknown>))) return false;
      continue;
    }
    const val = row[key];
    if (cond === null || typeof cond !== 'object' || cond instanceof Date) {
      if (val !== cond) return false;
      continue;
    }
    const op = cond as Record<string, unknown>;
    if ('in' in op) {
      if (!Array.isArray(op.in) || !op.in.includes(val)) return false;
    }
    if ('notIn' in op) {
      if (Array.isArray(op.notIn) && op.notIn.includes(val)) return false;
    }
    if ('hasSome' in op) {
      const arr = Array.isArray(val) ? val : [];
      const wanted = Array.isArray(op.hasSome) ? op.hasSome : [];
      if (!wanted.some((w) => arr.includes(w))) return false;
    }
    if ('gte' in op) {
      const target = op.gte instanceof Date ? op.gte.getTime() : Number(op.gte);
      const actual = val instanceof Date ? val.getTime() : Number(val);
      if (!(actual >= target)) return false;
    }
    if ('gt' in op) {
      if (val === null || val === undefined) return false;
      const target = op.gt instanceof Date ? op.gt.getTime() : Number(op.gt);
      const actual = val instanceof Date ? val.getTime() : Number(val);
      if (!(actual > target)) return false;
    }
    if ('isEmpty' in op) {
      const arr = Array.isArray(val) ? val : [];
      if (op.isEmpty === false && arr.length === 0) return false;
      if (op.isEmpty === true && arr.length > 0) return false;
    }
  }
  return true;
}

async function loadProjectionModule(): Promise<Record<string, any>> {
  const modPath = './memory-class-read-projection';
  return import(/* @vite-ignore */ modPath);
}

describe('P137 (MEM-CLASS-READ): unified reader projection contract', () => {
  const savedFlag = process.env.MEMORY_CLASS_READ;

  beforeEach(() => {
    delete process.env.MEMORY_CLASS_READ;
  });

  afterEach(() => {
    if (savedFlag === undefined) delete process.env.MEMORY_CLASS_READ;
    else process.env.MEMORY_CLASS_READ = savedFlag;
  });

  describe('Core projection rules (data_class, module_scope, PERSONAL, SECRET_BEARING, backstop)', () => {
    it('exports getMemoryClassReadMode with OFF|SHADOW|ACTIVE and defaults fail-closed to ACTIVE', async () => {
      const proj = await loadProjectionModule();
      expect(proj.getMemoryClassReadMode({})).toBe('ACTIVE');
      expect(proj.getMemoryClassReadMode({ MEMORY_CLASS_READ: '' })).toBe('ACTIVE');
      expect(proj.getMemoryClassReadMode({ MEMORY_CLASS_READ: 'off' })).toBe('OFF');
      expect(proj.getMemoryClassReadMode({ MEMORY_CLASS_READ: 'SHADOW' })).toBe('SHADOW');
      expect(proj.getMemoryClassReadMode({ MEMORY_CLASS_READ: 'active' })).toBe('ACTIVE');
      expect(proj.getMemoryClassReadMode({ MEMORY_CLASS_READ: 'bogus_value' })).toBe('ACTIVE');
    });

    it('SECRET_BEARING is ALWAYS withheld even from OWNER and revenue:read readers', async () => {
      const proj = await loadProjectionModule();
      const input = {
        dataClass: 'SECRET_BEARING',
        moduleScope: ['ai', 'settings'],
        backstopTexts: ['opaque encrypted payload'],
      };
      expect(proj.evaluateMemoryClassAccess(input, { reader: 'owner_1', sight: OWNER_SIGHT }).allowed).toBe(false);
      expect(proj.evaluateMemoryClassAccess(input, { reader: 'staff_rev_exp', sight: STAFF_REV_AND_EXP_SIGHT }).allowed).toBe(false);
      expect(proj.evaluateMemoryClassAccess(input, { reader: 'staff_no_rev', sight: STAFF_NO_REV_SIGHT }).allowed).toBe(false);
      expect(proj.evaluateMemoryClassAccess(input, { reader: null, sight: OWNER_SIGHT }).allowed).toBe(false);
    });

    it('E-REV-DIRECT: data_class=REVENUE with ZERO financial keywords is withheld from STAFF without revenue:read, visible to OWNER & revenue:read', async () => {
      const proj = await loadProjectionModule();
      const input = {
        dataClass: 'REVENUE',
        moduleScope: [] as CanonicalModule[],
        backstopTexts: ['Client prefers Tuesday morning check-ins'],
      };
      expect(proj.evaluateMemoryClassAccess(input, { reader: 'staff_no_rev', sight: STAFF_NO_REV_SIGHT }).allowed).toBe(false);
      expect(proj.evaluateMemoryClassAccess(input, { reader: null, sight: OWNER_SIGHT }).allowed).toBe(false);
      expect(proj.evaluateMemoryClassAccess(input, { reader: 'staff_rev', sight: STAFF_REV_NO_EXP_SIGHT }).allowed).toBe(true);
      expect(proj.evaluateMemoryClassAccess(input, { reader: 'owner_1', sight: OWNER_SIGHT }).allowed).toBe(true);
    });

    it('module_scope requires EVERY listed module at read level', async () => {
      const proj = await loadProjectionModule();
      const input = {
        dataClass: 'GENERAL',
        moduleScope: ['crm', 'bookings'] as CanonicalModule[],
        backstopTexts: ['VIP guest likes window seating'],
      };
      expect(proj.evaluateMemoryClassAccess(input, { reader: 'staff_crm_only', sight: STAFF_CRM_ONLY_SIGHT }).allowed).toBe(false);
      expect(proj.evaluateMemoryClassAccess(input, { reader: 'staff_no_rev', sight: STAFF_NO_REV_SIGHT }).allowed).toBe(true);
      expect(proj.evaluateMemoryClassAccess(input, { reader: 'owner_1', sight: OWNER_SIGHT }).allowed).toBe(true);
    });

    it('PERSONAL requires owning member on stores with owner column (CognitionMemory, KeyCortexMemory)', async () => {
      const proj = await loadProjectionModule();
      const ownedByStaff = {
        dataClass: 'PERSONAL',
        moduleScope: [] as CanonicalModule[],
        hasOwnerColumn: true,
        ownerUserId: 'staff_no_rev',
        backstopTexts: ['Prefers concise summaries'],
      };
      expect(proj.evaluateMemoryClassAccess(ownedByStaff, { reader: 'staff_no_rev', sight: STAFF_NO_REV_SIGHT }).allowed).toBe(true);
      // Even OWNER cannot read another member's PERSONAL row on a member-owned store
      expect(proj.evaluateMemoryClassAccess(ownedByStaff, { reader: 'owner_1', sight: OWNER_SIGHT }).allowed).toBe(false);
      // Memberless row on a member-owned store is nobody's own
      expect(
        proj.evaluateMemoryClassAccess(
          { ...ownedByStaff, ownerUserId: null },
          { reader: 'owner_1', sight: OWNER_SIGHT },
        ).allowed,
      ).toBe(false);
    });

    it('UNCLASSIFIED fails closed for restricted and memberless readers, allowed for full-sight OWNER', async () => {
      const proj = await loadProjectionModule();
      const input = {
        dataClass: 'UNCLASSIFIED',
        moduleScope: [] as CanonicalModule[],
        backstopTexts: ['Legacy opaque note with no obvious keywords'],
      };
      expect(proj.evaluateMemoryClassAccess(input, { reader: 'staff_no_rev', sight: STAFF_NO_REV_SIGHT }).allowed).toBe(false);
      expect(proj.evaluateMemoryClassAccess(input, { reader: 'staff_rev', sight: STAFF_REV_NO_EXP_SIGHT }).allowed).toBe(false);
      expect(proj.evaluateMemoryClassAccess(input, { reader: null, sight: OWNER_SIGHT }).allowed).toBe(false);
      expect(proj.evaluateMemoryClassAccess(input, { reader: 'owner_1', sight: OWNER_SIGHT }).allowed).toBe(true);
    });

    it('fail-closed word-heuristic backstop blocks mistagged GENERAL rows that state money or expenses', async () => {
      const proj = await loadProjectionModule();
      const mistaggedMoney = {
        dataClass: 'GENERAL',
        moduleScope: [] as CanonicalModule[],
        backstopTexts: ['Overdue invoice INV-77 for $12,400 due Friday'],
      };
      expect(proj.evaluateMemoryClassAccess(mistaggedMoney, { reader: 'staff_no_rev', sight: STAFF_NO_REV_SIGHT }).allowed).toBe(false);
      expect(proj.evaluateMemoryClassAccess(mistaggedMoney, { reader: 'staff_rev', sight: STAFF_REV_NO_EXP_SIGHT }).allowed).toBe(true);

      const mistaggedExpense = {
        dataClass: 'GENERAL',
        moduleScope: [] as CanonicalModule[],
        backstopTexts: ['Monthly office rent bill is due on the 1st'],
      };
      expect(proj.evaluateMemoryClassAccess(mistaggedExpense, { reader: 'staff_rev', sight: STAFF_REV_NO_EXP_SIGHT }).allowed).toBe(false);
      expect(proj.evaluateMemoryClassAccess(mistaggedExpense, { reader: 'staff_rev_exp', sight: STAFF_REV_AND_EXP_SIGHT }).allowed).toBe(true);
    });

    it('legacy data_class=null rows: ordinary tone/goals/priorities/corrections stay visible; legacy financial & ambiguous fail closed', async () => {
      const proj = await loadProjectionModule();
      const rows = [
        { id: 'r_tone', category: 'tone', key: 'preferred', value: 'Warm and direct', source: 'user', dataClass: null, moduleScope: [] },
        { id: 'r_goals', category: 'goals', key: 'q4', value: 'Launch mobile app', source: 'user', dataClass: null, moduleScope: [] },
        { id: 'r_prio', category: 'priorities', key: 'p1', value: 'Faster booking replies', source: 'user', dataClass: null, moduleScope: [] },
        { id: 'r_corr', category: 'corrections', key: 'style', value: 'Keep answers under 3 bullets', source: 'user', dataClass: null, moduleScope: [] },
        { id: 'r_fin_cat', category: 'financial', key: 'summary', value: 'Client tier A', source: 'inferred', dataClass: null, moduleScope: [] },
        { id: 'r_doc_ext', category: 'document_extraction', key: 'doc_9', value: 'Extracted summary', source: 'inferred', dataClass: null, moduleScope: [] },
        { id: 'r_ambig', category: 'legacy_opaque_bucket', key: 'k1', value: 'Opaque note', source: 'inferred', dataClass: null, moduleScope: [] },
      ];

      const staffKept = proj
        .projectAiMemoryRowsForReader(rows, { reader: 'staff_no_rev', sight: STAFF_NO_REV_SIGHT })
        .map((r: { id: string }) => r.id);
      expect(staffKept).toEqual(['r_tone', 'r_goals', 'r_prio', 'r_corr']);

      const ownerKept = proj
        .projectAiMemoryRowsForReader(rows, { reader: 'owner_1', sight: OWNER_SIGHT })
        .map((r: { id: string }) => r.id);
      expect(ownerKept).toEqual(['r_tone', 'r_goals', 'r_prio', 'r_corr', 'r_fin_cat', 'r_doc_ext', 'r_ambig']);
    });
  });

  describe('MEMORY_CLASS_READ=OFF|SHADOW|ACTIVE rollout flag semantics', () => {
    it('OFF preserves legacy behavior, SHADOW logs structured diff without memory text and returns legacy output, ACTIVE enforces unified projection', async () => {
      const proj = await loadProjectionModule();
      const secretText = 'ULTRA_CONFIDENTIAL_PHRASE_XYZ_9981';
      const rows = [
        { id: 'm_gen', category: 'goals', key: 'g1', value: 'Open second studio', source: 'user', dataClass: 'GENERAL', moduleScope: [] },
        { id: 'm_rev_stealth', category: 'business_fact', key: 'k_stealth', value: secretText, source: 'inferred', dataClass: 'REVENUE', moduleScope: ['revenue'] },
      ];
      // Legacy filter only checks text heuristics (misses m_rev_stealth because it has no money words)
      const legacyFilter = () => true;
      const warn = vi.fn();
      const log = vi.fn();

      process.env.MEMORY_CLASS_READ = 'OFF';
      const offResult = proj.projectAiMemoryRowsForReader(
        rows,
        { reader: 'staff_no_rev', sight: STAFF_NO_REV_SIGHT },
        { businessId: 'biz_1', path: 'test.ai_memory', logger: { warn, log }, legacyFilter },
      );
      expect(offResult.map((r: { id: string }) => r.id)).toEqual(['m_gen', 'm_rev_stealth']);
      expect(warn).not.toHaveBeenCalled();

      process.env.MEMORY_CLASS_READ = 'SHADOW';
      const shadowResult = proj.projectAiMemoryRowsForReader(
        rows,
        { reader: 'staff_no_rev', sight: STAFF_NO_REV_SIGHT },
        { businessId: 'biz_1', path: 'test.ai_memory', logger: { warn, log }, legacyFilter },
      );
      // SHADOW returns legacy output unchanged
      expect(shadowResult.map((r: { id: string }) => r.id)).toEqual(['m_gen', 'm_rev_stealth']);
      // SHADOW logs structured diff counts/ids/classes and NEVER logs memory content/PII
      expect(warn).toHaveBeenCalledTimes(1);
      const logged = String(warn.mock.calls[0][0]);
      expect(logged).toContain('memory_class_read_shadow_diff');
      expect(logged).toContain('m_rev_stealth');
      expect(logged).toContain('REVENUE');
      expect(logged).not.toContain(secretText);

      process.env.MEMORY_CLASS_READ = 'ACTIVE';
      const activeResult = proj.projectAiMemoryRowsForReader(
        rows,
        { reader: 'staff_no_rev', sight: STAFF_NO_REV_SIGHT },
        { businessId: 'biz_1', path: 'test.ai_memory', logger: { warn, log }, legacyFilter },
      );
      expect(activeResult.map((r: { id: string }) => r.id)).toEqual(['m_gen']);
    });
  });

  describe('Path: UnifiedMemoryRetrievalService — filter before rank & differential invariance (0 vs 50 REVENUE items)', () => {
    it('STAFF without revenue:read gets EXACT IDENTICAL output (items, order, scores, count) with 0 vs 50 REVENUE AiMemory items', async () => {
      const baseTime = new Date('2026-11-20T12:00:00.000Z').getTime();
      const generalRows = Array.from({ length: 5 }, (_, i) => ({
        id: `gen_${i}`,
        businessId: 'biz_1',
        category: 'goals',
        key: `goal_${i}`,
        value: `Deliver workshop cohort ${i}`,
        source: 'user',
        confidence: 0.7 + i * 0.05,
        expiresAt: null,
        dataClass: 'GENERAL',
        moduleScope: [] as string[],
        createdAt: new Date(baseTime - (10 - i) * 3600_000),
      }));
      const revenueRows = Array.from({ length: 50 }, (_, i) => ({
        id: `rev_${i}`,
        businessId: 'biz_1',
        category: 'business_fact',
        key: `client_note_${i}`,
        // Zero financial keywords — only structural dataClass='REVENUE' identifies it!
        value: `Client cohort ${i} prefers Tuesday check-ins`,
        source: 'inferred',
        confidence: 1.0,
        expiresAt: null,
        dataClass: 'REVENUE',
        moduleScope: ['revenue'],
        // Newer than all generalRows so an unprojected take:50 would completely crowd them out!
        createdAt: new Date(baseTime + (i + 1) * 60_000),
      }));

      const runWithRows = async (aiRows: typeof generalRows) => {
        const prisma = {
          client: {
            aiMemory: {
              findMany: vi.fn(async (args: { where?: Record<string, unknown>; take?: number; skip?: number }) => {
                const matched = aiRows
                  .filter((r) => matchesPrismaWhere(r as unknown as Record<string, unknown>, args.where))
                  .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
                const start = args.skip ?? 0;
                return args.take !== undefined ? matched.slice(start, start + args.take) : matched.slice(start);
              }),
            },
            genomeMemoryEvent: { findMany: vi.fn(async () => []) },
            temporalFlowMemory: { findMany: vi.fn(async () => []) },
            cognitionMemory: { findMany: vi.fn(async () => []) },
            cognitiveEvent: { findMany: vi.fn(async () => []) },
            businessEvent: { findMany: vi.fn(async () => []) },
            aiExecutionLog: { findMany: vi.fn(async () => []) },
            cortexActionLog: { findMany: vi.fn(async () => []) },
          },
        };
        const service = new UnifiedMemoryRetrievalService(prisma as any, { search: vi.fn(async () => []) } as any);
        return service.retrieveContext('biz_1', {
          limit: 5,
          boostRecency: false,
          userId: 'staff_no_rev',
          readerContext: { reader: 'staff_no_rev', sight: STAFF_NO_REV_SIGHT },
        } as any);
      };

      const fixedNow = baseTime + 2 * 3600_000;
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(fixedNow);
      try {
        const withZero = await runWithRows(generalRows);
        const withFifty = await runWithRows([...generalRows, ...revenueRows]);

        expect(withZero).toHaveLength(5);
        expect(withFifty).toHaveLength(5);
        expect(withFifty.map((f) => f.id)).toEqual(withZero.map((f) => f.id));
        expect(withFifty).toEqual(withZero);
        for (const f of withFifty) {
          expect(f.id.startsWith('rev_')).toBe(false);
        }
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('E-REV-DIRECT on UnifiedMemoryRetrievalService: excludes SECRET_BEARING even for OWNER and enforces module_scope + PERSONAL CognitionMemory', async () => {
      const now = new Date();
      const aiRows = [
        { id: 'sec_1', businessId: 'biz_1', category: 'business_fact', key: 'k_sec', value: 'sk-live-secret', source: 'user', confidence: 1, expiresAt: null, dataClass: 'SECRET_BEARING', moduleScope: ['ai'], createdAt: now },
        { id: 'mod_1', businessId: 'biz_1', category: 'business_fact', key: 'k_mod', value: 'VIP guest table preference', source: 'user', confidence: 0.9, expiresAt: null, dataClass: 'GENERAL', moduleScope: ['crm', 'bookings'], createdAt: now },
        { id: 'rev_1', businessId: 'biz_1', category: 'business_fact', key: 'k_rev', value: 'Top client cadence', source: 'inferred', confidence: 0.95, expiresAt: null, dataClass: 'REVENUE', moduleScope: ['revenue'], createdAt: now },
      ];
      const cogRows = [
        { id: 'cog_own', businessId: 'biz_1', userId: 'staff_crm_only', roleId: null, query: 'How to tag lead?', recommendation: 'Use tag VIP', userResponse: 'accepted', confidence: 0.9, lessonsLearned: ['Tag VIP'], createdAt: now, metadata: {} },
        { id: 'cog_other', businessId: 'biz_1', userId: 'owner_1', roleId: null, query: 'Owner P&L review', recommendation: 'Hold margin', userResponse: 'accepted', confidence: 0.95, lessonsLearned: ['Hold margin'], createdAt: now, metadata: {} },
      ];
      const makeService = () => {
        const prisma = {
          client: {
            aiMemory: {
              findMany: vi.fn(async (args: { where?: Record<string, unknown> }) =>
                aiRows.filter((r) => matchesPrismaWhere(r as unknown as Record<string, unknown>, args.where)),
              ),
            },
            genomeMemoryEvent: { findMany: vi.fn(async () => []) },
            temporalFlowMemory: { findMany: vi.fn(async () => []) },
            cognitionMemory: {
              findMany: vi.fn(async (args: { where?: Record<string, unknown> }) =>
                cogRows.filter((r) => matchesPrismaWhere(r as unknown as Record<string, unknown>, args.where)),
              ),
            },
            cognitiveEvent: { findMany: vi.fn(async () => []) },
            businessEvent: { findMany: vi.fn(async () => []) },
            aiExecutionLog: { findMany: vi.fn(async () => []) },
            cortexActionLog: { findMany: vi.fn(async () => []) },
          },
        };
        return new UnifiedMemoryRetrievalService(prisma as any, { search: vi.fn(async () => []) } as any);
      };

      const ownerFragments = await makeService().retrieveContext('biz_1', {
        userId: 'owner_1',
        readerContext: { reader: 'owner_1', sight: OWNER_SIGHT },
      } as any);
      const ownerIds = ownerFragments.map((f) => f.id);
      expect(ownerIds).not.toContain('sec_1');
      expect(ownerIds).toContain('rev_1');
      expect(ownerIds).toContain('mod_1');
      expect(ownerIds).toContain('cog_other');
      expect(ownerIds).not.toContain('cog_own');

      const crmOnlyFragments = await makeService().retrieveContext('biz_1', {
        userId: 'staff_crm_only',
        readerContext: { reader: 'staff_crm_only', sight: STAFF_CRM_ONLY_SIGHT },
      } as any);
      const crmOnlyIds = crmOnlyFragments.map((f) => f.id);
      expect(crmOnlyIds).not.toContain('sec_1');
      expect(crmOnlyIds).not.toContain('rev_1');
      // mod_1 requires BOTH crm and bookings
      expect(crmOnlyIds).not.toContain('mod_1');
      expect(crmOnlyIds).toContain('cog_own');
      expect(crmOnlyIds).not.toContain('cog_other');
    });
  });

  describe('Path: KeyCortexPromptContextService.readersOwnPromptMemory', () => {
    it('E-REV-DIRECT & E-REV-INDIRECT: withholds REVENUE-tagged AiMemory and TemporalFlowMemory even with zero financial words, withholds SECRET_BEARING from OWNER, preserves ordinary GENERAL rows', async () => {
      const prisma = makeMembershipPrisma();
      const fragments = [
        {
          id: 'am_gen',
          sourceType: 'ai_memory' as const,
          title: 'tone',
          content: 'tone.preferred: friendly',
          metadata: { __memoryClass: { store: 'ai_memory', dataClass: 'GENERAL', moduleScope: [] } },
        },
        {
          id: 'am_rev_stealth',
          sourceType: 'ai_memory' as const,
          title: 'business_fact',
          content: 'business_fact.cadence: Client prefers Tuesday check-ins',
          metadata: { __memoryClass: { store: 'ai_memory', dataClass: 'REVENUE', moduleScope: ['revenue'] } },
        },
        {
          id: 'am_secret',
          sourceType: 'ai_memory' as const,
          title: 'business_fact',
          content: 'business_fact.key_ref: encrypted-token',
          metadata: { __memoryClass: { store: 'ai_memory', dataClass: 'SECRET_BEARING', moduleScope: ['ai'] } },
        },
        {
          id: 'tf_rev_stealth',
          sourceType: 'temporal_flow_memory' as const,
          title: 'summary',
          entityType: 'contact',
          content: 'Frequent Tuesday check-ins with Account Alpha',
          metadata: { __memoryClass: { store: 'temporal_flow_memory', dataClass: 'REVENUE', moduleScope: ['crm', 'revenue'] } },
        },
        {
          id: 'tf_crm_ok',
          sourceType: 'temporal_flow_memory' as const,
          title: 'summary',
          entityType: 'contact',
          content: 'Contact prefers WhatsApp replies',
          metadata: { __memoryClass: { store: 'temporal_flow_memory', dataClass: 'GENERAL', moduleScope: ['crm'] } },
        },
      ];

      const staffKept = (await readersOwnPromptMemory(prisma as any, 'biz_1', 'staff_no_rev', fragments, 20)).map((f) => f.id);
      expect(staffKept).toEqual(['am_gen', 'tf_crm_ok']);

      const ownerKept = (await readersOwnPromptMemory(prisma as any, 'biz_1', 'owner_1', fragments, 20)).map((f) => f.id);
      expect(ownerKept).toEqual(['am_gen', 'am_rev_stealth', 'tf_rev_stealth', 'tf_crm_ok']);
      expect(ownerKept).not.toContain('am_secret');
    });

    it('memberless turns keep D-226/D-238 proposal rendering (memberlessProposalView) while withholding REVENUE/PERSONAL/SECRET_BEARING', async () => {
      const prisma = makeMembershipPrisma({
        keyActionProposal: {
          findMany: vi.fn(async () => [
            { id: 'kap_ok', carriesMoney: false, actionType: 'CREATE_TASK', module: 'crm', toolName: null, title: 'Follow up with Ada' },
          ]),
        },
      });
      const fragments = [
        {
          id: 'gov_ok',
          sourceType: 'business_event' as const,
          title: 'GOVERNANCE_DECISION',
          entityType: 'key_action_proposal',
          entityId: 'kap_ok',
          content: 'Sensitive full title that must be stripped for memberless',
          metadata: { action: 'PROPOSED', after: { status: 'PENDING', riskLevel: 'LOW' } },
        },
        {
          id: 'am_rev',
          sourceType: 'ai_memory' as const,
          title: 'business_fact',
          content: 'business_fact.k: Benign text tagged REVENUE',
          metadata: { __memoryClass: { store: 'ai_memory', dataClass: 'REVENUE', moduleScope: ['revenue'] } },
        },
      ];

      const kept = await readersOwnPromptMemory(prisma as any, 'biz_1', null, fragments, 10);
      expect(kept.map((f) => f.id)).toEqual(['gov_ok']);
      expect(kept[0].content).toBe('proposal PROPOSED, status PENDING, risk LOW');
    });
  });

  describe('Path: SemanticMemoryService / semanticHitsVisibleTo (AiMemoryEmbedding)', () => {
    it('E-REV-INDIRECT: inherits REVENUE and module_scope from embedding & source row even with zero financial keywords, blocks SECRET_BEARING from OWNER', async () => {
      const prisma = makeMembershipPrisma({
        aiMemory: {
          findMany: vi.fn(async () => [
            { id: 'am_1', category: 'business_fact', key: 'cadence', value: 'Tuesday check-ins', source: 'inferred', dataClass: 'REVENUE', moduleScope: ['revenue'] },
            { id: 'am_2', category: 'tone', key: 'preferred', value: 'Friendly', source: 'user', dataClass: 'GENERAL', moduleScope: [] },
            { id: 'am_3', category: 'business_fact', key: 'secret', value: 'Secret key', source: 'user', dataClass: 'SECRET_BEARING', moduleScope: ['ai'] },
          ]),
        },
        temporalFlowMemory: {
          findMany: vi.fn(async () => [
            {
              id: 'tf_1',
              entityType: 'contact',
              entityId: 'c_1',
              type: 'summary',
              sourceModule: 'crm',
              sourceEventIds: [],
              metadata: {},
              content: 'Account Alpha cadence note',
              dataClass: 'REVENUE',
              moduleScope: ['crm', 'revenue'],
            },
          ]),
        },
      });

      const hits = [
        { sourceType: 'memory', sourceId: 'am_1', content: 'Tuesday check-ins', dataClass: 'REVENUE', moduleScope: ['revenue'] },
        { sourceType: 'memory', sourceId: 'am_2', content: 'Friendly', dataClass: 'GENERAL', moduleScope: [] },
        { sourceType: 'memory', sourceId: 'am_3', content: 'Secret key', dataClass: 'SECRET_BEARING', moduleScope: ['ai'] },
        { sourceType: 'temporal_memory', sourceId: 'tf_1', content: 'contact:summary — Account Alpha cadence note', dataClass: 'REVENUE', moduleScope: ['crm', 'revenue'] },
      ] as any;

      const staffVis = await semanticHitsVisibleTo(prisma as any, 'biz_1', { reader: 'staff_no_rev', sight: STAFF_NO_REV_SIGHT }, hits);
      expect(staffVis).toEqual([false, true, false, false]);

      const ownerVis = await semanticHitsVisibleTo(prisma as any, 'biz_1', { reader: 'owner_1', sight: OWNER_SIGHT }, hits);
      expect(ownerVis).toEqual([true, true, false, true]);
    });
  });

  describe('Path: AiMemoryService, AgentController.getDetectedPatterns, ProactiveSuggestionService', () => {
    it('AiMemoryService.getAll / getByCategory / get / buildContextBlock enforce unified projection when readerContext is provided', async () => {
      const now = new Date();
      const rows = [
        { id: 'm1', businessId: 'biz_1', category: 'goals', key: 'g1', value: 'Ship app', confidence: 1, source: 'user', expiresAt: null, dataClass: 'GENERAL', moduleScope: [], createdAt: now, updatedAt: now },
        { id: 'm2', businessId: 'biz_1', category: 'goals', key: 'g2', value: 'Client check-in cadence', confidence: 1, source: 'inferred', expiresAt: null, dataClass: 'REVENUE', moduleScope: ['revenue'], createdAt: now, updatedAt: now },
        { id: 'm3', businessId: 'biz_1', category: 'goals', key: 'g3', value: 'Vault secret', confidence: 1, source: 'user', expiresAt: null, dataClass: 'SECRET_BEARING', moduleScope: ['ai'], createdAt: now, updatedAt: now },
      ];
      const prisma = {
        client: {
          aiMemory: {
            findMany: vi.fn(async () => rows),
            findUnique: vi.fn(async ({ where }: any) => rows.find((r) => r.key === where.businessId_category_key.key) ?? null),
          },
        },
      };
      const blueprint = { getBlueprint: vi.fn(async () => null) };
      const svc = new AiMemoryService(prisma as any, {} as any, blueprint as any);

      const staffAll = await (svc as any).getAll('biz_1', { reader: 'staff_no_rev', sight: STAFF_NO_REV_SIGHT });
      expect(staffAll.map((r: any) => r.id)).toEqual(['m1']);

      const ownerAll = await (svc as any).getAll('biz_1', { reader: 'owner_1', sight: OWNER_SIGHT });
      expect(ownerAll.map((r: any) => r.id)).toEqual(['m1', 'm2']);

      const staffSingle = await (svc as any).get('biz_1', 'goals', 'g2', { reader: 'staff_no_rev', sight: STAFF_NO_REV_SIGHT });
      expect(staffSingle).toBeNull();

      const block = await (svc as any).buildContextBlock('biz_1', { readerContext: { reader: 'staff_no_rev', sight: STAFF_NO_REV_SIGHT } });
      expect(block.goals).toEqual(['Ship app']);
    });

    it('AgentController.getDetectedPatterns projects patterns by reader sight and withholds REVENUE patterns with no money keywords', async () => {
      const now = new Date();
      const patternRows = [
        { id: 'p_ok', businessId: 'biz_1', category: 'patterns', key: 'booking_rush', value: JSON.stringify({ title: 'Friday rush' }), confidence: 0.9, source: 'pattern_analysis', dataClass: 'GENERAL', moduleScope: ['bookings'], createdAt: now },
        { id: 'p_rev', businessId: 'biz_1', category: 'patterns', key: 'cohort_cadence', value: JSON.stringify({ title: 'Tuesday cadence' }), confidence: 0.95, source: 'pattern_analysis', dataClass: 'REVENUE', moduleScope: ['revenue'], createdAt: now },
      ];
      const prisma = makeMembershipPrisma({
        aiMemory: {
          findMany: vi.fn(async (args: { where?: Record<string, unknown> }) =>
            patternRows.filter((r) => matchesPrismaWhere(r as unknown as Record<string, unknown>, args.where)),
          ),
        },
      });
      const controller = new AgentController(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        prisma as any,
      );

      const staffRes = await (controller as any).getDetectedPatterns('biz_1', { user: { id: 'staff_no_rev' } });
      expect(staffRes.patterns.map((p: any) => p.id)).toEqual(['p_ok']);

      const ownerRes = await (controller as any).getDetectedPatterns('biz_1', { user: { id: 'owner_1' } });
      expect(ownerRes.patterns.map((p: any) => p.id)).toEqual(['p_ok', 'p_rev']);
    });

    it('ProactiveSuggestionService.getPendingSuggestions filters REVENUE suggestions before slicing to limit', async () => {
      const now = new Date();
      const rows = [
        { id: 's_rev', businessId: 'biz_1', category: 'suggestion', key: 'cohort_1', value: JSON.stringify({ id: 's_rev', category: 'cohort', title: 'Review cadence', message: 'Check Tuesday cohort', actions: [], severity: 'info', createdAt: now }), dataClass: 'REVENUE', moduleScope: ['revenue'], expiresAt: new Date(now.getTime() + 3600_000), createdAt: now },
        { id: 's_ok', businessId: 'biz_1', category: 'suggestion', key: 'bookings_1', value: JSON.stringify({ id: 's_ok', category: 'bookings', title: 'Confirm bookings', message: '3 appointments tomorrow', actions: [], severity: 'info', createdAt: now }), dataClass: 'GENERAL', moduleScope: ['bookings'], expiresAt: new Date(now.getTime() + 3600_000), createdAt: now },
      ];
      const prisma = {
        client: {
          aiMemory: {
            findMany: vi.fn(async (args: { where?: Record<string, unknown> }) =>
              rows.filter((r) => matchesPrismaWhere(r as unknown as Record<string, unknown>, args.where)),
            ),
          },
        },
      };
      const svc = new ProactiveSuggestionService(prisma as any, {} as any, {} as any, {} as any);

      const staffRes = await (svc as any).getPendingSuggestions('biz_1', { reader: 'staff_no_rev', sight: STAFF_NO_REV_SIGHT });
      expect(staffRes.map((s: any) => s.id)).toEqual(['s_ok']);
    });
  });

  describe('Path: TemporalFlowMemoryService & KeyCortexContextV2Service.getTemporalContext (filter before count)', () => {
    it('TemporalFlowMemoryService.findMany / findById / getStats project by data_class and filter BEFORE counts', async () => {
      const now = new Date();
      const rows = [
        { id: 'tm_ok', businessId: 'biz_1', entityType: 'contact', entityId: 'c1', type: 'summary', content: 'Prefers email', sourceEventIds: [], sourceModule: 'crm', metadata: {}, confidence: 0.9, dataClass: 'GENERAL', moduleScope: ['crm'], createdAt: now, updatedAt: now },
        { id: 'tm_rev', businessId: 'biz_1', entityType: 'contact', entityId: 'c1', type: 'insight', content: 'Account Alpha cadence', sourceEventIds: [], sourceModule: 'crm', metadata: {}, confidence: 0.95, dataClass: 'REVENUE', moduleScope: ['crm', 'revenue'], createdAt: now, updatedAt: now },
      ];
      const prisma = {
        client: {
          temporalFlowMemory: {
            findMany: vi.fn(async (args: { where?: Record<string, unknown> }) =>
              rows.filter((r) => matchesPrismaWhere(r as unknown as Record<string, unknown>, args.where)),
            ),
            findFirst: vi.fn(async ({ where }: any) => rows.find((r) => r.id === where.id && r.businessId === where.businessId) ?? null),
            count: vi.fn(async () => rows.length),
            groupBy: vi.fn(async () => [{ type: 'summary', _count: { id: 1 } }, { type: 'insight', _count: { id: 1 } }]),
          },
          temporalFlowEvent: { findMany: vi.fn(async () => []) },
        },
      };
      const svc = new TemporalFlowMemoryService(prisma as any, {} as any);

      const staffList = await (svc as any).findMany('biz_1', {}, { reader: 'staff_no_rev', sight: STAFF_NO_REV_SIGHT });
      expect(staffList.map((r: any) => r.id)).toEqual(['tm_ok']);

      const staffOne = await (svc as any).findById('biz_1', 'tm_rev', { reader: 'staff_no_rev', sight: STAFF_NO_REV_SIGHT });
      expect(staffOne).toBeNull();

      const staffStats = await (svc as any).getStats('biz_1', { reader: 'staff_no_rev', sight: STAFF_NO_REV_SIGHT });
      expect(staffStats.total).toBe(1);
      expect(staffStats.byType).toEqual({ summary: 1 });
    });

    it('KeyCortexContextV2Service.getTemporalContext filters REVENUE rows BEFORE recentMemories and BEFORE patternsDetected counts', async () => {
      const now = new Date();
      const rows = [
        { id: 'tm_ok', businessId: 'biz_1', entityType: 'contact', entityId: 'c1', type: 'summary', content: 'Prefers morning slots', sourceModule: 'bookings', sourceEventIds: [], metadata: {}, confidence: 0.8, dataClass: 'GENERAL', moduleScope: ['bookings'], createdAt: now },
        { id: 'tm_rev', businessId: 'biz_1', entityType: 'contact', entityId: 'c2', type: 'cadence_pattern', content: 'Tuesday check-in', sourceModule: 'crm', sourceEventIds: [], metadata: {}, confidence: 0.9, dataClass: 'REVENUE', moduleScope: ['revenue'], createdAt: now },
      ];
      const prisma = {
        client: {
          temporalFlowMemory: {
            findMany: vi.fn(async (args: { where?: Record<string, unknown> }) =>
              rows.filter((r) => matchesPrismaWhere(r as unknown as Record<string, unknown>, args.where)),
            ),
            groupBy: vi.fn(async () => [
              { type: 'summary', _count: { type: 1 }, _avg: { confidence: 0.8 }, _min: { createdAt: now }, _max: { createdAt: now } },
              { type: 'cadence_pattern', _count: { type: 1 }, _avg: { confidence: 0.9 }, _min: { createdAt: now }, _max: { createdAt: now } },
            ]),
          },
          temporalFlowEvent: { findMany: vi.fn(async () => []) },
        },
      };
      const svc = new KeyCortexContextV2Service(prisma as any);

      const ctx = await (svc as any).getTemporalContext('biz_1', { reader: 'staff_no_rev', sight: STAFF_NO_REV_SIGHT });
      expect(ctx.recentMemories.map((m: any) => m.id)).toEqual(['tm_ok']);
      expect(ctx.patternsDetected.map((p: any) => p.pattern)).toEqual(['summary']);
    });
  });

  describe('Path: CognitionMemory (KeyCortexLearningService), KeyCortexMemory (KeyCortexAwarenessService), KeyCortexSalienceService', () => {
    it('KeyCortexLearningService.retrieveLessons enforces PERSONAL ownership when readerContext is provided (memberless gets none)', async () => {
      const now = new Date();
      const rows = [
        { id: 'c_own', businessId: 'biz_1', userId: 'staff_no_rev', query: 'booking follow-up', recommendation: 'send reminder', userResponse: 'accepted', lessonsLearned: ['Send reminder 24h early'], createdAt: now },
        { id: 'c_other', businessId: 'biz_1', userId: 'owner_1', query: 'booking follow-up', recommendation: 'check revenue', userResponse: 'accepted', lessonsLearned: ['Owner private lesson'], createdAt: now },
      ];
      const prisma = {
        client: {
          cognitionMemory: {
            findMany: vi.fn(async (args: { where?: Record<string, unknown> }) =>
              rows.filter((r) => matchesPrismaWhere(r as unknown as Record<string, unknown>, args.where)),
            ),
          },
        },
      };
      const svc = new KeyCortexLearningService(prisma as any);

      const memberless = await (svc as any).retrieveLessons('biz_1', 'booking follow-up', {
        readerContext: { reader: null, sight: OWNER_SIGHT },
      });
      expect(memberless).toEqual([]);

      const staffLessons = await (svc as any).retrieveLessons('biz_1', 'booking follow-up', {
        readerContext: { reader: 'staff_no_rev', sight: STAFF_NO_REV_SIGHT },
      });
      expect(staffLessons).toEqual(['[accepted] Send reminder 24h early']);
    });

    it('KeyCortexAwarenessService.getAwareness enforces PERSONAL ownership on userId-scoped KeyCortexMemory rows', async () => {
      const now = new Date();
      const rows = [
        { key: 'k_biz', userId: null, value: JSON.stringify({ summary: 'High booking demand Friday' }), confidence: 0.9, createdAt: now },
        { key: 'k_other_user', userId: 'owner_1', value: JSON.stringify({ summary: 'Personal owner note' }), confidence: 0.95, createdAt: now },
        { key: 'k_own_user', userId: 'staff_no_rev', value: JSON.stringify({ summary: 'My personal reminder' }), confidence: 0.85, createdAt: now },
      ];
      const prisma = {
        client: {
          keyCortexMemory: {
            findMany: vi.fn(async () => rows),
          },
        },
      };
      const svc = new KeyCortexAwarenessService(prisma as any);

      const res = await (svc as any).getAwareness('biz_1', {
        kinds: ['signal'],
        readsRevenue: false,
        readerContext: { reader: 'staff_no_rev', sight: STAFF_NO_REV_SIGHT },
      });
      expect(res.items.map((i: any) => i.id)).toEqual(['k_biz', 'k_own_user']);
      expect(res.counts.signal).toBe(2);
    });

    it('KeyCortexSalienceService.describeForPrompt withholds revenue concerns and money-text backstop from STAFF without revenue:read', () => {
      const svc = new KeyCortexSalienceService({} as any);
      const now = new Date();
      (svc as any).current.set('biz_1', {
        appraisedAt: now,
        concerns: [
          { signal: 'proactive.invoice_overdue', valence: 'threat', salience: 0.9, recentCount: 12, baselineRate: 2, escalating: true, summary: '12 overdue invoices in 24h' },
          { signal: 'proactive.booking_no_show', valence: 'threat', salience: 0.6, recentCount: 4, baselineRate: 1, escalating: true, summary: '4 booking no-shows in 24h' },
          // Even a non-revenue signal carrying money text must be caught by fail-closed backstop
          { signal: 'proactive.negative_sentiment', valence: 'threat', salience: 0.8, recentCount: 3, baselineRate: 1, escalating: true, summary: 'Customer complained about $900 refund delay' },
        ],
      });

      const staffText = svc.describeForPrompt('biz_1', now, STAFF_NO_REV_SIGHT);
      expect(staffText).toContain('4 booking no-shows');
      expect(staffText).not.toContain('overdue invoices');
      expect(staffText).not.toContain('$900');

      const ownerText = svc.describeForPrompt('biz_1', now, OWNER_SIGHT);
      expect(ownerText).toContain('12 overdue invoices');
      expect(ownerText).toContain('$900');
      expect(ownerText).toContain('4 booking no-shows');
    });
  });
});
