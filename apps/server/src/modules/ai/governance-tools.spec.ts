/**
 * The risk register KEY could not read or write to.
 *
 * GovernanceService keeps the business risk register — title, category,
 * severity, likelihood, owner, mitigation, status. Six methods, six routes, and
 * /app/governance-flow renders its summary. KEY could not see a single risk or
 * log one, so the mind meant to run the business was blind to what the business
 * was afraid of.
 *
 * THE DEFECT THIS FILE IS BUILT AROUND
 *
 * CreateRiskDto validates severity, likelihood and status with class-validator
 * @IsIn. NONE OF THAT RUNS ON THE TOOL PATH. class-validator fires from Nest's
 * ValidationPipe when a request comes in over HTTP; a tool handler calls the
 * service directly, so `severity: 'catastrophic'` is written straight into the
 * column.
 *
 * And it does not throw. The screen sorts by severity and summary() groups by
 * it, so an invented value becomes a row the UI cannot place and a bucket
 * nobody reads — a risk logged, acknowledged, and effectively lost. That is
 * worse than a refusal, because everyone believes it was recorded.
 *
 * So the handlers validate, and the first test here reads create-risk.dto.ts
 * and fails if the two lists ever drift apart. A duplicated vocabulary that
 * nothing compares is a vocabulary that will diverge.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FlowOrchestratorService } from './flow-orchestrator.service';
import { FLOW_TOOLS, getToolByName } from './flow-tool-registry';

const BIZ = 'biz_gov_spec';

const GOVERNANCE_TOOLS = [
  'governance_list_risks',
  'governance_get_risk',
  'governance_risk_summary',
  'governance_log_risk',
  'governance_update_risk',
] as const;

function makeGovernanceStub() {
  return {
    findRisks: vi.fn(async () => [{ id: 'r1', severity: 'HIGH' }]),
    findOneRisk: vi.fn(async (_b: string, id: string) => ({ id, title: 'Cash runway' })),
    summary: vi.fn(async () => ({ open: 3, bySeverity: [{ severity: 'HIGH', count: 2 }] })),
    createRisk: vi.fn(async () => ({ id: 'r_new', title: 'Stored Title', severity: 'HIGH', status: 'OPEN' })),
    updateRisk: vi.fn(async () => ({ id: 'r1', status: 'MITIGATED', severity: 'HIGH' })),
    deleteRisk: vi.fn(async () => undefined),
  };
}

let governance: ReturnType<typeof makeGovernanceStub>;
let svc: FlowOrchestratorService;

function run(tool: string, args: Record<string, unknown>) {
  return (svc as unknown as {
    executeToolAction: (b: string, t: string, a: Record<string, unknown>) => Promise<unknown>;
  }).executeToolAction(BIZ, tool, args);
}

/** Calls across every stubbed write, so "it refused" can be told from "it wrote". */
const writeCount = () =>
  governance.createRisk.mock.calls.length +
  governance.updateRisk.mock.calls.length +
  governance.deleteRisk.mock.calls.length;

beforeEach(() => {
  governance = makeGovernanceStub();
  svc = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    moduleRef: { get: () => governance },
  }) as FlowOrchestratorService;
});

describe('the tool vocabulary matches the DTO it bypasses', () => {
  const dto = readFileSync(
    join(__dirname, '..', 'governance', 'dto', 'create-risk.dto.ts'),
    'utf8',
  );
  const orchestrator = readFileSync(join(__dirname, 'flow-orchestrator.service.ts'), 'utf8');

  function listFromOrchestrator(name: string): string[] {
    const at = orchestrator.indexOf(`const ${name} = [`);
    expect(at, `${name} is not defined in the orchestrator`).toBeGreaterThan(-1);
    const body = orchestrator.slice(at, orchestrator.indexOf(']', at));
    return [...body.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
  }

  it('severity: the handler list is exactly the DTO list', () => {
    const fromDto = [...dto.slice(dto.indexOf('VALID_SEVERITY')).matchAll(/'([A-Z_]+)'/g)]
      .map((m) => m[1])
      .slice(0, 4);
    expect(listFromOrchestrator('RISK_SEVERITIES')).toEqual(fromDto);
  });

  it('status: the handler list is exactly the DTO list', () => {
    const fromDto = [...dto.slice(dto.indexOf('VALID_STATUS')).matchAll(/'([A-Z_]+)'/g)]
      .map((m) => m[1])
      .slice(0, 4);
    expect(listFromOrchestrator('RISK_STATUSES')).toEqual(fromDto);
  });

  it('likelihood: the handler list is exactly the DTO list', () => {
    const at = dto.indexOf("@IsIn(['RARE'");
    const fromDto = [...dto.slice(at, dto.indexOf(']', at)).matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(listFromOrchestrator('RISK_LIKELIHOODS')).toEqual(fromDto);
    expect(fromDto.length, 'the DTO likelihood list could not be read').toBe(5);
  });
});

describe('the register is reachable', () => {
  it('every tool is registered', () => {
    for (const name of GOVERNANCE_TOOLS) {
      expect(getToolByName(name), `${name} is missing`).toBeDefined();
    }
  });

  it('KEY can both read the register and add to it', () => {
    const tools = GOVERNANCE_TOOLS.map((n) => getToolByName(n)!);
    expect(tools.filter((t) => t.family === 'read').length).toBe(3);
    expect(tools.filter((t) => t.family === 'crud').length).toBe(2);
  });

  it('there is no delete tool, and closing is what retires a risk', () => {
    // BusinessRisk is not in the soft-delete set, so deleteRisk is final — and
    // a risk register's whole value is its history. "Handled" is a STATUS, not
    // an erasure. Both read the same in the open count; only one leaves a
    // record of what was feared and what was done.
    expect(FLOW_TOOLS.filter((t) => /^governance_.*delete/.test(t.name))).toEqual([]);
    expect(getToolByName('governance_update_risk')!.description).toMatch(
      /never deleted|risks are never/i,
    );
  });

  it('no handler calls deleteRisk', () => {
    const orchestrator = readFileSync(join(__dirname, 'flow-orchestrator.service.ts'), 'utf8');
    expect(orchestrator.includes('.deleteRisk(')).toBe(false);
  });
});

describe('an invented severity is refused, not written', () => {
  it('rejects a severity outside the set, without writing', async () => {
    await expect(
      run('governance_log_risk', { title: 'X', category: 'ops', severity: 'catastrophic' }),
    ).rejects.toThrow(/severity must be one of/i);

    // The load-bearing half: the DTO would have caught this over HTTP and does
    // not run here, so a handler that wrote first and validated after would
    // still have put 'catastrophic' in the column.
    expect(writeCount(), 'an invalid severity reached the database').toBe(0);
  });

  it('rejects an invalid likelihood', async () => {
    await expect(
      run('governance_log_risk', {
        title: 'X',
        category: 'ops',
        severity: 'HIGH',
        likelihood: 'maybe',
      }),
    ).rejects.toThrow(/likelihood must be one of/i);
    expect(writeCount()).toBe(0);
  });

  it('rejects an invalid status on create', async () => {
    await expect(
      run('governance_log_risk', {
        title: 'X',
        category: 'ops',
        severity: 'HIGH',
        status: 'sorted',
      }),
    ).rejects.toThrow(/status must be one of/i);
    expect(writeCount()).toBe(0);
  });

  it('rejects an invalid status on update', async () => {
    await expect(
      run('governance_update_risk', { riskId: 'r1', status: 'done' }),
    ).rejects.toThrow(/status must be one of/i);
    expect(writeCount()).toBe(0);
  });

  it('rejects an invalid status used as a LIST FILTER', async () => {
    // Not a write, but the same silence: findRisks would filter on a status no
    // row can hold and return [], which reads as "you have no closed risks".
    await expect(
      run('governance_list_risks', { status: 'done' }),
    ).rejects.toThrow(/status must be one of/i);
    expect(governance.findRisks).not.toHaveBeenCalled();
  });

  // Negative controls. Without these, every test above would also pass against
  // a handler that refused everything it was ever given.
  it('accepts every severity the DTO allows', async () => {
    for (const severity of ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']) {
      await run('governance_log_risk', { title: 'X', category: 'ops', severity });
    }
    expect(governance.createRisk).toHaveBeenCalledTimes(4);
  });

  it('accepts every status the DTO allows, as a filter', async () => {
    for (const status of ['OPEN', 'MITIGATED', 'CLOSED', 'ACCEPTED']) {
      await run('governance_list_risks', { status });
    }
    expect(governance.findRisks).toHaveBeenCalledTimes(4);
  });
});

describe('handlers report what the service stored', () => {
  it('log_risk returns the stored row, not the requested values', async () => {
    const out = (await run('governance_log_risk', {
      title: 'Requested Title',
      category: 'ops',
      severity: 'HIGH',
    })) as { id: string; title: string };
    // The stub stores 'Stored Title'. A handler answering from `args` would
    // say 'Requested Title' — and the DTO sanitizes and truncates titles, so
    // what is stored genuinely can differ from what was asked for.
    expect(out.id).toBe('r_new');
    expect(out.title).toBe('Stored Title');
  });

  it('log_risk defaults status to OPEN rather than leaving it unset', async () => {
    await run('governance_log_risk', { title: 'X', category: 'ops', severity: 'LOW' });
    const [, dto] = governance.createRisk.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(dto.status).toBe('OPEN');
  });

  it('summary and get pass the caller\'s business through', async () => {
    await run('governance_risk_summary', {});
    expect(governance.summary).toHaveBeenCalledWith(BIZ);

    await run('governance_get_risk', { riskId: 'r9' });
    expect(governance.findOneRisk).toHaveBeenCalledWith(BIZ, 'r9');
  });

  it('list wraps the array so the model gets an object it can describe', async () => {
    const out = (await run('governance_list_risks', {})) as { risks: unknown[] };
    expect(out.risks).toHaveLength(1);
  });
});

describe('the update patch carries only what was asked for', () => {
  it('does not forward riskId or invented keys onto the row', async () => {
    // updateRisk applies every field that is `!== undefined`, so a spread of
    // `args` would write riskId and anything the model made up.
    await run('governance_update_risk', {
      riskId: 'r1',
      mitigation: 'Hired a second supplier',
      somethingInvented: 'nonsense',
    });
    const [, , patch] = governance.updateRisk.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(Object.keys(patch)).toEqual(['mitigation']);
  });

  it('refuses an update with nothing to change rather than writing an empty patch', async () => {
    // An empty patch still issues an UPDATE, bumps updatedAt, and reports
    // success — "I've updated that risk" for a call that changed nothing.
    await expect(run('governance_update_risk', { riskId: 'r1' })).rejects.toThrow(
      /nothing to change/i,
    );
    expect(governance.updateRisk).not.toHaveBeenCalled();
  });

  it('but a real single-field update goes through', async () => {
    const out = (await run('governance_update_risk', { riskId: 'r1', status: 'MITIGATED' })) as {
      status: string;
    };
    expect(governance.updateRisk).toHaveBeenCalledTimes(1);
    expect(out.status).toBe('MITIGATED');
  });
});
