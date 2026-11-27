/**
 * V1-09-KEY-COMMAND-GOVERNED / P160 (RR-LEGACY-FALLBACK-REMOVE) — /key/command capability routing.
 *
 * FLOW_TOOLS are bridged into the canonical (cortex) registry under their BARE
 * names by KeyCortexEfferentBridgeService; organ tools are dotted (`module.tool`).
 * Former legacy `KeyToolRegistryService` keys are resolved via `legacy-tool-equivalence.ts`
 * (SAME/ALIAS -> canonical FLOW_TOOLS; OBSOLETE -> fail-closed refusal).
 *
 * Resolution order: equivalence table -> bare canonical name -> dotted canonical name -> fail closed.
 * No legacy registry fallback remains (P160).
 */
import { describe, expect, it, vi } from 'vitest';
import { KeyCommandService, type KeyCommandPlan } from './key-command.service';

type CanonicalDef = { name: string; module: string; riskTier: 1 | 2 | 3 | 4; requiresApproval: boolean };

const AUTO = {
  allowed: true,
  requiresQuickConfirm: false,
  requiresFormalApproval: false,
  requiresAdminApproval: false,
  tier: 1,
  reason: 'Tier 1 auto-approved (max auto tier: 1)',
};

function harness(opts: { canonical?: CanonicalDef[]; memberRole?: string } = {}) {
  const prisma = {
    client: {
      keyCommand: { update: vi.fn().mockResolvedValue({}) },
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'user_1', role: 'USER' }) },
      membership: {
        findUnique: vi.fn().mockResolvedValue({
          userId: 'user_1',
          businessId: 'biz_1',
          role: opts.memberRole ?? 'OWNER',
          permissionScopes: null,
        }),
      },
    },
  };
  const timeline = { recordEvent: vi.fn().mockResolvedValue(undefined) };
  const canonicalTools = new Map((opts.canonical ?? []).map((t) => [t.name, t]));
  const canonical = {
    getTool: vi.fn((name: string) => canonicalTools.get(name)),
    execute: vi.fn().mockResolvedValue({ success: true, data: { from: 'canonical' } }),
  };
  const oversight = {
    evaluate: vi.fn().mockResolvedValue(AUTO),
    getAutonomySettings: vi.fn().mockResolvedValue({ mode: 'assisted', blockedTools: [], blockedModules: [] }),
  };
  const safety = { check: vi.fn().mockResolvedValue({ allowed: true }) };
  const commands = {};

  const service = new KeyCommandService(
    prisma as any,
    timeline as any,
    commands as any,
    canonical as any,
    oversight as any,
    safety as any,
  );
  return { service, prisma, timeline, canonical, oversight, safety };
}

function step(tool: string, module: string, input: Record<string, unknown> = {}): KeyCommandPlan {
  return {
    summary: `route ${module}.${tool}`,
    steps: [{ tool, module, input, riskTier: 'LOW', requiresApproval: false }],
  };
}

describe('V1-09 / P160 /key/command: canonical capability routing (no legacy fallback)', () => {
  it('sends a bare FLOW_TOOLS name to canonical.execute(bareName, {businessId,userId,commandId}, input)', async () => {
    const { service, canonical } = harness({
      canonical: [{ name: 'inbox_list_threads', module: 'read', riskTier: 1, requiresApproval: false }],
    });

    const results = await service.executeApprovedPlan('cmd_1', step('inbox_list_threads', 'flow', { limit: 20 }), 'biz_1', 'user_1');

    expect(canonical.execute).toHaveBeenCalledTimes(1);
    expect(canonical.execute).toHaveBeenCalledWith(
      'inbox_list_threads',
      expect.objectContaining({ businessId: 'biz_1', userId: 'user_1', commandId: 'cmd_1' }),
      { limit: 20 },
    );
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
    const { service, canonical } = harness({
      canonical: [{ name: 'organ.custom_read', module: 'organ', riskTier: 1, requiresApproval: false }],
    });

    const resolved = (service as any).resolveCapability(step('custom_read', 'organ', { limit: 5 }).steps[0]);
    expect(resolved).toMatchObject({ registry: 'canonical', name: 'organ.custom_read', toolName: 'organ.custom_read' });
    expect(canonical.getTool).toHaveBeenCalledWith('custom_read');
    expect(canonical.getTool).toHaveBeenCalledWith('organ.custom_read');
  });

  it('fails closed for obsolete messages.listMessageIntake and unknown capabilities (no legacy fallback)', async () => {
    const { service, canonical } = harness();

    const obsResults = await service.executeApprovedPlan(
      'cmd_4a',
      step('listMessageIntake', 'messages', { status: 'reviewing', limit: 20 }),
      'biz_1',
      'user_1',
    );
    expect(canonical.execute).not.toHaveBeenCalled();
    expect(obsResults[0]).toMatchObject({ success: false, notExecuted: true, tool: 'messages.listMessageIntake' });
    expect(obsResults[0].error).toMatch(/obsolete/i);

    const unknownResults = await service.executeApprovedPlan(
      'cmd_4b',
      step('nonexistentTool', 'unknown', {}),
      'biz_1',
      'user_1',
    );
    expect(canonical.execute).not.toHaveBeenCalled();
    expect(unknownResults[0]).toMatchObject({ success: false, notExecuted: true, tool: 'unknown.nonexistentTool' });
    expect(unknownResults[0].error).toMatch(/not registered/i);
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
