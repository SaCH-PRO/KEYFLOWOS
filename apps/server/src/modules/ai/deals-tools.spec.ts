/**
 * The pipeline KEY could not see.
 *
 * Until 2026-08-06 the deals domain had: a Deal model with health scoring and
 * bottleneck flags, DealStage, WonLostReason and Account, a 547-line
 * CrmDealsService with 16 public methods, forecast / health / velocity services,
 * a writable 356-line screen, and an entry in the main nav.
 *
 * And zero tools. `grep -icE "name: '[a-z_]*deal"` returned 0.
 *
 * So an owner worked their pipeline every day in a product whose whole promise
 * is a mind that runs the business, and that mind could not name a single deal,
 * let alone tell them which one was about to slip. It was the largest single gap
 * in the arsenal and nothing failed because of it — a missing tool breaks no
 * test.
 *
 * These assertions are about the traps specific to this organ, not about
 * coverage in general — reachability, routes, enum validity and honest returns
 * are already held by the standing gates.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FLOW_TOOLS, getToolByName } from './flow-tool-registry';

const orchestrator = readFileSync(join(__dirname, 'flow-orchestrator.service.ts'), 'utf8');
const dealTools = FLOW_TOOLS.filter((t) => t.name.startsWith('deals_'));

describe('KEY can work the pipeline', () => {
  it('can read it, and change it', () => {
    // A read-only organ is half an organ — it was the shape of marketplace (49
    // service methods, 2 read tools) and deep finance (43 files, 3 read tools).
    const reads = dealTools.filter((t) => t.family === 'read');
    const writes = dealTools.filter((t) => ['crud', 'organize', 'execute'].includes(t.family ?? ''));

    expect(reads.length, 'no way to see the pipeline').toBeGreaterThanOrEqual(4);
    expect(writes.length, 'no way to act on it').toBeGreaterThanOrEqual(5);
  });

  it('covers the verbs a pipeline actually needs', () => {
    const names = new Set(dealTools.map((t) => t.name));
    for (const verb of [
      'deals_list',
      'deals_get',
      'deals_list_stages',
      'deals_forecast',
      'deals_create',
      'deals_update',
      'deals_move_stage',
      'deals_mark_won',
      'deals_mark_lost',
    ]) {
      expect(names.has(verb), `${verb} is missing`).toBe(true);
    }
  });

  it('every deal tool has a handler', () => {
    for (const tool of dealTools) {
      expect(
        orchestrator.includes(`case '${tool.name}':`),
        `${tool.name} is advertised to the model with no case in executeToolAction`,
      ).toBe(true);
    }
  });
});

describe('a stage move can name its destination', () => {
  it('deals_move_stage requires a stageId', () => {
    const move = getToolByName('deals_move_stage');
    expect(move?.parameters.required).toContain('stageId');
  });

  it('and deals_list_stages exists to supply one', () => {
    // The trap this closes: moveStage takes a stage ID, not a stage name. Ship
    // the write without the lookup and every move fails on an invented id —
    // the tool is advertised, the model calls it confidently, and it cannot
    // work. Same class as calendar_create_event, whose enum had zero overlap
    // with the domain enum and failed 100% of calls.
    expect(getToolByName('deals_list_stages')).toBeDefined();
    expect(getToolByName('deals_list_stages')?.family).toBe('read');
  });

  it('the stage list is described as a prerequisite, not an afterthought', () => {
    // Descriptions are the only instruction the model gets. If nothing tells it
    // to fetch stages first, it will guess.
    expect(getToolByName('deals_move_stage')?.description).toMatch(/deals_list_stages/);
  });
});

describe('closing a deal is treated as a revenue event', () => {
  it('win and lose are execute-family, not silent updates', () => {
    // Marking a deal won moves money in every report the business reads. It is
    // not the same kind of act as editing a title, and the family says so.
    expect(getToolByName('deals_mark_won')?.family).toBe('execute');
    expect(getToolByName('deals_mark_lost')?.family).toBe('execute');
  });

  it('deletion is tier 3 and points at losing instead', () => {
    // A lost deal is pipeline history — win rates, loss reasons, velocity all
    // depend on it. A deleted one is a hole in the forecast.
    const del = getToolByName('deals_delete');
    expect(del?.riskTier).toBe(3);
    expect(del?.description).toMatch(/deals_mark_lost/);
  });

  it('handlers return the deal the service produced, not the arguments', () => {
    // moveStage, winDeal and loseDeal all DERIVE the resulting status from the
    // destination stage's category. Echoing back a requested status would be
    // wrong as well as dishonest — the same defect as the seven handlers that
    // reported their own inputs. Held generally by tool-honesty-sweep; named
    // here because for this organ the derived value is the whole point.
    for (const name of ['deals_move_stage', 'deals_mark_won', 'deals_mark_lost', 'deals_create', 'deals_update']) {
      const at = orchestrator.indexOf(`case '${name}':`);
      expect(at, `${name} has no handler`).toBeGreaterThan(-1);
      const body = orchestrator.slice(at, orchestrator.indexOf('      case ', at + 10));

      expect(body, `${name} discards the service result`).toMatch(/const deal = await this\.getDeals\(\)/);
      expect(body, `${name} should return the service's deal`).toMatch(/return \{ deal \}/);
    }
  });
});

describe('the pipeline is reachable by the roles that own it', () => {
  const roleEngine = readFileSync(join(__dirname, 'role-engine.service.ts'), 'utf8');

  it('sales gets the full pipeline', () => {
    const sales = roleEngine.slice(roleEngine.indexOf('  sales: {'), roleEngine.indexOf('  finance: {'));
    expect(sales).toMatch(/'deals_\*'/);
  });

  it('executive can see the forecast without being able to edit deals', () => {
    // Its questions are "what is coming" and "will we hit the number", and it
    // is a near-pure read role. A wildcard here would have handed an advisory
    // seat the ability to close deals.
    const exec = roleEngine.slice(roleEngine.indexOf('  executive: {'));
    expect(exec).toMatch(/'deals_forecast'/);
    expect(exec, 'executive must not get blanket deal access').not.toMatch(/'deals_\*'/);
  });

  it('sales cannot delete a deal', () => {
    const sales = roleEngine.slice(roleEngine.indexOf('  sales: {'), roleEngine.indexOf('  finance: {'));
    expect(sales).toMatch(/blockedTools:[^\]]*'deals_delete'/);
  });
});
