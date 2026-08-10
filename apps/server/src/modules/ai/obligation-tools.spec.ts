/**
 * KEY can answer "what is due this week".
 *
 * The endpoint, the listener and the producer shipped before these tools did,
 * which meant the question was answerable over HTTP and not by KEY — the wrong
 * way round for a product whose thesis is that every function can be performed
 * three ways with the same result.
 *
 * WHAT THIS FILE IS REALLY GUARDING
 *
 * `command_items` has sixteen writers across twelve modules. That is how one
 * table acquired twelve opinions about its own status vocabulary, and it is the
 * defect the obligation work exists to stop spreading. The discharge tool was
 * written once with the UPDATE inline in the handler — a seventeenth writer,
 * added by the same change that argued producers should emit rather than write.
 * It now calls CommandService.discharge, and the last test here is the ratchet
 * that keeps it that way.
 *
 * The other sharp one is the SUGGESTION guard. Every pre-existing row in that
 * table is a suggestion — something KEY thought would be a good idea — and
 * discharging one would record that the business met a commitment it never had.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FlowOrchestratorService } from './flow-orchestrator.service';
import { getToolByName } from './flow-tool-registry';
import { RoleEngineService, type BusinessRole } from './role-engine.service';

const MINE = 'biz_mine';

const OBLIGATION_TOOLS = ['command_list_due_obligations', 'command_discharge_obligation'] as const;

function makeCommandStub() {
  return {
    findDue: vi.fn(async (_b: string, opts: Record<string, unknown>) => ({
      window: { from: 'x', to: 'y', days: opts.windowDays ?? 7 },
      total: 1,
      overdueCount: 1,
      items: [{ id: 'o1', title: 'Rebook Priya', overdue: true, daysUntilDue: -2 }],
    })),
    discharge: vi.fn(async (_b: string, id: string, ref?: string) => ({
      id,
      title: 'Rebook Priya',
      dischargedAt: new Date('2026-08-10T00:00:00Z'),
      dischargeRef: ref,
      alreadyDischarged: false,
    })),
  };
}

let command: ReturnType<typeof makeCommandStub>;
let svc: FlowOrchestratorService;

function build() {
  command = makeCommandStub();
  svc = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    moduleRef: { get: () => command },
  }) as FlowOrchestratorService;
}

function run(tool: string, args: Record<string, unknown>) {
  return (
    svc as unknown as {
      executeToolAction: (b: string, t: string, a: Record<string, unknown>) => Promise<unknown>;
    }
  ).executeToolAction(MINE, tool, args);
}

beforeEach(build);

describe('KEY can see what the business owes', () => {
  it('both tools are registered', () => {
    for (const name of OBLIGATION_TOOLS) {
      expect(getToolByName(name), `${name} is missing`).toBeDefined();
    }
  });

  it('lists what is due, and passes the window through', async () => {
    const out = (await run('command_list_due_obligations', { windowDays: 14 })) as {
      total: number;
      overdueCount: number;
    };

    expect(command.findDue).toHaveBeenCalledWith(MINE, {
      windowDays: 14,
      includeOverdue: undefined,
      limit: undefined,
    });
    expect(out.total).toBe(1);
    expect(out.overdueCount).toBe(1);
  });

  it('scopes the read to the calling business', async () => {
    await run('command_list_due_obligations', {});
    expect(command.findDue.mock.calls[0][0]).toBe(MINE);
    // The businessId comes from the turn, never from the model's arguments —
    // there is no businessId parameter on either tool, deliberately.
    expect(getToolByName('command_list_due_obligations')!.parameters.properties).not.toHaveProperty(
      'businessId',
    );
  });

  it('discharges through the service, with a reference to what did it', async () => {
    const out = (await run('command_discharge_obligation', {
      obligationId: 'o1',
      dischargeRef: 'bookings_create_booking',
    })) as { id: string; alreadyDischarged: boolean };

    expect(command.discharge).toHaveBeenCalledWith(MINE, 'o1', 'bookings_create_booking');
    expect(out.id).toBe('o1');
    expect(out.alreadyDischarged).toBe(false);
  });

  it('names the tool as the discharge reference when the model gives none', async () => {
    await run('command_discharge_obligation', { obligationId: 'o1' });
    expect(command.discharge).toHaveBeenCalledWith(MINE, 'o1', 'command_discharge_obligation');
    // "It was met" with no record of what met it is the fabricated-success
    // shape this codebase keeps finding.
  });

  it('refuses an empty id rather than asking the service to find nothing', async () => {
    await expect(run('command_discharge_obligation', {})).rejects.toThrow(/obligationId/i);
    expect(command.discharge).not.toHaveBeenCalled();
  });
});

describe('the tools are shaped like what they do', () => {
  it('reading is tier 1 and discharging is higher', () => {
    const read = getToolByName('command_list_due_obligations')!;
    const write = getToolByName('command_discharge_obligation')!;

    expect(read.family).toBe('read');
    expect(read.riskTier).toBe(1);
    expect(write.riskTier as number).toBeGreaterThan(read.riskTier as number);
  });

  it('there is no tool for INVENTING an obligation', () => {
    // Obligations are raised by producers that know a fact — a booking
    // completed, a period closed, an invoice aged. A tool letting KEY invent
    // one would put rows in the ledger corresponding to nothing that happened,
    // and "what do I owe" would stop being answerable from the business's own
    // events.
    const inventing = ['command_create_obligation', 'obligations_create', 'command_raise_obligation'];
    for (const name of inventing) {
      expect(getToolByName(name), `${name} should not exist`).toBeUndefined();
    }
  });

  it('every role can see what is owed, and the tier decides who may discharge', () => {
    const engine = new RoleEngineService({} as never, {} as never, {} as never);
    const roles = engine.getAllRoles().map((d) => d.id as BusinessRole);

    for (const r of roles) {
      expect(
        engine.isToolAllowed(r, 'command_list_due_obligations'),
        `${r} cannot see what the business owes`,
      ).toBe(true);
    }
    // In SCOPE for everyone; the tier gate is what stops a tier-1 hat firing it.
    for (const r of roles) {
      expect(engine.isToolAllowed(r, 'command_discharge_obligation')).toBe(true);
    }
    expect(engine.getRoleDefinition('executive').maxRiskTier).toBeLessThan(
      getToolByName('command_discharge_obligation')!.riskTier as number,
    );
  });
});

describe('the write boundary holds', () => {
  it('the orchestrator does not write command_items itself', () => {
    // The ratchet. command_items has sixteen writers across twelve modules and
    // that is the reason this whole obligation contract exists; the handler is
    // not allowed to become the seventeenth. If this goes red, move the write
    // into CommandService rather than widening the regex.
    const src = readFileSync(join(__dirname, 'flow-orchestrator.service.ts'), 'utf8');
    const writes = src.match(/commandItem\.(create|update|upsert|delete|updateMany|deleteMany)/g);
    expect(writes ?? [], 'the AI module must go through CommandService').toEqual([]);
  });
});
