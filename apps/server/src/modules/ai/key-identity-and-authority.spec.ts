/**
 * KEY is KEY, roles are hats, and a hat carries authority.
 *
 * Three things pinned here:
 *
 * 1. IDENTITY. The shipped system prompt opened "You are Flow, an AI assistant
 *    built into KeyFlowOS", with a personality block asking for warmth, emoji
 *    and celebrating wins. The product is called KEY and the intent is the
 *    owner's second mind, not a friendly helper bolted onto software. The role
 *    prompt had the same problem from the other direction — "You are Sales
 *    Manager" replaced KEY's identity rather than putting a hat on it.
 *
 * 2. THE DATE. `getSystemPromptForRole` never contained a {{CURRENT_DATE}}
 *    token, while flow-orchestrator calls `.replace('{{CURRENT_DATE}}', ...)`
 *    on its output — a silent no-op. In any non-general role KEY was never
 *    told today's date, so every relative date ("next Friday", "overdue") was
 *    guesswork. Harmless while roles never activated; live the moment they do.
 *
 * 3. AUTHORITY. RoleDefinition carries maxRiskTier and autonomyLevel per role.
 *    Both were interpolated into the prompt and read by NOTHING — oversight
 *    used business-level settings only, so the Executive Advisor (tier 1) and
 *    the Operator acted with identical authority. Enforcing the minimum of the
 *    two is what turns eight roles into tiers of staff.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AiOversightService } from './ai-oversight.service';
import { RoleEngineService } from './role-engine.service';

const orchestrator = readFileSync(join(__dirname, 'flow-orchestrator.service.ts'), 'utf8');
const roleEngine = new RoleEngineService(...([] as never[]));

const SYSTEM_PROMPT = (() => {
  const i = orchestrator.indexOf('const FLOW_SYSTEM_PROMPT = `');
  return orchestrator.slice(i, orchestrator.indexOf('`;', i));
})();

describe('KEY introduces itself as KEY', () => {
  it('is not "Flow, an AI assistant"', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/You are Flow/);
    expect(SYSTEM_PROMPT).toMatch(/You are KEY/);
  });

  it('does not ask the model to perform enthusiasm', () => {
    // The old block asked for emoji, exclamation marks and celebrating wins,
    // and gave a worked example containing 🎉.
    expect(SYSTEM_PROMPT).not.toMatch(/Celebrate wins/i);
    expect(SYSTEM_PROMPT).not.toMatch(/🎉/);
  });

  it('keeps the parts that were already right', () => {
    // Tool honesty and disambiguation are load-bearing; the rewrite must not
    // have dropped them.
    expect(SYSTEM_PROMPT).toMatch(/never pretend to take an action/i);
    expect(SYSTEM_PROMPT).toMatch(/disambiguationNeeded/);
    expect(SYSTEM_PROMPT).toMatch(/TTD/);
  });

  it('forbids inventing facts', () => {
    expect(SYSTEM_PROMPT).toMatch(/Never invent a number/i);
  });
});

describe('a role is a hat, not a replacement identity', () => {
  const prompt = roleEngine.getSystemPromptForRole('finance', 'CTX');

  it('still says KEY', () => {
    expect(prompt).toMatch(/You are KEY/);
  });

  it('names the role being worn', () => {
    expect(prompt).toMatch(/Finance Manager/);
  });

  it('carries the date token the orchestrator substitutes', () => {
    // flow-orchestrator calls .replace('{{CURRENT_DATE}}', ...) on this string.
    // Without the token that call is a no-op and KEY never learns the date.
    expect(prompt).toMatch(/\{\{CURRENT_DATE\}\}/);
  });

  it('every role carries the date token', () => {
    for (const def of roleEngine.getAllRoles()) {
      const p = roleEngine.getSystemPromptForRole(def.id, 'CTX');
      expect(p, `${def.id} has no date token`).toMatch(/\{\{CURRENT_DATE\}\}/);
    }
  });
});

describe('role authority caps business authority', () => {
  function makeOversight() {
    // constructor(prisma, logService, memoryService, roleEngine)
    const noop = new Proxy({}, { get: () => vi.fn() });
    const svc = new AiOversightService(
      { client: {} } as never,
      noop as never,
      noop as never,
      roleEngine as never,
    ) as unknown as {
      applyRoleCeiling(s: Record<string, unknown>, r: string): Record<string, number>;
    };
    return svc;
  }

  const BUSINESS = { maxAutoTier: 4, autonomyLevel: 5, mode: 'autopilot', approvedTools: [] as string[] };

  it('clamps down to the executive role, which is advisory', () => {
    const exec = roleEngine.getRoleDefinition('executive');
    const out = makeOversight().applyRoleCeiling({ ...BUSINESS }, 'executive');

    expect(out.maxAutoTier).toBe(Math.min(4, exec.maxRiskTier));
    expect(out.autonomyLevel).toBe(Math.min(5, exec.autonomyLevel));
    expect(out.maxAutoTier).toBeLessThan(4);
  });

  it('never RAISES authority above the business ceiling', () => {
    // Selecting a permissive role must not be an escalation path.
    const restrictive = { maxAutoTier: 1, autonomyLevel: 1, mode: 'assisted' };
    const out = makeOversight().applyRoleCeiling({ ...restrictive }, 'operator');

    expect(out.maxAutoTier).toBe(1);
    expect(out.autonomyLevel).toBe(1);
  });

  it('does not mutate the cached business settings', () => {
    // A shared settings object would leak one role's ceiling into every later
    // request for that business.
    const settings = { ...BUSINESS };
    makeOversight().applyRoleCeiling(settings, 'executive');

    expect(settings.maxAutoTier).toBe(4);
    expect(settings.autonomyLevel).toBe(5);
  });

  it('evaluate ACTUALLY USES the clamped settings', () => {
    // The tests above call applyRoleCeiling directly, so they pass even if the
    // call site is deleted — which is exactly the compute-and-discard defect
    // this whole session has been fixing. Caught by negative control: removing
    // the call from evaluate() failed nothing until this assertion existed.
    const src = readFileSync(join(__dirname, 'ai-oversight.service.ts'), 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');

    const fn = src.slice(src.indexOf('  async evaluate('));
    const body = fn.slice(0, fn.indexOf('\n  private '));

    // The clamp is now per-TOOL against the hats that grant it, rather than
    // once per turn against the hat that won — so the expression this looks for
    // changed from applyRoleCeiling(businessSettings, role) to the crew form.
    // The PROPERTY is identical and is the only reason this test exists:
    // evaluate must USE the clamped settings, not compute and discard them.
    // applyCrewCeiling is a fold of applyRoleCeiling (see its comment), so the
    // seven assertions around this one still exercise the code that runs.
    expect(body).toMatch(/applyCrewCeiling\(businessSettings, crew, toolName\)/);
    // and the clamped value is what the tier checks read
    expect(body).toMatch(/settings\.autonomyLevel/);
    expect(body).toMatch(/settings\.maxAutoTier/);
  });

  it('the pre-approved list cannot outrank the role', () => {
    // The bypass that made the whole ceiling inert for the tools most likely to
    // be used. `evaluate` short-circuits to auto-execute for anything in
    // settings.approvedTools WITHOUT consulting the role — and
    // DefaultTriggersService seeds that list with commerce_create_invoice,
    // crm_create_contact and eight more. So the Executive Advisor, maxRiskTier
    // 1 and "never execute operational actions without explicit approval",
    // would have auto-executed every one of them.
    const svc = makeOversight() as unknown as {
      applyRoleCeiling(s: Record<string, unknown>, r: string): { approvedTools: string[] };
      getToolTier(t: string): number;
    };

    const granted = ['crm_search_contacts', 'commerce_create_invoice', 'commerce_send_invoice'];
    const out = svc.applyRoleCeiling({ ...BUSINESS, approvedTools: granted }, 'executive');

    const execCeiling = roleEngine.getRoleDefinition('executive').maxRiskTier;
    for (const tool of out.approvedTools) {
      expect(
        svc.getToolTier(tool),
        `${tool} survives the ceiling at tier ${svc.getToolTier(tool)} > ${execCeiling}`,
      ).toBeLessThanOrEqual(execCeiling);
    }
  });

  it('keeps the grants a junior role IS trusted with', () => {
    // Filtered, not cleared — a low-risk grant must survive.
    const svc = makeOversight() as unknown as {
      applyRoleCeiling(s: Record<string, unknown>, r: string): { approvedTools: string[] };
    };
    const out = svc.applyRoleCeiling(
      { ...BUSINESS, approvedTools: ['crm_search_contacts'] },
      'executive',
    );

    expect(out.approvedTools).toContain('crm_search_contacts');
  });

  it('a senior role is trusted with more than a junior one', () => {
    // Otherwise "tiers of staff" is decoration.
    const exec = makeOversight().applyRoleCeiling({ ...BUSINESS }, 'executive');
    const operator = makeOversight().applyRoleCeiling({ ...BUSINESS }, 'operator');

    expect(operator.maxAutoTier).toBeGreaterThan(exec.maxAutoTier);
  });
});

describe('role stickiness covers every role', () => {
  it('is driven off getAllRoles, not a hardcoded list of five', () => {
    // The literal array named only sales/finance/support/operations/marketing,
    // so operator and executive could never persist across a turn.
    //
    // The scan moved out of inferRole and into buildRoleDetectionContext when
    // the turn started resolving a crew rather than a single role: inferRole is
    // now one line returning `.primary` of that resolution, and both it and
    // resolveTurnAuthority build their context here. Same code, one caller
    // deeper — so this reads the function that actually holds it.
    const fn = orchestrator.slice(orchestrator.indexOf('private buildRoleDetectionContext('));
    const body = fn.slice(0, fn.indexOf('\n  }'));

    expect(body).toMatch(/this\.roleEngine\.getAllRoles\(\)/);
    expect(body).not.toMatch(/\['sales', 'finance', 'support', 'operations', 'marketing'\]/);
  });
});
