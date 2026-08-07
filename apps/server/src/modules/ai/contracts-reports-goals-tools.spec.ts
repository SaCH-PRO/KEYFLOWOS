/**
 * Three domains that sat in the main nav with complete services and no tools.
 *
 *   contracts  7 models, a 573-line service, an 895-line screen with full
 *              manual CRUD and AI term extraction
 *   reports    a 407-line service over a 1,164-line ledger reporting layer,
 *              a 546-line screen
 *   goals      the cortex planner, a 395-line screen, two disconnected goal
 *              systems (AiGoal, which the screen uses, and BusinessGoal)
 *
 * A user could see all three in the nav, work in them daily, and find the
 * assistant blind to every one.
 *
 * The assertions below are about the choices that would rot quietly: enums
 * copied from a DTO, report types copied from a switch, and one deliberate
 * omission that a later pass would otherwise "fix".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FLOW_TOOLS, getToolByName } from './flow-tool-registry';

const orchestrator = readFileSync(join(__dirname, 'flow-orchestrator.service.ts'), 'utf8');
const named = (prefix: string) => FLOW_TOOLS.filter((t) => t.name.startsWith(prefix));

describe('all three domains are reachable', () => {
  it('every new tool has a handler', () => {
    for (const t of [...named('contracts_'), ...named('reports_'), ...named('goals_')]) {
      expect(orchestrator.includes(`case '${t.name}':`), `${t.name} has no handler`).toBe(true);
    }
  });

  it('each points at its own screen', () => {
    for (const t of named('contracts_')) expect(t.manualEquivalentRoute).toBe('/app/contracts');
    for (const t of named('reports_')) expect(t.manualEquivalentRoute).toBe('/app/reports');
    for (const t of named('goals_')) expect(t.manualEquivalentRoute).toBe('/app/goals');
  });
});

describe('contract vocabulary matches the domain, not a guess', () => {
  const dto = readFileSync(
    join(__dirname, '..', 'contracts', 'dto', 'create-contract.dto.ts'),
    'utf8',
  );

  const constant = (name: string) => {
    const at = dto.indexOf(`export const ${name}`);
    expect(at, `${name} is gone from the DTO`).toBeGreaterThan(-1);
    return [...dto.slice(at, dto.indexOf('] as const', at)).matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
  };

  it('statuses are exactly CONTRACT_STATUSES', () => {
    // The DTO validates with @IsIn(CONTRACT_STATUSES), so a status this tool
    // offers but the DTO rejects is a call that always 400s — the shape that
    // made calendar_create_event fail 100% of the time.
    const fromDto = constant('CONTRACT_STATUSES');
    for (const tool of ['contracts_list', 'contracts_create', 'contracts_update']) {
      expect(getToolByName(tool)?.parameters.properties.status?.enum, `${tool} status enum`).toEqual(
        fromDto,
      );
    }
  });

  it('contract types are exactly CONTRACT_TYPES', () => {
    expect(getToolByName('contracts_create')?.parameters.properties.contractType?.enum).toEqual(
      constant('CONTRACT_TYPES'),
    );
  });

  it('deleting points at archiving instead', () => {
    // A contract that existed is a fact about the business and the register is
    // evidence. Tier 3, and the description says what to do instead.
    const del = getToolByName('contracts_delete');
    expect(del?.riskTier).toBe(3);
    expect(del?.description).toMatch(/TERMINATED or ARCHIVED/);
  });

  it('the list tool surfaces the question a register exists to answer', () => {
    expect(getToolByName('contracts_list')?.parameters.properties.expiringWithinDays).toBeDefined();
  });
});

describe('report types match the branches that write the analysis', () => {
  it('exactly the five the service handles', () => {
    // reports.service.ts branches on type to choose the written analysis. A
    // sixth value returns figures with no narrative at all — a report that
    // looks generated and says nothing.
    const svc = readFileSync(join(__dirname, '..', 'reports', 'reports.service.ts'), 'utf8');
    const branches = [...svc.matchAll(/type === '([a-z]+)'/g)].map((m) => m[1]);
    const advertised = getToolByName('reports_generate')?.parameters.properties.type?.enum ?? [];

    expect(branches.length, 'no type branches found — reports.service was restructured').toBeGreaterThan(0);
    expect([...advertised].sort()).toEqual([...new Set(branches)].sort());
  });
});

describe('goals can be planned but not executed', () => {
  it('there is no tool over executePlan', () => {
    // The deliberate omission. executePlan(planId, { skipApproval }) runs
    // arbitrary plan steps and can be told to bypass approval — a tool over it
    // would let KEY escalate its own authority, which is not a capability but a
    // hole. Plans are proposed by KEY and run by a human from /app/goals.
    //
    // If a later pass adds one, this fails and asks for the argument to be made
    // out loud rather than assumed.
    const executors = FLOW_TOOLS.filter(
      (t) => /execute.*plan|plan.*execute|run_plan/i.test(t.name),
    );
    expect(executors.map((t) => t.name), 'a tool now executes plans — was that decided?').toEqual([]);
  });

  it('the planning tool says it only proposes', () => {
    expect(getToolByName('goals_create_plan')?.description).toMatch(/does not run it/i);
  });

  it('plan creation is scoped to the caller tenant, not the model argument', () => {
    // createPlanFromGoal resolved a bare goal id against every business until
    // 2026-08-07. The handler must pass the request's businessId as the first
    // argument, never something out of args.
    const at = orchestrator.indexOf("case 'goals_create_plan':");
    const body = orchestrator.slice(at, orchestrator.indexOf('      case ', at + 10));

    expect(body).toMatch(/createPlanFromGoal\(\s*\n?\s*businessId,/);
    expect(body, 'businessId must not come from tool arguments').not.toMatch(/args\.businessId/);
  });

  it('deleting a goal goes through the planner, not raw prisma in the handler', () => {
    // The controller used to do its own findFirst + delete. Both callers share
    // one scoped method now, so the tool and the screen cannot diverge.
    const at = orchestrator.indexOf("case 'goals_delete':");
    const body = orchestrator.slice(at, orchestrator.indexOf('      case ', at + 10));

    expect(body).toMatch(/getPlanner\(\)\.deleteGoal\(businessId,/);
    expect(body).not.toMatch(/prisma/);
  });
});

describe('who gets what', () => {
  const roleEngine = readFileSync(join(__dirname, 'role-engine.service.ts'), 'utf8');
  const block = (name: string, next: string) =>
    roleEngine.slice(roleEngine.indexOf(`  ${name}: {`), roleEngine.indexOf(`  ${next}: {`));

  it('executive can read a report and set a goal, and not touch contracts', () => {
    // Its whole job. But contracts are a legal register, not an advisory
    // surface — it gets the summary, not edit rights.
    const exec = roleEngine.slice(roleEngine.indexOf('  executive: {'));
    expect(exec).toMatch(/'reports_generate'/);
    expect(exec).toMatch(/'goals_create'/);
    expect(exec).toMatch(/'contracts_stats'/);
    expect(exec, 'executive must not get blanket contract access').not.toMatch(/'contracts_\*'/);
  });

  it('operations owns the contract register', () => {
    expect(block('operations', 'marketing')).toMatch(/'contracts_\*'/);
  });

  it('sales can read what was agreed without editing it', () => {
    const sales = block('sales', 'finance');
    expect(sales).toMatch(/'contracts_get'/);
    expect(sales).not.toMatch(/'contracts_\*'/);
  });
});
