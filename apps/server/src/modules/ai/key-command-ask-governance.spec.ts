/**
 * V1-09-KEY-COMMAND-GOVERNED — a read-only, governed 'ask' mode (M44).
 *
 * POST /ai/businesses/:businessId/key/command with mode 'ask' is LLM-free:
 * interpretIntent -> planActions -> executeApprovedPlan (ai.controller.ts).
 * At the V1 base executeApprovedPlan ran every planned step at a hard-coded
 * autonomyLevel 2 without consulting AiOversightService or the autonomy kill
 * switch, 'scan drive' planned a real Google Drive sync at LOW risk, and an
 * unrecognised ask planned contacts.searchContacts, which no registry serves.
 *
 * After: 'ask' executes only read-tier capabilities, each one after an
 * oversight check and a kill-switch check, both failing closed; anything else
 * is reported as not executed. 'scan drive' requires approval. An
 * unrecognised ask plans nothing and says so.
 */
import { describe, expect, it, vi } from 'vitest';
import { KeyCommandService, type KeyCommandPlan } from './key-command.service';

type Def = { name: string; module: string; riskTier: 1 | 2 | 3 | 4; requiresApproval: boolean };

const AUTO = {
  allowed: true,
  requiresQuickConfirm: false,
  requiresFormalApproval: false,
  requiresAdminApproval: false,
  tier: 1,
  reason: 'Tier 1 auto-approved (max auto tier: 1)',
};

/** The legacy KeyToolRegistryService tools 'ask' plans, with their declared tiers. */
const LEGACY: Def[] = [
  { name: 'summarizeRevenue', module: 'commerce', riskTier: 1, requiresApproval: false },
  { name: 'recommendFollowUps', module: 'contacts', riskTier: 1, requiresApproval: false },
  { name: 'createCommandItem', module: 'contacts', riskTier: 1, requiresApproval: false },
  { name: 'scanDrive', module: 'connect', riskTier: 1, requiresApproval: false },
  { name: 'listDriveIntake', module: 'connect', riskTier: 1, requiresApproval: false },
  { name: 'listMessageIntake', module: 'messages', riskTier: 1, requiresApproval: false },
  { name: 'listRecentEngagement', module: 'social', riskTier: 1, requiresApproval: false },
];

function harness(
  opts: {
    canonical?: Def[];
    decision?: Record<string, unknown> | Error;
    killSwitch?: boolean;
    withOversight?: boolean;
    withSafety?: boolean;
    rawInput?: string;
  } = {},
) {
  const prisma = {
    client: {
      keyCommand: {
        update: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({ id: 'cmd_1', rawInput: opts.rawInput ?? '', mode: 'ask' }),
      },
    },
  };
  const timeline = { recordEvent: vi.fn().mockResolvedValue(undefined) };
  const canonicalTools = new Map((opts.canonical ?? []).map((t) => [t.name, t]));
  const legacyTools = new Map(LEGACY.map((t) => [`${t.module}.${t.name}`, t]));
  const canonical = {
    getTool: vi.fn((name: string) => canonicalTools.get(name)),
    execute: vi.fn().mockResolvedValue({ success: true, data: { from: 'canonical' } }),
  };
  const legacy = {
    getTool: vi.fn((module: string, name: string) => legacyTools.get(`${module}.${name}`)),
    execute: vi.fn().mockResolvedValue({ success: true, data: { from: 'legacy' } }),
  };
  const decision = opts.decision ?? AUTO;
  const oversight = {
    evaluate: vi.fn(async () => {
      if (decision instanceof Error) throw decision;
      return decision;
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
    legacy as any,
    {} as any,
    canonical as any,
    ...([opts.withOversight === false ? undefined : oversight, opts.withSafety === false ? undefined : safety] as any[]),
  );
  return { service, prisma, timeline, canonical, legacy, oversight, safety };
}

function plan(tool: string, module: string, input: Record<string, unknown> = {}): KeyCommandPlan {
  return { summary: `ask ${module}.${tool}`, steps: [{ tool, module, input, riskTier: 'LOW', requiresApproval: false }] };
}

/** The status the last keyCommand.update wrote. */
function lastStatus(prisma: ReturnType<typeof harness>['prisma']): string | undefined {
  const calls = prisma.client.keyCommand.update.mock.calls;
  return calls.length ? calls[calls.length - 1][0].data.status : undefined;
}

function expectNothingRan(h: ReturnType<typeof harness>) {
  expect(h.legacy.execute).not.toHaveBeenCalled();
  expect(h.canonical.execute).not.toHaveBeenCalled();
}

describe("V1-09 'scan drive' requires approval", () => {
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

  it("does not run the sync from 'ask': the step is reported as awaiting approval", async () => {
    const h = harness({ rawInput: 'sync drive' });
    const planned = await h.service.planActions('cmd_1', await h.service.interpretIntent('cmd_1'));

    const results = await h.service.executeApprovedPlan('cmd_1', planned, 'biz_1', 'user_1');

    expectNothingRan(h);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ success: false, notExecuted: true, requiresApproval: true });
    expect(lastStatus(h.prisma)).not.toBe('EXECUTED');
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

describe("V1-09 'ask' executes read-tier capabilities only after an oversight check", () => {
  it('asks AiOversightService before executing a legacy read, then runs it at INTERNAL_EXEC', async () => {
    const h = harness();

    const results = await h.service.executeApprovedPlan('cmd_1', plan('summarizeRevenue', 'commerce'), 'biz_1', 'user_1');

    expect(h.oversight.evaluate).toHaveBeenCalledWith('biz_1', 'commerce.summarizeRevenue');
    expect(h.legacy.execute).toHaveBeenCalledWith(
      'commerce',
      'summarizeRevenue',
      expect.objectContaining({ businessId: 'biz_1', userId: 'user_1', commandId: 'cmd_1', autonomyLevel: 2 }),
      {},
    );
    expect(h.oversight.evaluate.mock.invocationCallOrder[0]).toBeLessThan(h.legacy.execute.mock.invocationCallOrder[0]);
    expect(results[0]).toMatchObject({ success: true });
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

    const results = await h.service.executeApprovedPlan('cmd_1', plan('listMessageIntake', 'messages'), 'biz_1', 'user_1');

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

describe("V1-09 'ask' honours the autonomy kill switch on every registry path", () => {
  it('runs no legacy read while the business kill switch is on', async () => {
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

  it('does not execute a legacy tier-1 write (contacts.createCommandItem) planned LOW', async () => {
    const h = harness();

    const results = await h.service.executeApprovedPlan('cmd_1', plan('createCommandItem', 'contacts', { title: 't' }), 'biz_1', 'user_1');

    expectNothingRan(h);
    expect(results[0]).toMatchObject({ success: false, notExecuted: true, requiresApproval: true });
  });

  it('keeps answering every read intent it plans (control)', async () => {
    const intents = [
      { domain: 'commerce', action: 'revenue_summary' },
      { domain: 'contacts', action: 'follow_up' },
      { domain: 'connect', action: 'drive_findings' },
      { domain: 'messages', action: 'message_intake' },
      { domain: 'social', action: 'recent_engagement' },
    ];
    for (const intent of intents) {
      const h = harness();
      const planned = await h.service.planActions('cmd_1', intent);
      const results = await h.service.executeApprovedPlan('cmd_1', planned, 'biz_1', 'user_1');
      expect(h.legacy.execute, `${intent.domain}.${intent.action}`).toHaveBeenCalledTimes(1);
      expect(results.every((r) => r.success), `${intent.domain}.${intent.action}`).toBe(true);
    }
  });
});
