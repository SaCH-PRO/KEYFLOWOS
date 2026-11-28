/**
 * V1-09-KEY-COMMAND-GOVERNED / P160 (RR-LEGACY-FALLBACK-REMOVE) — a read-only, governed 'ask' mode.
 *
 * POST /ai/businesses/:businessId/key/command with mode 'ask' is LLM-free:
 * interpretIntent -> planActions -> executeApprovedPlan (ai.controller.ts).
 *
 * 'ask' executes only canonical read-tier capabilities, each one after an
 * oversight check, business module/tool block check, member scope check, and
 * kill-switch check, all failing closed; anything else is reported as not
 * executed. Obsolete hidden-v1 tools (connect.scanDrive, connect.listDriveIntake,
 * messages.listMessageIntake, social.listRecentEngagement) fail closed with a
 * plain refusal. An unrecognised ask plans nothing and says so.
 */
import { describe, expect, it, vi } from 'vitest';
import { FLOW_TOOLS } from './flow-tool-registry';
import { KeyCommandService, type KeyCommandPlan } from './key-command.service';
import { getLegacyToolEquivalence } from './legacy-tool-equivalence';

type Def = { name: string; module: string; riskTier: 1 | 2 | 3 | 4; requiresApproval: boolean };

const AUTO = {
  allowed: true,
  requiresQuickConfirm: false,
  requiresFormalApproval: false,
  requiresAdminApproval: false,
  tier: 1,
  reason: 'Tier 1 auto-approved (max auto tier: 1)',
};

/** Default canonical capabilities wired into the harness (promoted FLOW_TOOLS). */
const DEFAULT_CANONICAL: Def[] = FLOW_TOOLS.map((t) => ({
  name: t.name,
  module: t.family,
  riskTier: t.riskTier,
  requiresApproval: false,
}));

/** The business policy oversight reads (AiOversightService.getAutonomySettings). */
const POLICY = {
  mode: 'assisted',
  maxAutoTier: 1,
  blockedTools: [] as string[],
  blockedModules: [] as string[],
  autonomyLevel: 0,
  approvedTools: [] as string[],
  approvalTimeoutHours: 24,
};

/** The asking member's rows: a User and a Membership in biz_1. */
type Member = { userRole?: string; role?: string; permissionScopes?: Record<string, string> | null } | null;

function harness(
  opts: {
    canonical?: Def[];
    decision?: Record<string, unknown> | Error;
    killSwitch?: boolean;
    withOversight?: boolean;
    withSafety?: boolean;
    rawInput?: string;
    /** Defaults to the OWNER, who reads every contact. */
    member?: Member;
    memberLookup?: Error;
    policy?: Partial<typeof POLICY> & { degraded?: boolean };
    policyRead?: Error;
    /** What the canonical registry's execute answers. */
    canonicalResult?: Record<string, unknown>;
    /** Ids the contact visibility query returns. */
    visibleContactIds?: string[];
  } = {},
) {
  const member: Member = opts.member === undefined ? { role: 'OWNER', permissionScopes: null } : opts.member;
  const lookup = <T>(value: T) =>
    vi.fn(async () => {
      if (opts.memberLookup) throw opts.memberLookup;
      return value;
    });
  const prisma = {
    client: {
      keyCommand: {
        update: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({ id: 'cmd_1', rawInput: opts.rawInput ?? '', mode: 'ask' }),
      },
      user: { findUnique: lookup(member ? { id: 'user_1', role: member.userRole ?? 'USER' } : null) },
      membership: {
        findUnique: lookup(
          member && member.role ? { userId: 'user_1', businessId: 'biz_1', role: member.role, permissionScopes: member.permissionScopes ?? null } : null,
        ),
      },
      contact: {
        findMany: vi.fn(async () => (opts.visibleContactIds ?? []).map((id) => ({ id }))),
      },
    },
  };
  const timeline = { recordEvent: vi.fn().mockResolvedValue(undefined) };
  const canonicalTools = new Map((opts.canonical ?? DEFAULT_CANONICAL).map((t) => [t.name, t]));
  const canonical = {
    getTool: vi.fn((name: string) => canonicalTools.get(name)),
    execute: vi.fn().mockResolvedValue(opts.canonicalResult ?? { success: true, data: { from: 'canonical' } }),
  };
  const decision = opts.decision ?? AUTO;
  const oversight = {
    evaluate: vi.fn(async () => {
      if (decision instanceof Error) throw decision;
      return decision;
    }),
    getAutonomySettings: vi.fn(async () => {
      if (opts.policyRead) throw opts.policyRead;
      return { ...POLICY, ...opts.policy };
    }),
  };
  const safety = {
    check: vi.fn().mockResolvedValue(
      opts.killSwitch
        ? { allowed: false, reason: 'Global autonomy kill switch is active for this business' }
        : { allowed: true },
    ),
  };

  const service = new KeyCommandService(
    prisma as any,
    timeline as any,
    {} as any,
    canonical as any,
    ...([opts.withOversight === false ? undefined : oversight, opts.withSafety === false ? undefined : safety] as any[]),
  );
  return { service, prisma, timeline, canonical, oversight, safety };
}

function plan(tool: string, module: string, input: Record<string, unknown> = {}): KeyCommandPlan {
  return { summary: `ask ${module}.${tool}`, steps: [{ tool, module, input, riskTier: 'LOW', requiresApproval: false }] };
}

/** The status the last keyCommand.update wrote. */
function lastStatus(prisma: ReturnType<typeof harness>['prisma']): string | undefined {
  const calls = prisma.client.keyCommand.update.mock.calls;
  return calls.length ? calls[calls.length - 1][0].data.status : undefined;
}

/** The executionResult the last keyCommand.update wrote. */
function lastExecutionResult(prisma: ReturnType<typeof harness>['prisma']): { success: boolean; outputs: Array<Record<string, unknown>> } {
  const calls = prisma.client.keyCommand.update.mock.calls as unknown as Array<[{ data: { executionResult?: unknown } }]>;
  return calls[calls.length - 1][0].data.executionResult as { success: boolean; outputs: Array<Record<string, unknown>> };
}

/** The Activity ledger entry executeApprovedPlan recorded. */
function lastLedgerEvent(timeline: ReturnType<typeof harness>['timeline']): Record<string, any> {
  const calls = timeline.recordEvent.mock.calls as unknown as Array<[Record<string, any>]>;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0];
}

function expectNothingRan(h: ReturnType<typeof harness>) {
  expect(h.canonical.execute).not.toHaveBeenCalled();
}

describe("V1-09 / P160 'scan drive' requires approval in plan and is refused as OBSOLETE in execution", () => {
  it('plans the Drive sync as an approval-required step, not a LOW read', async () => {
    const h = harness({ rawInput: 'scan drive for new documents' });

    const intent = await h.service.interpretIntent('cmd_1');
    expect(intent).toMatchObject({ domain: 'connect', action: 'scan_drive' });

    const planned = await h.service.planActions('cmd_1', intent);
    expect(planned.steps).toHaveLength(1);
    expect(planned.steps[0]).toMatchObject({ tool: 'scanDrive', module: 'connect', requiresApproval: true });
    expect(planned.steps[0].riskTier).not.toBe('LOW');
    expect(h.service.classifyRisk(planned)).not.toBe('LOW');
  });

  it("does not run the sync from 'ask': connect.scanDrive is refused as OBSOLETE (hidden v1 module, D-152)", async () => {
    const h = harness({ rawInput: 'sync drive' });
    const planned = await h.service.planActions('cmd_1', await h.service.interpretIntent('cmd_1'));

    const results = await h.service.executeApprovedPlan('cmd_1', planned, 'biz_1', 'user_1');

    expectNothingRan(h);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ success: false, notExecuted: true, tool: 'connect.scanDrive' });
    expect(results[0].error).toMatch(/obsolete/i);
    expect(lastStatus(h.prisma)).toBe('REJECTED');
  });
});

describe('V1-09 an unrecognised ask plans nothing and says so', () => {
  it('plans no step (no unregistered contacts.searchContacts) and the summary says nothing was planned', async () => {
    const h = harness({ rawInput: 'what is the meaning of life' });
    const intent = await h.service.interpretIntent('cmd_1');
    expect(intent).toMatchObject({ domain: 'general', action: 'unknown' });

    const planned = await h.service.planActions('cmd_1', intent);

    expect(planned.steps).toEqual([]);
    expect(planned.steps.map((s) => s.tool)).not.toContain('searchContacts');
    expect(planned.summary).toMatch(/nothing was planned/i);
    const persisted = h.prisma.client.keyCommand.update.mock.calls.at(-1)?.[0].data;
    expect(persisted.planSummary).toBe(planned.summary);
  });

  it('executing an empty plan runs nothing and is not recorded as EXECUTED', async () => {
    const h = harness();

    const results = await h.service.executeApprovedPlan('cmd_1', { summary: 'nothing', steps: [] }, 'biz_1', 'user_1');

    expect(results).toEqual([]);
    expectNothingRan(h);
    expect(lastStatus(h.prisma)).toBeDefined();
    expect(lastStatus(h.prisma)).not.toBe('EXECUTED');
  });

  it('a planned capability that no registry serves is reported, never dispatched', async () => {
    const h = harness();

    const results = await h.service.executeApprovedPlan('cmd_1', plan('auditStorefront', 'storefront'), 'biz_1', 'user_1');

    expectNothingRan(h);
    expect(results[0]).toMatchObject({ success: false, notExecuted: true });
    expect(results[0].error).toMatch(/not registered/i);
  });
});

describe("V1-09 'ask' executes canonical read-tier capabilities only after an oversight check", () => {
  it('asks AiOversightService before executing a promoted canonical read, then runs it at INTERNAL_EXEC', async () => {
    const h = harness();

    const results = await h.service.executeApprovedPlan('cmd_1', plan('summarizeRevenue', 'commerce'), 'biz_1', 'user_1');

    expect(h.oversight.evaluate).toHaveBeenCalledWith('biz_1', 'commerce_summarize_revenue');
    expect(h.canonical.execute).toHaveBeenCalledWith(
      'commerce_summarize_revenue',
      expect.objectContaining({ businessId: 'biz_1', userId: 'user_1', commandId: 'cmd_1', autonomyLevel: 2 }),
      {},
    );
    expect(h.oversight.evaluate.mock.invocationCallOrder[0]).toBeLessThan(h.canonical.execute.mock.invocationCallOrder[0]);
    expect(results[0]).toMatchObject({ success: true, tool: 'commerce_summarize_revenue' });
    expect(lastStatus(h.prisma)).toBe('EXECUTED');
  });

  it('asks oversight with the bare canonical name before executing a FLOW_TOOLS read', async () => {
    const h = harness({ canonical: [{ name: 'inbox_list_threads', module: 'read', riskTier: 1, requiresApproval: false }] });

    await h.service.executeApprovedPlan('cmd_1', plan('inbox_list_threads', 'flow', { limit: 20 }), 'biz_1', 'user_1');

    expect(h.oversight.evaluate).toHaveBeenCalledWith('biz_1', 'inbox_list_threads');
    expect(h.canonical.execute).toHaveBeenCalledTimes(1);
    expect(h.oversight.evaluate.mock.invocationCallOrder[0]).toBeLessThan(h.canonical.execute.mock.invocationCallOrder[0]);
  });

  it('runs nothing when oversight refuses (restricted mode), and says why', async () => {
    const h = harness({
      decision: { ...AUTO, allowed: false, reason: 'AI is in restricted mode — no actions allowed' },
    });

    const results = await h.service.executeApprovedPlan('cmd_1', plan('summarizeRevenue', 'commerce'), 'biz_1', 'user_1');

    expectNothingRan(h);
    expect(results[0]).toMatchObject({ success: false, notExecuted: true });
    expect(results[0].error).toMatch(/restricted mode/);
    expect(lastStatus(h.prisma)).not.toBe('EXECUTED');
  });

  it('runs nothing when a FLOW_TOOLS read needs confirmation under the business policy', async () => {
    const h = harness({
      canonical: [{ name: 'inbox_list_threads', module: 'read', riskTier: 1, requiresApproval: false }],
      decision: { ...AUTO, requiresQuickConfirm: true, reason: 'Tier 1 exceeds auto-execute threshold (0), requires confirmation' },
    });

    const results = await h.service.executeApprovedPlan('cmd_1', plan('inbox_list_threads', 'flow'), 'biz_1', 'user_1');

    expectNothingRan(h);
    expect(results[0]).toMatchObject({ success: false, notExecuted: true, requiresApproval: true });
  });

  it('fails closed when the oversight check throws', async () => {
    const h = harness({ decision: new Error('connection terminated') });

    const results = await h.service.executeApprovedPlan('cmd_1', plan('summarizeRevenue', 'commerce'), 'biz_1', 'user_1');

    expectNothingRan(h);
    expect(results[0]).toMatchObject({ success: false, notExecuted: true });
  });

  it('fails closed when no oversight service is wired', async () => {
    const h = harness({ withOversight: false });

    const results = await h.service.executeApprovedPlan('cmd_1', plan('summarizeRevenue', 'commerce'), 'biz_1', 'user_1');

    expectNothingRan(h);
    expect(results[0]).toMatchObject({ success: false, notExecuted: true });
  });
});

describe("V1-09 'ask' honours the autonomy kill switch on every path", () => {
  it('runs no canonical read while the business kill switch is on', async () => {
    const h = harness({ killSwitch: true });

    const results = await h.service.executeApprovedPlan('cmd_1', plan('summarizeRevenue', 'commerce'), 'biz_1', 'user_1');

    expect(h.safety.check).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'biz_1' }));
    expectNothingRan(h);
    expect(results[0]).toMatchObject({ success: false, notExecuted: true });
    expect(results[0].error).toMatch(/kill switch/i);
  });

  it('fails closed when the kill switch cannot be read', async () => {
    const h = harness({ withSafety: false });

    const results = await h.service.executeApprovedPlan('cmd_1', plan('summarizeRevenue', 'commerce'), 'biz_1', 'user_1');

    expectNothingRan(h);
    expect(results[0]).toMatchObject({ success: false, notExecuted: true });
  });
});

describe("V1-09 'ask' is read-only", () => {
  it('does not execute a tier-1 FLOW_TOOLS write (crm_create_contact) even when planned LOW', async () => {
    const h = harness({ canonical: [{ name: 'crm_create_contact', module: 'crud', riskTier: 1, requiresApproval: false }] });

    const results = await h.service.executeApprovedPlan('cmd_1', plan('crm_create_contact', 'flow', { firstName: 'X' }), 'biz_1', 'user_1');

    expectNothingRan(h);
    expect(results[0]).toMatchObject({ success: false, notExecuted: true, requiresApproval: true });
  });

  it('does not execute (or file a proposal for) a tier-2 canonical capability', async () => {
    const h = harness({ canonical: [{ name: 'commerce_create_invoice', module: 'crud', riskTier: 2, requiresApproval: false }] });

    const results = await h.service.executeApprovedPlan('cmd_1', plan('commerce_create_invoice', 'flow'), 'biz_1', 'user_1');

    expectNothingRan(h);
    expect(results[0]).toMatchObject({ success: false, notExecuted: true, requiresApproval: true });
  });

  it('does not execute a promoted tier-1 write (contacts.createCommandItem -> command_create_item) planned LOW', async () => {
    const h = harness();

    const results = await h.service.executeApprovedPlan('cmd_1', plan('createCommandItem', 'contacts', { title: 't' }), 'biz_1', 'user_1');

    expectNothingRan(h);
    expect(results[0]).toMatchObject({ success: false, notExecuted: true, requiresApproval: true, tool: 'command_create_item' });
  });

  it('keeps answering every active v1 read intent it plans (control)', async () => {
    // Hidden v1 intents (social, connect, messages intake) are OBSOLETE per P154/P160 (D-152/D-153).
    const intents = [
      { domain: 'commerce', action: 'revenue_summary', expectedCanonical: 'commerce_summarize_revenue' },
      { domain: 'contacts', action: 'follow_up', expectedCanonical: 'crm_recommend_follow_ups' },
    ];
    for (const intent of intents) {
      const h = harness();
      const planned = await h.service.planActions('cmd_1', intent);
      const results = await h.service.executeApprovedPlan('cmd_1', planned, 'biz_1', 'user_1');
      expect(h.canonical.execute, `${intent.domain}.${intent.action}`).toHaveBeenCalledTimes(1);
      expect(h.canonical.execute.mock.calls[0][0]).toBe(intent.expectedCanonical);
      expect(results.every((r) => r.success), `${intent.domain}.${intent.action}`).toBe(true);
    }
  });
});

// ── Review repairs (SEC-V109-1..3, CR-V109-1) ──────────────────────────────

const FOLLOW_UPS = {
  success: true,
  data: {
    contacts: [
      { id: 'c_team', name: 'Team Contact', email: 'team@example.test', daysSinceContact: 40, status: 'ACTIVE' },
      { id: 'c_private_other', name: 'Private Other', email: 'private@example.test', daysSinceContact: 60, status: 'ACTIVE' },
    ],
    count: 2,
  },
};

describe("SEC-V109-1 'ask' reads only what the asking member may read", () => {
  it('runs no follow-up read for a member whose crm scope is none', async () => {
    const h = harness({ member: { role: 'STAFF', permissionScopes: { crm: 'none' } }, canonicalResult: FOLLOW_UPS });

    const results = await h.service.executeApprovedPlan('cmd_1', plan('recommendFollowUps', 'contacts'), 'biz_1', 'user_1');

    expectNothingRan(h);
    expect(results[0]).toMatchObject({ success: false, notExecuted: true, tool: 'crm_recommend_follow_ups' });
    expect(results[0].error).toMatch(/crm requires read access/);
    expect(JSON.stringify(results)).not.toContain('private@example.test');
    expect(lastStatus(h.prisma)).toBe('REJECTED');
  });

  it("filters the follow-ups by the member's CRM visibility clause before returning them", async () => {
    const h = harness({
      member: { role: 'STAFF', permissionScopes: { crm: 'read' } },
      canonicalResult: FOLLOW_UPS,
      visibleContactIds: ['c_team'],
    });

    const results = await h.service.executeApprovedPlan('cmd_1', plan('recommendFollowUps', 'contacts'), 'biz_1', 'user_1');

    expect(h.canonical.execute).toHaveBeenCalledTimes(1);
    expect(h.canonical.execute.mock.calls[0][0]).toBe('crm_recommend_follow_ups');
    expect(h.prisma.client.contact.findMany).toHaveBeenCalledWith({
      where: {
        businessId: 'biz_1',
        id: { in: ['c_team', 'c_private_other'] },
        AND: [{ OR: [{ visibility: { in: ['TEAM', 'SHARED'] } }, { ownerId: 'user_1' }, { shares: { some: { userId: 'user_1' } } }] }],
      },
      select: { id: true },
    });
    expect(results[0]).toMatchObject({ success: true, data: { count: 1 } });
    expect((results[0].data as typeof FOLLOW_UPS.data).contacts.map((c) => c.id)).toEqual(['c_team']);
    expect(JSON.stringify(results)).not.toContain('private@example.test');
  });

  it('returns every follow-up to the OWNER without a visibility query (control)', async () => {
    const h = harness({ canonicalResult: FOLLOW_UPS });

    const results = await h.service.executeApprovedPlan('cmd_1', plan('recommendFollowUps', 'contacts'), 'biz_1', 'user_1');

    expect(h.prisma.client.contact.findMany).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({ success: true, data: { count: 2 } });
  });

  it('runs no revenue read for a member whose revenue scope is none', async () => {
    const h = harness({ member: { role: 'STAFF', permissionScopes: { revenue: 'none', crm: 'read' } } });

    const results = await h.service.executeApprovedPlan('cmd_1', plan('summarizeRevenue', 'commerce'), 'biz_1', 'user_1');

    expectNothingRan(h);
    expect(results[0]).toMatchObject({ success: false, notExecuted: true });
    expect(results[0].error).toMatch(/revenue requires read access/);
  });

  it('a STAFF member with role-default scopes still reads revenue (control)', async () => {
    const h = harness({ member: { role: 'STAFF', permissionScopes: null } });

    const results = await h.service.executeApprovedPlan('cmd_1', plan('summarizeRevenue', 'commerce'), 'biz_1', 'user_1');

    expect(h.canonical.execute).toHaveBeenCalledTimes(1);
    expect(h.canonical.execute.mock.calls[0][0]).toBe('commerce_summarize_revenue');
    expect(results[0]).toMatchObject({ success: true });
  });

  it('runs no member-scoped read when no member is named, or the lookup fails', async () => {
    const anonymous = harness();
    const noMember = await anonymous.service.executeApprovedPlan('cmd_1', plan('recommendFollowUps', 'contacts'), 'biz_1');
    expectNothingRan(anonymous);
    expect(noMember[0]).toMatchObject({ success: false, notExecuted: true });

    const broken = harness({ memberLookup: new Error('connection terminated') });
    const failed = await broken.service.executeApprovedPlan('cmd_1', plan('summarizeRevenue', 'commerce'), 'biz_1', 'user_1');
    expectNothingRan(broken);
    expect(failed[0]).toMatchObject({ success: false, notExecuted: true });
  });

  it('a non-member is refused', async () => {
    const h = harness({ member: { role: undefined } });

    const results = await h.service.executeApprovedPlan('cmd_1', plan('summarizeRevenue', 'commerce'), 'biz_1', 'user_1');

    expectNothingRan(h);
    expect(results[0]).toMatchObject({ success: false, notExecuted: true });
  });

  it("keeps a member-scoped read's outcome on the KeyCommand row without its data, which only the asker receives", async () => {
    const h = harness({ canonicalResult: FOLLOW_UPS });

    const results = await h.service.executeApprovedPlan('cmd_1', plan('recommendFollowUps', 'contacts'), 'biz_1', 'user_1');

    expect(results[0].data).toEqual(FOLLOW_UPS.data);
    const persisted = lastExecutionResult(h.prisma);
    expect(persisted.outputs[0]).toMatchObject({ success: true, tool: 'crm_recommend_follow_ups', dataWithheld: true });
    expect(persisted.outputs[0]).not.toHaveProperty('data');
    expect(JSON.stringify(persisted)).not.toContain('private@example.test');
  });
});

describe("SEC-V109-2 'ask' honours the business's module and tool blocks on promoted reads", () => {
  it.each([
    ['contacts.recommendFollowUps', 'recommendFollowUps', 'contacts', 'crm'],
    ['commerce.summarizeRevenue', 'summarizeRevenue', 'commerce', 'commerce'],
    ['commerce.summarizeRevenue', 'summarizeRevenue', 'commerce', 'revenue'],
  ])('runs no %s while blockedModules holds %s', async (_name, tool, module, blockedModule) => {
    const h = harness({ policy: { blockedModules: [blockedModule] } });

    const results = await h.service.executeApprovedPlan('cmd_1', plan(tool, module), 'biz_1', 'user_1');

    expectNothingRan(h);
    expect(results[0]).toMatchObject({ success: false, notExecuted: true });
    expect(results[0].error).toContain(`Module "${blockedModule}" is blocked`);
  });

  it('runs no read whose bare legacy or canonical tool name is in blockedTools', async () => {
    for (const blockedName of ['summarizeRevenue', 'commerce_summarize_revenue']) {
      const h = harness({ policy: { blockedTools: [blockedName] } });
      const results = await h.service.executeApprovedPlan('cmd_1', plan('summarizeRevenue', 'commerce'), 'biz_1', 'user_1');
      expectNothingRan(h);
      expect(results[0].error).toContain(`Tool "${blockedName}" is blocked`);
    }
  });

  it('fails closed when the business policy cannot be read', async () => {
    const degraded = harness({ policy: { degraded: true } });
    expect((await degraded.service.executeApprovedPlan('cmd_1', plan('summarizeRevenue', 'commerce'), 'biz_1', 'user_1'))[0])
      .toMatchObject({ success: false, notExecuted: true });
    expectNothingRan(degraded);

    const thrown = harness({ policyRead: new Error('connection terminated') });
    expect((await thrown.service.executeApprovedPlan('cmd_1', plan('summarizeRevenue', 'commerce'), 'biz_1', 'user_1'))[0])
      .toMatchObject({ success: false, notExecuted: true });
    expectNothingRan(thrown);
  });

  it('a block on another module does not stop the read (control)', async () => {
    const h = harness({ policy: { blockedModules: ['bookings', 'marketing'], blockedTools: ['crm_delete_contact'] } });

    const results = await h.service.executeApprovedPlan('cmd_1', plan('summarizeRevenue', 'commerce'), 'biz_1', 'user_1');

    expect(h.canonical.execute).toHaveBeenCalledTimes(1);
    expect(results[0]).toMatchObject({ success: true });
  });
});

describe('SEC-V109-3 the Activity ledger says what the KeyCommand row says, and who asked', () => {
  it('a refused ask (kill switch) is recorded as refused, not failed, with the asking member', async () => {
    const h = harness({ killSwitch: true });

    await h.service.executeApprovedPlan('cmd_1', plan('summarizeRevenue', 'commerce'), 'biz_1', 'user_1');

    expect(lastStatus(h.prisma)).toBe('REJECTED');
    const event = lastLedgerEvent(h.timeline);
    expect(event).toMatchObject({ action: 'command.refused', status: 'CANCELLED', actorId: 'user_1', entityId: 'cmd_1' });
    expect(event.title).not.toMatch(/failed/i);
    expect(event.data.results[0]).toMatchObject({ tool: 'commerce_summarize_revenue', success: false, notExecuted: true });
    expect(event.data.requestedBy).toBe('user_1');
  });

  it("an approval-required canonical write step is recorded as awaiting approval", async () => {
    const h = harness();
    const approvalPlan: KeyCommandPlan = {
      summary: 'create invoice',
      steps: [{ tool: 'commerce_create_invoice', module: 'flow', input: {}, riskTier: 'MEDIUM', requiresApproval: true }],
    };

    await h.service.executeApprovedPlan('cmd_1', approvalPlan, 'biz_1', 'user_1');

    expect(lastStatus(h.prisma)).toBe('PLANNED');
    expect(lastLedgerEvent(h.timeline)).toMatchObject({ action: 'command.awaiting_approval', status: 'PENDING' });
  });

  it('an empty plan is recorded as refused', async () => {
    const h = harness();

    await h.service.executeApprovedPlan('cmd_1', { summary: 'nothing', steps: [] }, 'biz_1', 'user_1');

    expect(lastStatus(h.prisma)).toBe('REJECTED');
    expect(lastLedgerEvent(h.timeline)).toMatchObject({ action: 'command.refused', status: 'CANCELLED' });
  });

  it('an executed ask is recorded as executed, with the asking member', async () => {
    const h = harness();

    await h.service.executeApprovedPlan('cmd_1', plan('summarizeRevenue', 'commerce'), 'biz_1', 'user_1');

    expect(lastStatus(h.prisma)).toBe('EXECUTED');
    expect(lastLedgerEvent(h.timeline)).toMatchObject({ action: 'command.executed', status: 'COMPLETED', actorId: 'user_1' });
  });

  it('a read that ran and failed is recorded as failed', async () => {
    const h = harness({ canonicalResult: { success: false, error: 'boom' } });

    await h.service.executeApprovedPlan('cmd_1', plan('summarizeRevenue', 'commerce'), 'biz_1', 'user_1');

    expect(lastStatus(h.prisma)).toBe('FAILED');
    expect(lastLedgerEvent(h.timeline)).toMatchObject({ action: 'command.failed', status: 'FAILED' });
  });
});

describe('CR-V109-1 advisory mode refuses ask reads (ruling: oversight governs reads in advisory)', () => {
  it('runs nothing and says advisory when oversight answers advisory', async () => {
    const h = harness({
      decision: { ...AUTO, allowed: false, reason: 'AI is in advisory mode — suggestions only, no execution' },
    });

    const results = await h.service.executeApprovedPlan('cmd_1', plan('summarizeRevenue', 'commerce'), 'biz_1', 'user_1');

    expectNothingRan(h);
    expect(results[0]).toMatchObject({ success: false, notExecuted: true });
    expect(results[0].error).toMatch(/advisory mode/);
    expect(lastStatus(h.prisma)).toBe('REJECTED');
  });
});

describe('P154/P160: blockedModules on SAME/ALIAS canonical-routed tools and unknown legacy keys', () => {
  const ALIASED_FINANCE: Array<[string, string, string]> = [
    ['finance', 'summarizeCashPosition', 'finance_safe_to_spend'],
    ['finance', 'calculateSafeToSpend', 'finance_safe_to_spend'],
    ['finance', 'listOverdueInvoices', 'finance_list_overdue_invoices'],
    ['finance', 'generateMoneyMoves', 'finance_money_moves'],
    ['finance', 'cashflowForecast', 'finance_cashflow_forecast'],
  ];

  it.each(ALIASED_FINANCE)(
    'blocks %s.%s (-> %s) when blockedModules holds "finance" or "revenue" (case-insensitive)',
    async (module, tool, canonicalName) => {
      for (const blocked of ['finance', 'revenue', 'FINANCE']) {
        const h = harness({ policy: { blockedModules: [blocked] } });
        const results = await h.service.executeApprovedPlan('cmd_blk', plan(tool, module), 'biz_1', 'user_1');
        expectNothingRan(h);
        expect(results[0]).toMatchObject({ success: false, notExecuted: true, tool: canonicalName });
        expect(results[0].error).toMatch(/Module "(finance|revenue)" is blocked by business settings/i);
      }
    },
  );

  it('refuses an aliased finance tool when business autonomy policy is degraded or throws', async () => {
    const degraded = harness({ policy: { degraded: true } });
    const res1 = await degraded.service.executeApprovedPlan('cmd_deg', plan('summarizeCashPosition', 'finance'), 'biz_1', 'user_1');
    expectNothingRan(degraded);
    expect(res1[0]).toMatchObject({ success: false, notExecuted: true, tool: 'finance_safe_to_spend' });

    const thrown = harness({ policyRead: new Error('db down') });
    const res2 = await thrown.service.executeApprovedPlan('cmd_err', plan('summarizeCashPosition', 'finance'), 'biz_1', 'user_1');
    expectNothingRan(thrown);
    expect(res2[0]).toMatchObject({ success: false, notExecuted: true, tool: 'finance_safe_to_spend' });
  });

  it('allows an aliased finance tool when an unrelated module is blocked (control)', async () => {
    const h = harness({ policy: { blockedModules: ['bookings', 'marketing'] } });
    const results = await h.service.executeApprovedPlan('cmd_ok', plan('summarizeCashPosition', 'finance'), 'biz_1', 'user_1');
    expect(h.canonical.execute).toHaveBeenCalledTimes(1);
    expect(h.canonical.execute.mock.calls[0][0]).toBe('finance_safe_to_spend');
    expect(results[0]).toMatchObject({ success: true, tool: 'finance_safe_to_spend' });
  });

  it('returns undefined for an unknown legacy key and fails closed in executeApprovedPlan', async () => {
    expect(getLegacyToolEquivalence('unknown.nonexistentTool')).toBeUndefined();
    const h = harness();
    const results = await h.service.executeApprovedPlan('cmd_unk', plan('nonexistentTool', 'unknown'), 'biz_1', 'user_1');
    expectNothingRan(h);
    expect(results[0]).toMatchObject({ success: false, notExecuted: true, tool: 'unknown.nonexistentTool' });
    expect(results[0].error).toMatch(/not registered/i);
  });
});
