/**
 * P154 (RR-LEGACY-TOOLS-CLASSIFY) + P160 (RR-LEGACY-FALLBACK-REMOVE):
 * (D-261, D-262, D-17, D-37, D-40, D-100, D-104, D-119, D-145, D-234, D-260)
 *
 * Verifies:
 *   1. Every one of the 14 former legacy tool keys is classified in
 *      `LEGACY_TOOL_EQUIVALENCE` with ZERO `SPECIALIZATION` or `MISSING`
 *      entries remaining, and `KeyToolRegistryService` is deleted and not
 *      provided by `AiModule` or referenced by `KeyCommandService` /
 *      `KeyCortexActionsService`.
 *   2. Every former legacy tool name answers either its canonical `FLOW_TOOLS`
 *      capability or a plain fail-closed refusal through `KeyCommandService`
 *      (one case per key, all 14 covered).
 *   3. Per-tool authority enforcement for EVERY newly promoted canonical tool
 *      (`finance_list_overdue_invoices`, `finance_create_invoice_reminder_draft`,
 *      `crm_recommend_follow_ups`, `command_create_item`,
 *      `commerce_summarize_revenue`, `crm_create_reminder`): OWNER allowed,
 *      STAFF without required module scope refused, `revenue:read`/`revenue:write`
 *      + D-104 membership where it derives money, D-37 contact visibility.
 *   4. No risk-tier, approval, or memberless exposure loosening, business
 *      blockedTools preservation, and `KEY_DISABLED` (D-17) fail-closed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FLOW_TOOLS, getManualEquivalentRoute, getToolByName } from './flow-tool-registry';
import {
  GRAPH_ACTION_CONTACT_READ_TOOLS,
  KEY_BOOKS_MEMBERSHIP_READ_TOOLS,
  graphActionRequirement,
} from './graph-actions.controller';
import { KeyCommandService, type KeyCommandPlan } from './key-command.service';
import { MEMBERLESS_KEY_TOOLS } from './memberless-key-tools';
import {
  keyMemberToolScopes,
  memberToolScopeRefusal,
  noMemberToolRefusal,
} from './plan-step-authority';
import { CANONICAL_MODULE_TOOLS } from '../structure/job-role-policy.service';
import {
  LEGACY_TOOL_EQUIVALENCE,
  LEGACY_TOOL_EQUIVALENCE_BY_KEY,
  getLegacyToolEquivalence,
  type LegacyToolDisposition,
} from './legacy-tool-equivalence';

const ALL_14_FORMER_LEGACY_KEYS = [
  'commerce.summarizeRevenue',
  'connect.listDriveIntake',
  'connect.scanDrive',
  'contacts.createCommandItem',
  'contacts.recommendFollowUps',
  'finance.calculateSafeToSpend',
  'finance.cashflowForecast',
  'finance.createInvoiceReminderDraft',
  'finance.generateMoneyMoves',
  'finance.listOverdueInvoices',
  'finance.summarizeCashPosition',
  'messages.listMessageIntake',
  'social.listRecentEngagement',
  'timeline.createReminder',
] as const;

const LEGACY_RISK_TIERS: Readonly<Record<string, number>> = {
  'finance.summarizeCashPosition': 1,
  'finance.calculateSafeToSpend': 1,
  'finance.listOverdueInvoices': 1,
  'finance.generateMoneyMoves': 1,
  'finance.cashflowForecast': 1,
  'finance.createInvoiceReminderDraft': 2,
  'contacts.recommendFollowUps': 1,
  'contacts.createCommandItem': 1,
  'commerce.summarizeRevenue': 1,
  'timeline.createReminder': 1,
  'connect.scanDrive': 1,
  'connect.listDriveIntake': 1,
  'messages.listMessageIntake': 1,
  'social.listRecentEngagement': 1,
};

const VALID_DISPOSITIONS: ReadonlySet<string> = new Set<LegacyToolDisposition>([
  'SAME',
  'ALIAS',
  'SPECIALIZATION',
  'OBSOLETE',
  'MISSING',
]);

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

function makePrismaForMember(member: Member) {
  return {
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
}

function makeHarness(opts: {
  member?: Member;
  canonicalNames?: string[];
  includeAllFlowTools?: boolean;
  policy?: Partial<typeof POLICY> & { degraded?: boolean };
} = {}) {
  const member: Member = opts.member === undefined ? { role: 'OWNER', permissionScopes: null } : opts.member;
  const prisma = makePrismaForMember(member);
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

  const oversight = {
    evaluate: vi.fn().mockResolvedValue(AUTO),
    getAutonomySettings: vi.fn().mockResolvedValue({ ...POLICY, ...opts.policy }),
  };
  const safety = { check: vi.fn().mockResolvedValue({ allowed: true }) };

  const service = new KeyCommandService(
    prisma as any,
    timeline as any,
    {} as any,
    canonical as any,
    oversight as any,
    safety as any,
  );

  return { service, prisma, timeline, canonical, oversight, safety };
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

describe('P160 (RR-LEGACY-FALLBACK-REMOVE): legacy fallback and KeyToolRegistryService removed', () => {
  it('no disposition is SPECIALIZATION or MISSING and KeyToolRegistryService is not provided by AiModule', () => {
    const remainingLegacy = LEGACY_TOOL_EQUIVALENCE.filter(
      (e) => e.disposition === 'SPECIALIZATION' || e.disposition === 'MISSING',
    );
    expect(
      remainingLegacy.map((e) => `${e.legacyKey}:${e.disposition}`),
      'every former legacy tool must be promoted to SAME/ALIAS or retired as OBSOLETE',
    ).toEqual([]);

    const aiModuleSrc = readFileSync(resolve(__dirname, 'ai.module.ts'), 'utf8');
    expect(aiModuleSrc, 'AiModule must not provide or export KeyToolRegistryService').not.toMatch(
      /\bKeyToolRegistryService\b/,
    );
    expect(
      existsSync(resolve(__dirname, 'key-tool-registry.service.ts')),
      'key-tool-registry.service.ts must be deleted once no caller uses it',
    ).toBe(false);

    const keyCommandSrc = readFileSync(resolve(__dirname, 'key-command.service.ts'), 'utf8');
    expect(keyCommandSrc, 'KeyCommandService must not reference KeyToolRegistryService').not.toMatch(
      /\bKeyToolRegistryService\b/,
    );

    const cortexActionsSrc = readFileSync(
      resolve(__dirname, '../key-cortex/key-cortex-actions.service.ts'),
      'utf8',
    );
    expect(cortexActionsSrc, 'KeyCortexActionsService must not reference KeyToolRegistryService').not.toMatch(
      /\bKeyToolRegistryService\b/,
    );
  });
});

describe('P154/P160: legacy tool equivalence table covers all 14 former legacy keys cleanly', () => {
  it('classifies every one of the 14 former legacy keys with zero stale entries and valid FLOW_TOOLS targets', () => {
    const tableKeys = LEGACY_TOOL_EQUIVALENCE.map((e) => e.legacyKey);
    expect(new Set(tableKeys).size, 'no duplicate legacyKey entries').toBe(tableKeys.length);
    expect([...tableKeys].sort()).toEqual([...ALL_14_FORMER_LEGACY_KEYS]);
    expect(LEGACY_TOOL_EQUIVALENCE_BY_KEY.size).toBe(14);

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

    expect(sameCount).toBe(9);
    expect(aliasCount).toBe(1);
    expect(obsoleteCount).toBe(4);
  });
});

describe('P160: every former legacy tool name answers canonical or plain refusal through KeyCommand (all 14)', () => {
  const EXPECTED_KEY_COMMAND_OUTCOME: Array<{
    legacyKey: string;
    mode: 'canonical-read' | 'canonical-non-read-refused' | 'obsolete-refused';
    canonicalTool?: string;
  }> = [
    { legacyKey: 'finance.summarizeCashPosition', mode: 'canonical-read', canonicalTool: 'finance_safe_to_spend' },
    { legacyKey: 'finance.calculateSafeToSpend', mode: 'canonical-read', canonicalTool: 'finance_safe_to_spend' },
    { legacyKey: 'finance.listOverdueInvoices', mode: 'canonical-read', canonicalTool: 'finance_list_overdue_invoices' },
    { legacyKey: 'finance.generateMoneyMoves', mode: 'canonical-read', canonicalTool: 'finance_money_moves' },
    { legacyKey: 'finance.cashflowForecast', mode: 'canonical-read', canonicalTool: 'finance_cashflow_forecast' },
    { legacyKey: 'finance.createInvoiceReminderDraft', mode: 'canonical-non-read-refused', canonicalTool: 'finance_create_invoice_reminder_draft' },
    { legacyKey: 'contacts.recommendFollowUps', mode: 'canonical-read', canonicalTool: 'crm_recommend_follow_ups' },
    { legacyKey: 'contacts.createCommandItem', mode: 'canonical-non-read-refused', canonicalTool: 'command_create_item' },
    { legacyKey: 'commerce.summarizeRevenue', mode: 'canonical-read', canonicalTool: 'commerce_summarize_revenue' },
    { legacyKey: 'timeline.createReminder', mode: 'canonical-non-read-refused', canonicalTool: 'crm_create_reminder' },
    { legacyKey: 'connect.scanDrive', mode: 'obsolete-refused' },
    { legacyKey: 'connect.listDriveIntake', mode: 'obsolete-refused' },
    { legacyKey: 'messages.listMessageIntake', mode: 'obsolete-refused' },
    { legacyKey: 'social.listRecentEngagement', mode: 'obsolete-refused' },
  ];

  it.each(EXPECTED_KEY_COMMAND_OUTCOME)(
    '$legacyKey -> $mode ($canonicalTool)',
    async ({ legacyKey, mode, canonicalTool }) => {
      const { module, tool } = splitLegacyKey(legacyKey);
      const h = makeHarness({ member: { role: 'OWNER', permissionScopes: null } });
      const step = makePlan(module, tool).steps[0];
      const resolved = (h.service as unknown as { resolveCapability: (s: typeof step) => any }).resolveCapability(step);

      if (mode === 'obsolete-refused') {
        expect(resolved).toBeUndefined();
        const res = await h.service.executeApprovedPlan('cmd_14', makePlan(module, tool), 'biz_1', 'user_1');
        expect(h.canonical.execute).not.toHaveBeenCalled();
        expect(res[0]).toMatchObject({ success: false, notExecuted: true, requiresApproval: false, tool: legacyKey });
        expect(res[0].error).toMatch(/obsolete/i);
        return;
      }

      expect(resolved).toMatchObject({
        registry: 'canonical',
        name: canonicalTool,
        toolName: canonicalTool,
        aliasedFrom: legacyKey,
      });

      const res = await h.service.executeApprovedPlan('cmd_14', makePlan(module, tool), 'biz_1', 'user_1');
      if (mode === 'canonical-read') {
        expect(h.canonical.execute).toHaveBeenCalledTimes(1);
        expect(h.canonical.execute.mock.calls[0][0]).toBe(canonicalTool);
        expect(res[0]).toMatchObject({ success: true, tool: canonicalTool });
      } else {
        // Non-read-only canonical tool (draft/write) resolves canonically but 'ask' refuses to mutate the business.
        expect(h.canonical.execute).not.toHaveBeenCalled();
        expect(res[0]).toMatchObject({
          success: false,
          notExecuted: true,
          requiresApproval: true,
          tool: canonicalTool,
        });
        expect(res[0].error).toMatch(/not a read-only capability/i);
      }
    },
  );

  it('fails closed when a SAME/ALIAS canonical target is absent from canonical registry', async () => {
    const h = makeHarness({ includeAllFlowTools: false, canonicalNames: [] });
    const step = makePlan('finance', 'summarizeCashPosition').steps[0];
    expect((h.service as any).resolveCapability(step)).toBeUndefined();

    const results = await h.service.executeApprovedPlan(
      'cmd_missing_canon',
      makePlan('finance', 'summarizeCashPosition'),
      'biz_1',
      'user_1',
    );
    expect(h.canonical.execute).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({ success: false, notExecuted: true });
  });
});

describe('P160: per-tool authority enforcement for all 6 newly promoted canonical tools', () => {
  const PROMOTED_AUTHORITY_CASES: Array<{
    tool: string;
    requiredModule: string;
    requiredLevel: 'read' | 'write';
    booksMembershipRead: boolean;
    contactRead: boolean;
    allowStaffScopes: Record<string, string>;
    denyStaffScopes: Record<string, string>;
  }> = [
    {
      tool: 'finance_list_overdue_invoices',
      requiredModule: 'revenue',
      requiredLevel: 'read',
      booksMembershipRead: true,
      contactRead: false,
      allowStaffScopes: { revenue: 'read' },
      denyStaffScopes: { revenue: 'none', crm: 'read' },
    },
    {
      tool: 'finance_create_invoice_reminder_draft',
      requiredModule: 'revenue',
      requiredLevel: 'write',
      booksMembershipRead: true,
      contactRead: false,
      allowStaffScopes: { revenue: 'write' },
      denyStaffScopes: { revenue: 'read' },
    },
    {
      tool: 'commerce_summarize_revenue',
      requiredModule: 'revenue',
      requiredLevel: 'read',
      booksMembershipRead: true,
      contactRead: false,
      allowStaffScopes: { revenue: 'read' },
      denyStaffScopes: { revenue: 'none', crm: 'read' },
    },
    {
      tool: 'crm_recommend_follow_ups',
      requiredModule: 'crm',
      requiredLevel: 'read',
      booksMembershipRead: false,
      contactRead: true,
      allowStaffScopes: { crm: 'read' },
      denyStaffScopes: { crm: 'none', revenue: 'read' },
    },
    {
      tool: 'command_create_item',
      requiredModule: 'operations',
      requiredLevel: 'write',
      booksMembershipRead: false,
      contactRead: false,
      allowStaffScopes: { operations: 'write' },
      denyStaffScopes: { operations: 'read' },
    },
    {
      tool: 'crm_create_reminder',
      requiredModule: 'crm',
      requiredLevel: 'write',
      booksMembershipRead: false,
      contactRead: false,
      allowStaffScopes: { crm: 'write' },
      denyStaffScopes: { crm: 'read' },
    },
  ];

  it.each(PROMOTED_AUTHORITY_CASES)(
    '$tool enforces $requiredModule:$requiredLevel (OWNER allowed, scoped STAFF allowed, STAFF without scope refused)',
    async ({ tool, requiredModule, requiredLevel, booksMembershipRead, contactRead, allowStaffScopes, denyStaffScopes }) => {
      const flowTool = getToolByName(tool);
      expect(flowTool, `${tool} must exist in FLOW_TOOLS`).toBeDefined();
      expect(getManualEquivalentRoute(flowTool!).startsWith('/app/')).toBe(true);

      const req = graphActionRequirement(tool);
      expect(req).not.toBeNull();
      expect(keyMemberToolScopes(tool)).toEqual(
        expect.arrayContaining([{ module: requiredModule, minLevel: requiredLevel }]),
      );

      if (tool === 'command_create_item') {
        expect(CANONICAL_MODULE_TOOLS.operations.command_create_item).toBe('write');
      }
      expect(KEY_BOOKS_MEMBERSHIP_READ_TOOLS.has(tool)).toBe(booksMembershipRead);
      expect(GRAPH_ACTION_CONTACT_READ_TOOLS.has(tool)).toBe(contactRead);
      if (contactRead) {
        expect(noMemberToolRefusal(tool)).not.toBeNull();
      }

      // OWNER allowed
      const ownerRefusal = await memberToolScopeRefusal(
        makePrismaForMember({ role: 'OWNER', permissionScopes: null }) as any,
        'biz_1',
        'user_1',
        tool,
      );
      expect(ownerRefusal).toBeNull();

      // STAFF with required scope allowed
      const staffAllowRefusal = await memberToolScopeRefusal(
        makePrismaForMember({ role: 'STAFF', permissionScopes: allowStaffScopes }) as any,
        'biz_1',
        'user_1',
        tool,
      );
      expect(staffAllowRefusal).toBeNull();

      // STAFF without required scope refused
      const staffDenyRefusal = await memberToolScopeRefusal(
        makePrismaForMember({ role: 'STAFF', permissionScopes: denyStaffScopes }) as any,
        'biz_1',
        'user_1',
        tool,
      );
      expect(staffDenyRefusal).not.toBeNull();
      expect(staffDenyRefusal!).toContain(`${requiredModule} requires ${requiredLevel} access`);

      // Non-member refused
      const nonMemberRefusal = await memberToolScopeRefusal(
        makePrismaForMember(null) as any,
        'biz_1',
        'user_1',
        tool,
      );
      expect(nonMemberRefusal).not.toBeNull();

      // Money-deriving tools refuse platform SUPER_ADMIN without membership (D-104 / D-46)
      if (booksMembershipRead) {
        const saOutsiderRefusal = await memberToolScopeRefusal(
          makePrismaForMember({ userRole: 'SUPER_ADMIN', role: undefined }) as any,
          'biz_1',
          'user_1',
          tool,
        );
        expect(saOutsiderRefusal).not.toBeNull();
        expect(saOutsiderRefusal!).toMatch(/No access to this business|Not a member/i);
      }
    },
  );
});

describe('P154/P160: revenue authority enforcement through KeyCommand (D-100/D-145/D-234/D-104)', () => {
  const ALIASED_MONEY_READ_STEPS: Array<[string, string, string]> = [
    ['finance', 'summarizeCashPosition', 'finance_safe_to_spend'],
    ['finance', 'calculateSafeToSpend', 'finance_safe_to_spend'],
    ['finance', 'listOverdueInvoices', 'finance_list_overdue_invoices'],
    ['finance', 'generateMoneyMoves', 'finance_money_moves'],
    ['finance', 'cashflowForecast', 'finance_cashflow_forecast'],
    ['commerce', 'summarizeRevenue', 'commerce_summarize_revenue'],
  ];

  it.each(ALIASED_MONEY_READ_STEPS)(
    'refuses %s.%s (-> %s) for a member without revenue:read and non-member SUPER_ADMIN, allows OWNER and revenue:read STAFF',
    async (module, tool, canonicalName) => {
      const denied = makeHarness({
        member: { role: 'STAFF', permissionScopes: { revenue: 'none', crm: 'read' } },
      });
      const deniedRes = await denied.service.executeApprovedPlan('cmd_deny', makePlan(module, tool), 'biz_1', 'user_1');
      expect(denied.canonical.execute).not.toHaveBeenCalled();
      expect(deniedRes[0]).toMatchObject({ success: false, notExecuted: true, tool: canonicalName });
      expect(deniedRes[0].error).toMatch(/revenue requires read access/i);

      const anon = makeHarness();
      const anonRes = await anon.service.executeApprovedPlan('cmd_anon', makePlan(module, tool), 'biz_1', undefined);
      expect(anon.canonical.execute).not.toHaveBeenCalled();
      expect(anonRes[0]).toMatchObject({ success: false, notExecuted: true });

      const saOutsider = makeHarness({ member: { userRole: 'SUPER_ADMIN', role: undefined } });
      const saRes = await saOutsider.service.executeApprovedPlan('cmd_sa', makePlan(module, tool), 'biz_1', 'user_1');
      expect(saOutsider.canonical.execute).not.toHaveBeenCalled();
      expect(saRes[0]).toMatchObject({ success: false, notExecuted: true });
      expect(saRes[0].error).toMatch(/No access to this business/i);

      const owner = makeHarness({ member: { role: 'OWNER', permissionScopes: null } });
      const ownerRes = await owner.service.executeApprovedPlan('cmd_owner', makePlan(module, tool), 'biz_1', 'user_1');
      expect(owner.canonical.execute).toHaveBeenCalledTimes(1);
      expect(owner.canonical.execute.mock.calls[0][0]).toBe(canonicalName);
      expect(ownerRes[0]).toMatchObject({ success: true, tool: canonicalName });

      const staffRev = makeHarness({ member: { role: 'STAFF', permissionScopes: { revenue: 'read' } } });
      const staffRes = await staffRev.service.executeApprovedPlan('cmd_staff_rev', makePlan(module, tool), 'biz_1', 'user_1');
      expect(staffRev.canonical.execute).toHaveBeenCalledTimes(1);
      expect(staffRes[0]).toMatchObject({ success: true, tool: canonicalName });
    },
  );
});

describe('P154/P160: no risk-tier loosening, blockedTools preservation, and KEY_DISABLED (D-17)', () => {
  it('ensures no SAME/ALIAS entry loosens riskTier or exposes money tools as memberless', () => {
    for (const entry of LEGACY_TOOL_EQUIVALENCE) {
      if (entry.disposition !== 'SAME' && entry.disposition !== 'ALIAS') continue;
      const { module } = splitLegacyKey(entry.legacyKey);
      const canonicalTool = getToolByName(entry.canonicalTool!);
      expect(canonicalTool, entry.canonicalTool).toBeDefined();
      expect(
        canonicalTool!.riskTier,
        `${entry.legacyKey} -> ${entry.canonicalTool} must not loosen riskTier`,
      ).toBeGreaterThanOrEqual(LEGACY_RISK_TIERS[entry.legacyKey]);
      if (module === 'finance' || module === 'commerce') {
        expect(
          Object.prototype.hasOwnProperty.call(MEMBERLESS_KEY_TOOLS, entry.canonicalTool!),
          `${entry.canonicalTool} must never be memberless-allowlisted`,
        ).toBe(false);
      }
    }
  });

  it('keeps business blockedTools naming the legacy tool effective after canonical promotion', async () => {
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
    expect(results[0]).toMatchObject({ success: false, notExecuted: true });
    expect(results[0].error).toContain('Tool "summarizeCashPosition" is blocked');
  });

  it('refuses both promoted canonical tools and obsolete keys with zero execution when KEY_DISABLED=1', async () => {
    process.env.KEY_DISABLED = '1';

    const h = makeHarness({ member: { role: 'OWNER', permissionScopes: null } });
    for (const [module, tool] of [
      ['finance', 'summarizeCashPosition'],
      ['commerce', 'summarizeRevenue'],
      ['messages', 'listMessageIntake'],
    ] as const) {
      const res = await h.service.executeApprovedPlan('cmd_disabled', makePlan(module, tool), 'biz_1', 'user_1');
      expect(h.canonical.execute).not.toHaveBeenCalled();
      expect(res[0]).toMatchObject({ success: false, notExecuted: true });
      expect(res[0].error).toMatch(/KEY_DISABLED/i);
    }
  });
});
