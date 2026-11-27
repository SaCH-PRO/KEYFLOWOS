/**
 * P154 — RR-LEGACY-TOOLS-CLASSIFY (D-261, D-262, D-17, D-100, D-119, D-145, D-234):
 *
 * Classifies every legacy tool registered in KeyToolRegistryService (all 14)
 * against FLOW_TOOLS in a checked-in equivalence table (`legacy-tool-equivalence.ts`),
 * routes SAME/ALIAS entries to their canonical FLOW_TOOLS capability so canonical
 * authority gates (including revenue:read and D-104 membership) apply identically,
 * fails closed with a plain refusal for OBSOLETE tools (e.g. hidden v1 social),
 * prevents risk-tier/approval/scope loosening, and preserves KEY_DISABLED (D-17).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FLOW_TOOLS, getManualEquivalentRoute, getToolByName } from './flow-tool-registry';
import { KEY_BOOKS_MEMBERSHIP_READ_TOOLS } from './graph-actions.controller';
import { KeyCommandService, type KeyCommandPlan } from './key-command.service';
import { KeyToolRegistryService } from './key-tool-registry.service';
import { MEMBERLESS_KEY_TOOLS } from './memberless-key-tools';
import { keyMemberToolScopes } from './plan-step-authority';
import { CANONICAL_MODULE_TOOLS } from '../structure/job-role-policy.service';

type LegacyToolDisposition = 'SAME' | 'ALIAS' | 'SPECIALIZATION' | 'OBSOLETE' | 'MISSING';

interface LegacyToolEquivalenceEntry {
  readonly legacyKey: string;
  readonly disposition: LegacyToolDisposition;
  readonly canonicalTool?: string;
  readonly reason: string;
}

interface EquivalenceModule {
  LEGACY_TOOL_EQUIVALENCE: ReadonlyArray<LegacyToolEquivalenceEntry>;
  LEGACY_TOOL_EQUIVALENCE_BY_KEY: ReadonlyMap<string, LegacyToolEquivalenceEntry>;
  getLegacyToolEquivalence: (legacyKey: string) => LegacyToolEquivalenceEntry | undefined;
  obsoleteLegacyToolRefusal: (entry: LegacyToolEquivalenceEntry) => string;
}

const VALID_DISPOSITIONS: ReadonlySet<string> = new Set<LegacyToolDisposition>([
  'SAME',
  'ALIAS',
  'SPECIALIZATION',
  'OBSOLETE',
  'MISSING',
]);

const EQUIVALENCE_SPECIFIER = './legacy-tool-equivalence';

async function loadEquivalence(): Promise<EquivalenceModule> {
  const mod = (await import(EQUIVALENCE_SPECIFIER).catch(() => null)) as EquivalenceModule | null;
  expect(mod, 'apps/server/src/modules/ai/legacy-tool-equivalence.ts must exist').not.toBeNull();
  return mod!;
}

type Member = { userRole?: string; role?: string; permissionScopes?: Record<string, string> | null } | null;

const AUTO = {
  allowed: true,
  requiresQuickConfirm: false,
  requiresFormalApproval: false,
  requiresAdminApproval: false,
  tier: 1,
  reason: 'Tier 1 auto-approved (max auto tier: 1)',
};

const POLICY = {
  mode: 'assisted',
  maxAutoTier: 1,
  blockedTools: [] as string[],
  blockedModules: [] as string[],
  autonomyLevel: 0,
  approvedTools: [] as string[],
  approvalTimeoutHours: 24,
};

function makeRealLegacyRegistry(prismaOverride?: Record<string, unknown>) {
  const prisma = {
    client: {
      socialEngagement: { findMany: vi.fn().mockResolvedValue([]) },
      messageIntake: { findMany: vi.fn().mockResolvedValue([]) },
      financialAccount: { findMany: vi.fn().mockResolvedValue([]) },
      ...(prismaOverride ?? {}),
    },
  };
  const auditLog = { logToolExecution: vi.fn().mockResolvedValue(undefined) };
  const registry = new KeyToolRegistryService(
    prisma as any,
    { calculate: vi.fn().mockResolvedValue({ safeToSpend: 1000 }) } as any,
    { forecast: vi.fn().mockResolvedValue({ horizonDays: 90 }) } as any,
    { generate: vi.fn().mockResolvedValue([]) } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    auditLog as any,
  );
  return { registry, prisma, auditLog };
}

function makeHarness(opts: {
  member?: Member;
  canonicalNames?: string[];
  includeAllFlowTools?: boolean;
  policy?: Partial<typeof POLICY> & { degraded?: boolean };
} = {}) {
  const member: Member = opts.member === undefined ? { role: 'OWNER', permissionScopes: null } : opts.member;
  const prisma = {
    client: {
      keyCommand: { update: vi.fn().mockResolvedValue({}) },
      user: {
        findUnique: vi.fn().mockResolvedValue(member ? { id: 'user_1', role: member.userRole ?? 'USER' } : null),
      },
      membership: {
        findUnique: vi.fn().mockResolvedValue(
          member && member.role
            ? {
                userId: 'user_1',
                businessId: 'biz_1',
                role: member.role,
                permissionScopes: member.permissionScopes ?? null,
              }
            : null,
        ),
      },
      contact: { findMany: vi.fn().mockResolvedValue([]) },
    },
  };
  const timeline = { recordEvent: vi.fn().mockResolvedValue(undefined) };

  const flowList =
    opts.includeAllFlowTools !== false
      ? FLOW_TOOLS
      : FLOW_TOOLS.filter((t) => (opts.canonicalNames ?? []).includes(t.name));
  const canonicalTools = new Map(
    flowList.map((t) => [
      t.name,
      { name: t.name, module: t.family, riskTier: t.riskTier, requiresApproval: false },
    ]),
  );

  const canonical = {
    getTool: vi.fn((name: string) => canonicalTools.get(name)),
    execute: vi.fn().mockResolvedValue({ success: true, data: { from: 'canonical' } }),
  };

  const { registry: realLegacy } = makeRealLegacyRegistry();
  const legacy = {
    getTool: vi.fn((module: string, name: string) => realLegacy.getTool(module, name)),
    execute: vi.fn().mockResolvedValue({ success: true, data: { from: 'legacy' } }),
  };

  const oversight = {
    evaluate: vi.fn().mockResolvedValue(AUTO),
    getAutonomySettings: vi.fn().mockResolvedValue({ ...POLICY, ...opts.policy }),
  };
  const safety = { check: vi.fn().mockResolvedValue({ allowed: true }) };

  const service = new KeyCommandService(
    prisma as any,
    timeline as any,
    legacy as any,
    {} as any,
    canonical as any,
    oversight as any,
    safety as any,
  );

  return { service, prisma, timeline, canonical, legacy, oversight, safety, realLegacy };
}

function makePlan(module: string, tool: string, input: Record<string, unknown> = {}): KeyCommandPlan {
  return {
    summary: `plan ${module}.${tool}`,
    steps: [{ module, tool, input, riskTier: 'LOW', requiresApproval: false }],
  };
}

function splitLegacyKey(legacyKey: string): { module: string; tool: string } {
  const [module, tool] = legacyKey.split('.');
  return { module, tool };
}

const savedKeyDisabled = process.env.KEY_DISABLED;

afterEach(() => {
  if (savedKeyDisabled === undefined) delete process.env.KEY_DISABLED;
  else process.env.KEY_DISABLED = savedKeyDisabled;
});

describe('P154 (RR-LEGACY-TOOLS-CLASSIFY): legacy tool equivalence table', () => {
  it('classifies every single key registered in KeyToolRegistryService (all 14) with zero stale entries and valid FLOW_TOOLS targets', async () => {
    const { LEGACY_TOOL_EQUIVALENCE, LEGACY_TOOL_EQUIVALENCE_BY_KEY, getLegacyToolEquivalence } =
      await loadEquivalence();
    const { registry } = makeRealLegacyRegistry();
    const registeredKeys = registry.listTools().map((t) => t.key).sort();

    expect(registeredKeys.length).toBe(14);

    const tableKeys = LEGACY_TOOL_EQUIVALENCE.map((e) => e.legacyKey);
    expect(new Set(tableKeys).size, 'no duplicate legacyKey entries').toBe(tableKeys.length);
    expect([...tableKeys].sort()).toEqual(registeredKeys);
    expect(LEGACY_TOOL_EQUIVALENCE_BY_KEY.size).toBe(registeredKeys.length);

    let sameCount = 0;
    let aliasCount = 0;
    let obsoleteCount = 0;

    for (const entry of LEGACY_TOOL_EQUIVALENCE) {
      expect(VALID_DISPOSITIONS.has(entry.disposition), `${entry.legacyKey}: invalid disposition`).toBe(true);
      expect(entry.reason.trim().length, `${entry.legacyKey}: reason must be non-empty`).toBeGreaterThan(10);
      expect(getLegacyToolEquivalence(entry.legacyKey)).toEqual(entry);

      if (entry.disposition === 'SAME' || entry.disposition === 'ALIAS') {
        if (entry.disposition === 'SAME') sameCount += 1;
        if (entry.disposition === 'ALIAS') aliasCount += 1;

        expect(typeof entry.canonicalTool, `${entry.legacyKey}: canonicalTool required`).toBe('string');
        const flowTool = getToolByName(entry.canonicalTool!);
        expect(flowTool, `${entry.legacyKey} -> ${entry.canonicalTool} must exist in FLOW_TOOLS`).toBeDefined();
        expect(
          getManualEquivalentRoute(flowTool!).startsWith('/app/'),
          `${entry.canonicalTool} must preserve a manualEquivalentRoute`,
        ).toBe(true);
      } else {
        if (entry.disposition === 'OBSOLETE') obsoleteCount += 1;
        expect(entry.canonicalTool, `${entry.legacyKey}: non-SAME/ALIAS must not set canonicalTool`).toBeUndefined();
      }
    }

    expect(sameCount).toBeGreaterThanOrEqual(1);
    expect(aliasCount).toBeGreaterThanOrEqual(1);
    expect(obsoleteCount).toBeGreaterThanOrEqual(1);
  });
});

describe('P154 (RR-LEGACY-TOOLS-CLASSIFY): canonical routing for SAME/ALIAS tools', () => {
  it('resolves every SAME/ALIAS legacy tool to registry "canonical" with its canonicalTool and executes canonically', async () => {
    const { LEGACY_TOOL_EQUIVALENCE } = await loadEquivalence();
    const canonicalEntries = LEGACY_TOOL_EQUIVALENCE.filter(
      (e) => e.disposition === 'SAME' || e.disposition === 'ALIAS',
    );
    expect(canonicalEntries.length).toBeGreaterThanOrEqual(4);

    for (const entry of canonicalEntries) {
      const { module, tool } = splitLegacyKey(entry.legacyKey);
      const h = makeHarness();
      const step = makePlan(module, tool).steps[0];

      const resolved = (h.service as unknown as { resolveCapability: (s: typeof step) => any }).resolveCapability(step);
      expect(resolved, entry.legacyKey).toBeDefined();
      expect(resolved.registry, entry.legacyKey).toBe('canonical');
      expect(resolved.name, entry.legacyKey).toBe(entry.canonicalTool);
      expect(resolved.toolName, entry.legacyKey).toBe(entry.canonicalTool);

      const results = await h.service.executeApprovedPlan('cmd_canon', makePlan(module, tool), 'biz_1', 'user_1');
      expect(h.canonical.execute, entry.legacyKey).toHaveBeenCalledTimes(1);
      expect(h.canonical.execute.mock.calls[0][0], entry.legacyKey).toBe(entry.canonicalTool);
      expect(h.legacy.execute, entry.legacyKey).not.toHaveBeenCalled();
      expect(results[0], entry.legacyKey).toMatchObject({ success: true, tool: entry.canonicalTool });
    }
  });

  it('routes the 4 canonical finance tools directly to FLOW_TOOLS canonical capabilities (never legacy)', () => {
    const expected: Array<[string, string, string]> = [
      ['finance', 'summarizeCashPosition', 'finance_safe_to_spend'],
      ['finance', 'calculateSafeToSpend', 'finance_safe_to_spend'],
      ['finance', 'generateMoneyMoves', 'finance_money_moves'],
      ['finance', 'cashflowForecast', 'finance_cashflow_forecast'],
    ];
    const h = makeHarness();

    for (const [module, tool, expectedCanonical] of expected) {
      const step = makePlan(module, tool).steps[0];
      const resolved = (h.service as unknown as { resolveCapability: (s: typeof step) => any }).resolveCapability(step);
      expect(resolved, `${module}.${tool}`).toMatchObject({
        registry: 'canonical',
        name: expectedCanonical,
        toolName: expectedCanonical,
      });
    }
  });

  it('fails closed (never falls back to legacy) when a SAME/ALIAS canonical target is absent from canonical registry', async () => {
    const h = makeHarness({ includeAllFlowTools: false, canonicalNames: [] });
    const step = makePlan('finance', 'summarizeCashPosition').steps[0];

    const resolved = (h.service as unknown as { resolveCapability: (s: typeof step) => any }).resolveCapability(step);
    expect(resolved).toBeUndefined();

    const results = await h.service.executeApprovedPlan(
      'cmd_missing_canon',
      makePlan('finance', 'summarizeCashPosition'),
      'biz_1',
      'user_1',
    );
    expect(h.canonical.execute).not.toHaveBeenCalled();
    expect(h.legacy.execute).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({ success: false, notExecuted: true });
  });

  it('keeps SPECIALIZATION/MISSING legacy tools on the legacy registry until RR-LEGACY-FALLBACK-REMOVE (control)', async () => {
    const h = makeHarness({ includeAllFlowTools: true });
    const step = makePlan('messages', 'listMessageIntake').steps[0];

    const resolved = (h.service as unknown as { resolveCapability: (s: typeof step) => any }).resolveCapability(step);
    expect(resolved).toMatchObject({ registry: 'legacy', name: 'messages.listMessageIntake' });

    const results = await h.service.executeApprovedPlan(
      'cmd_legacy_ctrl',
      makePlan('messages', 'listMessageIntake'),
      'biz_1',
      'user_1',
    );
    expect(h.legacy.execute).toHaveBeenCalledTimes(1);
    expect(h.canonical.execute).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({ success: true, tool: 'messages.listMessageIntake' });
  });
});

describe('P154 (RR-LEGACY-TOOLS-CLASSIFY): revenue authority enforcement (D-100/D-145/D-234/D-104)', () => {
  const ALIASED_FINANCE_STEPS: Array<[string, string, string]> = [
    ['finance', 'summarizeCashPosition', 'finance_safe_to_spend'],
    ['finance', 'calculateSafeToSpend', 'finance_safe_to_spend'],
    ['finance', 'generateMoneyMoves', 'finance_money_moves'],
    ['finance', 'cashflowForecast', 'finance_cashflow_forecast'],
  ];

  it.each(ALIASED_FINANCE_STEPS)(
    'refuses %s.%s (-> %s) for a member without revenue:read and allows OWNER / revenue:read member',
    async (module, tool, canonicalName) => {
      // Verify canonical authority metadata requires revenue:read + D-104 membership.
      expect(CANONICAL_MODULE_TOOLS.revenue[canonicalName]).toBe('read');
      expect(keyMemberToolScopes(canonicalName)).toEqual(
        expect.arrayContaining([{ module: 'revenue', minLevel: 'read' }]),
      );
      expect(KEY_BOOKS_MEMBERSHIP_READ_TOOLS.has(canonicalName)).toBe(true);

      // Member without revenue:read is refused identically to calling the canonical tool directly.
      const denied = makeHarness({
        member: { role: 'STAFF', permissionScopes: { revenue: 'none', crm: 'read' } },
      });
      const deniedRes = await denied.service.executeApprovedPlan('cmd_deny', makePlan(module, tool), 'biz_1', 'user_1');
      expect(denied.canonical.execute).not.toHaveBeenCalled();
      expect(denied.legacy.execute).not.toHaveBeenCalled();
      expect(deniedRes[0]).toMatchObject({ success: false, notExecuted: true, tool: canonicalName });
      expect(deniedRes[0].error).toMatch(/revenue requires read access/i);

      // Anonymous call (no member) fails closed.
      const anon = makeHarness();
      const anonRes = await anon.service.executeApprovedPlan('cmd_anon', makePlan(module, tool), 'biz_1', undefined);
      expect(anon.canonical.execute).not.toHaveBeenCalled();
      expect(anon.legacy.execute).not.toHaveBeenCalled();
      expect(anonRes[0]).toMatchObject({ success: false, notExecuted: true });

      // Platform SUPER_ADMIN who is NOT a member of this business is refused (D-104).
      const saOutsider = makeHarness({ member: { userRole: 'SUPER_ADMIN', role: undefined } });
      const saRes = await saOutsider.service.executeApprovedPlan('cmd_sa', makePlan(module, tool), 'biz_1', 'user_1');
      expect(saOutsider.canonical.execute).not.toHaveBeenCalled();
      expect(saOutsider.legacy.execute).not.toHaveBeenCalled();
      expect(saRes[0]).toMatchObject({ success: false, notExecuted: true });
      expect(saRes[0].error).toMatch(/No access to this business/i);

      // Negative control 1: OWNER succeeds canonically.
      const owner = makeHarness({ member: { role: 'OWNER', permissionScopes: null } });
      const ownerRes = await owner.service.executeApprovedPlan('cmd_owner', makePlan(module, tool), 'biz_1', 'user_1');
      expect(owner.canonical.execute).toHaveBeenCalledTimes(1);
      expect(owner.canonical.execute.mock.calls[0][0]).toBe(canonicalName);
      expect(owner.legacy.execute).not.toHaveBeenCalled();
      expect(ownerRes[0]).toMatchObject({ success: true, tool: canonicalName });

      // Negative control 2: STAFF with revenue:read succeeds canonically.
      const staffRev = makeHarness({ member: { role: 'STAFF', permissionScopes: { revenue: 'read' } } });
      const staffRes = await staffRev.service.executeApprovedPlan(
        'cmd_staff_rev',
        makePlan(module, tool),
        'biz_1',
        'user_1',
      );
      expect(staffRev.canonical.execute).toHaveBeenCalledTimes(1);
      expect(staffRev.legacy.execute).not.toHaveBeenCalled();
      expect(staffRes[0]).toMatchObject({ success: true, tool: canonicalName });
    },
  );
});

describe('P154 (RR-LEGACY-TOOLS-CLASSIFY): OBSOLETE tools fail closed with zero side effects', () => {
  it('refuses social.listRecentEngagement through KeyCommandService with a plain message and zero execution', async () => {
    const h = makeHarness({ member: { role: 'OWNER', permissionScopes: null } });
    const step = makePlan('social', 'listRecentEngagement', { limit: 10 }).steps[0];

    const resolved = (h.service as unknown as { resolveCapability: (s: typeof step) => any }).resolveCapability(step);
    expect(resolved).toBeUndefined();

    const results = await h.service.executeApprovedPlan(
      'cmd_obs',
      makePlan('social', 'listRecentEngagement', { limit: 10 }),
      'biz_1',
      'user_1',
    );
    expect(h.canonical.execute).not.toHaveBeenCalled();
    expect(h.legacy.execute).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({
      success: false,
      notExecuted: true,
      requiresApproval: false,
      tool: 'social.listRecentEngagement',
    });
    expect(results[0].error).toMatch(/obsolete/i);
  });

  it('refuses every OBSOLETE entry in LEGACY_TOOL_EQUIVALENCE through both KeyCommandService and KeyToolRegistryService', async () => {
    const { LEGACY_TOOL_EQUIVALENCE } = await loadEquivalence();
    const obsoleteEntries = LEGACY_TOOL_EQUIVALENCE.filter((e) => e.disposition === 'OBSOLETE');
    expect(obsoleteEntries.length).toBeGreaterThanOrEqual(1);

    for (const entry of obsoleteEntries) {
      const { module, tool } = splitLegacyKey(entry.legacyKey);
      const h = makeHarness({ member: { role: 'OWNER', permissionScopes: null } });
      const cmdResults = await h.service.executeApprovedPlan('cmd_obs_all', makePlan(module, tool), 'biz_1', 'user_1');
      expect(h.canonical.execute, entry.legacyKey).not.toHaveBeenCalled();
      expect(h.legacy.execute, entry.legacyKey).not.toHaveBeenCalled();
      expect(cmdResults[0], entry.legacyKey).toMatchObject({
        success: false,
        notExecuted: true,
        tool: entry.legacyKey,
      });
      expect(cmdResults[0].error, entry.legacyKey).toMatch(/obsolete/i);

      const { registry, prisma } = makeRealLegacyRegistry();
      const directResult = await registry.execute(
        module,
        tool,
        { businessId: 'biz_1', userId: 'user_1', autonomyLevel: 4 },
        {},
      );
      expect(directResult, entry.legacyKey).toMatchObject({ success: false, notExecuted: true });
      expect(directResult.error, entry.legacyKey).toMatch(/obsolete/i);
      expect(prisma.client.socialEngagement.findMany).not.toHaveBeenCalled();
    }
  });
});

describe('P154 (RR-LEGACY-TOOLS-CLASSIFY): no risk-tier, approval, or scope loosening', () => {
  it('ensures no SAME/ALIAS entry loosens riskTier, approval requirement, or memberless exposure relative to its legacy tool', async () => {
    const { LEGACY_TOOL_EQUIVALENCE } = await loadEquivalence();
    const { registry } = makeRealLegacyRegistry();

    for (const entry of LEGACY_TOOL_EQUIVALENCE) {
      if (entry.disposition !== 'SAME' && entry.disposition !== 'ALIAS') continue;
      const { module, tool } = splitLegacyKey(entry.legacyKey);
      const legacyTool = registry.getTool(module, tool);
      const canonicalTool = getToolByName(entry.canonicalTool!);

      expect(legacyTool, entry.legacyKey).toBeDefined();
      expect(canonicalTool, entry.canonicalTool).toBeDefined();
      expect(
        canonicalTool!.riskTier,
        `${entry.legacyKey} -> ${entry.canonicalTool} must not loosen riskTier`,
      ).toBeGreaterThanOrEqual(legacyTool!.riskTier);
      if (legacyTool!.requiresApproval) {
        expect(
          canonicalTool!.riskTier,
          `${entry.legacyKey} required approval; canonical must remain approval-gated`,
        ).toBeGreaterThanOrEqual(3);
      }
      if (module === 'finance' || module === 'commerce') {
        expect(
          Object.prototype.hasOwnProperty.call(MEMBERLESS_KEY_TOOLS, entry.canonicalTool!),
          `${entry.canonicalTool} must never be memberless-allowlisted`,
        ).toBe(false);
      }
    }
  });

  it('keeps business blockedTools naming the legacy tool effective after canonical aliasing', async () => {
    const h = makeHarness({
      member: { role: 'OWNER', permissionScopes: null },
      policy: { blockedTools: ['summarizeCashPosition'] },
    });

    const results = await h.service.executeApprovedPlan(
      'cmd_legacy_block',
      makePlan('finance', 'summarizeCashPosition'),
      'biz_1',
      'user_1',
    );
    expect(h.canonical.execute).not.toHaveBeenCalled();
    expect(h.legacy.execute).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({ success: false, notExecuted: true });
    expect(results[0].error).toContain('Tool "summarizeCashPosition" is blocked');
  });
});

describe('P154 (RR-LEGACY-TOOLS-CLASSIFY): KEY_DISABLED (D-17) still turns KEY off cleanly', () => {
  it('refuses both aliased canonical tools and legacy tools with zero execution when KEY_DISABLED=1', async () => {
    process.env.KEY_DISABLED = '1';

    const h = makeHarness({ member: { role: 'OWNER', permissionScopes: null } });
    const aliasedRes = await h.service.executeApprovedPlan(
      'cmd_disabled_1',
      makePlan('finance', 'summarizeCashPosition'),
      'biz_1',
      'user_1',
    );
    expect(h.canonical.execute).not.toHaveBeenCalled();
    expect(h.legacy.execute).not.toHaveBeenCalled();
    expect(aliasedRes[0]).toMatchObject({ success: false, notExecuted: true });
    expect(aliasedRes[0].error).toMatch(/KEY_DISABLED/i);

    const legacyRes = await h.service.executeApprovedPlan(
      'cmd_disabled_2',
      makePlan('messages', 'listMessageIntake'),
      'biz_1',
      'user_1',
    );
    expect(h.canonical.execute).not.toHaveBeenCalled();
    expect(h.legacy.execute).not.toHaveBeenCalled();
    expect(legacyRes[0]).toMatchObject({ success: false, notExecuted: true });
    expect(legacyRes[0].error).toMatch(/KEY_DISABLED/i);

    const { registry, prisma } = makeRealLegacyRegistry();
    const directRes = await registry.execute(
      'messages',
      'listMessageIntake',
      { businessId: 'biz_1', userId: 'user_1', autonomyLevel: 4 },
      {},
    );
    expect(directRes).toMatchObject({ success: false, notExecuted: true });
    expect(directRes.error).toMatch(/KEY_DISABLED/i);
    expect(prisma.client.messageIntake.findMany).not.toHaveBeenCalled();
  });
});
