/**
 * V1-09-KEY-COMMAND-GOVERNED — /key/command capability routing (PRS-M28).
 *
 * FLOW_TOOLS are bridged into the canonical (cortex) registry under their BARE
 * names by KeyCortexEfferentBridgeService; legacy organ tools are dotted
 * (`module.tool`). executeApprovedPlan used to look up only the dotted name, so
 * a bare FLOW_TOOLS capability always fell through to the legacy
 * KeyToolRegistryService (key-command.service.ts:199-221 at the V1 base).
 *
 * Ported from #160: ONLY the @@ -200 bare-name routing hunk. The @@ -173
 * message_intake remap (listMessageIntake -> inbox_list_threads) changes the
 * data source from the MessageIntake approval queue to inbox threads and is
 * deliberately NOT ported (PRS-M29); a control below pins that.
 *
 * Order: bare canonical name, then the dotted canonical name, then legacy.
 */
import { describe, expect, it, vi } from 'vitest';
import { KeyCommandService, type KeyCommandPlan } from './key-command.service';

type CanonicalDef = { name: string; module: string; riskTier: 1 | 2 | 3 | 4; requiresApproval: boolean };
type LegacyDef = { name: string; module: string; riskTier: 1 | 2 | 3 | 4; requiresApproval: boolean };

const AUTO = {
  allowed: true,
  requiresQuickConfirm: false,
  requiresFormalApproval: false,
  requiresAdminApproval: false,
  tier: 1,
  reason: 'Tier 1 auto-approved (max auto tier: 1)',
};

function harness(opts: { canonical?: CanonicalDef[]; legacy?: LegacyDef[] } = {}) {
  const prisma = { client: { keyCommand: { update: vi.fn().mockResolvedValue({}) } } };
  const timeline = { recordEvent: vi.fn().mockResolvedValue(undefined) };
  const canonicalTools = new Map((opts.canonical ?? []).map((t) => [t.name, t]));
  const legacyTools = new Map((opts.legacy ?? []).map((t) => [`${t.module}.${t.name}`, t]));
  const canonical = {
    getTool: vi.fn((name: string) => canonicalTools.get(name)),
    execute: vi.fn().mockResolvedValue({ success: true, data: { from: 'canonical' } }),
  };
  const legacy = {
    getTool: vi.fn((module: string, name: string) => legacyTools.get(`${module}.${name}`)),
    execute: vi.fn().mockResolvedValue({ success: true, data: { from: 'legacy' } }),
  };
  const oversight = {
    evaluate: vi.fn().mockResolvedValue(AUTO),
    // The business policy 'ask' reads for dotted-name blocks (SEC-V109-2): nothing blocked.
    getAutonomySettings: vi.fn().mockResolvedValue({ mode: 'assisted', blockedTools: [], blockedModules: [] }),
  };
  const safety = { check: vi.fn().mockResolvedValue({ allowed: true }) };
  const commands = {};

  // Positional, in constructor order. The two trailing collaborators are the
  // ones this packet appends; the unmodified service ignores them.
  const service = new KeyCommandService(
    prisma as any,
    timeline as any,
    legacy as any,
    commands as any,
    canonical as any,
    ...([oversight, safety] as any[]),
  );
  return { service, prisma, timeline, canonical, legacy, oversight, safety };
}

function step(tool: string, module: string, input: Record<string, unknown> = {}): KeyCommandPlan {
  return {
    summary: `route ${module}.${tool}`,
    steps: [{ tool, module, input, riskTier: 'LOW', requiresApproval: false }],
  };
}

describe('V1-09 /key/command: bare canonical capability routing (#160 @@ -200 hunk)', () => {
  it('sends a bare FLOW_TOOLS name to canonical.execute(bareName, {businessId,userId,commandId}, input)', async () => {
    const { service, canonical, legacy } = harness({
      canonical: [{ name: 'inbox_list_threads', module: 'read', riskTier: 1, requiresApproval: false }],
    });

    const results = await service.executeApprovedPlan('cmd_1', step('inbox_list_threads', 'flow', { limit: 20 }), 'biz_1', 'user_1');

    expect(canonical.execute).toHaveBeenCalledTimes(1);
    expect(canonical.execute).toHaveBeenCalledWith(
      'inbox_list_threads',
      expect.objectContaining({ businessId: 'biz_1', userId: 'user_1', commandId: 'cmd_1' }),
      { limit: 20 },
    );
    expect(legacy.execute).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({ success: true, data: { from: 'canonical' } });
  });

  it('prefers the bare canonical identity over a dotted one when both are registered', async () => {
    const { service, canonical } = harness({
      canonical: [
        { name: 'inbox_list_threads', module: 'read', riskTier: 1, requiresApproval: false },
        { name: 'flow.inbox_list_threads', module: 'flow', riskTier: 1, requiresApproval: false },
      ],
    });

    await service.executeApprovedPlan('cmd_2', step('inbox_list_threads', 'flow', { limit: 5 }), 'biz_1', 'user_1');

    expect(canonical.execute).toHaveBeenCalledTimes(1);
    expect(canonical.execute.mock.calls[0][0]).toBe('inbox_list_threads');
  });

  it('falls back to the dotted canonical name when no bare capability is registered (control)', async () => {
    const { service, canonical, legacy } = harness({
      canonical: [{ name: 'messages.listMessageIntake', module: 'messages', riskTier: 1, requiresApproval: false }],
      legacy: [{ name: 'listMessageIntake', module: 'messages', riskTier: 1, requiresApproval: false }],
    });

    await service.executeApprovedPlan(
      'cmd_3',
      step('listMessageIntake', 'messages', { status: 'reviewing', limit: 20 }),
      'biz_1',
      'user_1',
    );

    expect(canonical.execute).toHaveBeenCalledWith(
      'messages.listMessageIntake',
      expect.objectContaining({ businessId: 'biz_1', userId: 'user_1', commandId: 'cmd_3' }),
      { status: 'reviewing', limit: 20 },
    );
    expect(legacy.execute).not.toHaveBeenCalled();
  });

  it('falls back to the legacy registry last, for capabilities not yet converged (control)', async () => {
    const { service, canonical, legacy } = harness({
      legacy: [{ name: 'listMessageIntake', module: 'messages', riskTier: 1, requiresApproval: false }],
    });

    const results = await service.executeApprovedPlan(
      'cmd_4',
      step('listMessageIntake', 'messages', { status: 'reviewing', limit: 20 }),
      'biz_1',
      'user_1',
    );

    expect(canonical.execute).not.toHaveBeenCalled();
    expect(legacy.execute).toHaveBeenCalledWith(
      'messages',
      'listMessageIntake',
      expect.objectContaining({ businessId: 'biz_1', userId: 'user_1', commandId: 'cmd_4' }),
      { status: 'reviewing', limit: 20 },
    );
    expect(results[0]).toMatchObject({ success: true, data: { from: 'legacy' } });
  });

  it('still plans messages.message_intake as listMessageIntake: the #160 @@ -173 remap is not ported (PRS-M29, control)', async () => {
    const { service } = harness();

    const plan = await service.planActions('cmd_5', { domain: 'messages', action: 'message_intake' });

    expect(plan.steps).toEqual([
      expect.objectContaining({
        tool: 'listMessageIntake',
        module: 'messages',
        input: { status: 'reviewing', limit: 20 },
        riskTier: 'LOW',
        requiresApproval: false,
      }),
    ]);
    expect(plan.steps.map((s) => s.tool)).not.toContain('inbox_list_threads');
  });
});
