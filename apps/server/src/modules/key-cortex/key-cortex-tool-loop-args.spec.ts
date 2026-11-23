/**
 * RR-TOOL-ARGS-MALFORMED-NEVER-RUN (D-261, D-262, D-17): a KEY cortex tool call
 * whose arguments do not parse to a JSON object never runs a tool. Before this
 * packet the loop caught the JSON.parse failure, logged a warning, kept args =
 * {} and went on to evaluate the safety gate and the autonomy oracle on {} and
 * to execute the tool with {}: a call the model never made ran.
 *
 * Now the malformed call is refused before safety, autonomy, governance or
 * execution; its tool message carries "not run: the arguments for <tool> were
 * not valid JSON" back to the model; the other calls of the same response run
 * as today. Stubs follow key-cortex-tool-loop.service.spec.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyCortexToolLoopService } from './key-cortex-tool-loop.service';
import { CortexQuery } from './key-cortex.types';

const NOT_RUN = (tool: string) => `not run: the arguments for ${tool} were not valid JSON`;

describe('KeyCortexToolLoopService: malformed tool arguments never run (RR-TOOL-ARGS-MALFORMED-NEVER-RUN)', () => {
  let service: KeyCortexToolLoopService;
  let toolRegistry: any;
  let autonomyOrchestrator: any;
  let safety: any;
  let modelGateway: any;

  const businessId = 'biz_rr_args';
  const userId = 'user_rr_args';
  const query: CortexQuery = { text: 'add Ada and list contacts', businessId, userId };
  const identity = { correlationId: 'c1', sessionId: 's1', commandId: 'cmd1', businessId, userId };

  const call = (id: string, name: string, args: string) => ({ id, type: 'function', function: { name, arguments: args } });
  const run = (toolCalls: unknown[]) =>
    service.handleToolCalls({ toolCalls }, [], query, {} as any, { temperature: 0.5 }, 'action_execution', identity);

  beforeEach(() => {
    toolRegistry = {
      getTool: vi.fn((name: string) => ({ name, module: 'crm', riskTier: 2, requiresApproval: false })),
      execute: vi.fn().mockResolvedValue({ success: true, data: { id: 'contact_1' } }),
    };
    autonomyOrchestrator = {
      evaluate: vi.fn().mockResolvedValue({ allowed: true, requiresApproval: false, tier: 'full', confidence: 1, reason: 'ok', ruleTrace: [], createdAt: new Date() }),
    };
    safety = {
      check: vi.fn().mockResolvedValue({ allowed: true }),
      recordExecution: vi.fn().mockResolvedValue(undefined),
    };
    modelGateway = { complete: vi.fn().mockResolvedValue({ content: 'Done' }) };
    service = new KeyCortexToolLoopService(
      modelGateway,
      { client: {} } as any,
      toolRegistry,
      undefined,
      autonomyOrchestrator,
      safety,
      { resolve: vi.fn().mockResolvedValue({ level: 3, mode: 'pro_auto', maxAutoRiskTier: 3, label: 'test' }) } as any,
    );
  });

  it("DoD RED: arguments '{bad' never reach execute, safety or autonomy; the tool message carries the 'not run' error; the valid call runs once", async () => {
    const result = await run([call('tc_bad', 'crm.create_contact', '{bad'), call('tc_ok', 'crm.list_contacts', '{"query":"Ada"}')]);

    expect(toolRegistry.execute).toHaveBeenCalledTimes(1);
    expect(toolRegistry.execute).toHaveBeenCalledWith('crm.list_contacts', expect.objectContaining({ businessId, userId }), { query: 'Ada' });
    expect(safety.check).toHaveBeenCalledTimes(1);
    expect(safety.check.mock.calls[0][0].toolName).toBe('crm.list_contacts');
    expect(autonomyOrchestrator.evaluate).toHaveBeenCalledTimes(1);
    expect(autonomyOrchestrator.evaluate.mock.calls[0][0].actionKey).toBe('crm.list_contacts');

    // the refusal is an action the member sees, with status error, and the valid one succeeded
    expect(result?.actions.map((a) => a.status)).toEqual(['error', 'success']);
    expect(result?.actions[0].error).toBe(NOT_RUN('crm.create_contact'));

    // the model is told through the tool message of that call
    const finalMessages = modelGateway.complete.mock.calls[0][0].messages as Array<Record<string, any>>;
    const toolMessages = finalMessages.filter((m) => m.role === 'tool');
    expect(toolMessages.map((m) => m.tool_call_id)).toEqual(['tc_bad', 'tc_ok']);
    expect(JSON.parse(toolMessages[0].content)).toMatchObject({ success: false, error: NOT_RUN('crm.create_contact') });
    expect(JSON.parse(toolMessages[1].content)).toMatchObject({ success: true });
  });

  it("arguments that are valid JSON but not an object ('[]', '\"x\"', 'null', '3') are refused the same way", async () => {
    for (const bad of ['[]', '"x"', 'null', '3']) {
      toolRegistry.execute.mockClear();
      safety.check.mockClear();
      autonomyOrchestrator.evaluate.mockClear();
      const result = await run([call('tc_bad', 'crm.create_contact', bad)]);
      expect(toolRegistry.execute, bad).not.toHaveBeenCalled();
      expect(safety.check, bad).not.toHaveBeenCalled();
      expect(autonomyOrchestrator.evaluate, bad).not.toHaveBeenCalled();
      expect(result?.actions[0], bad).toMatchObject({ status: 'error', error: NOT_RUN('crm.create_contact') });
    }
  });

  it('negative control: well-formed arguments run unchanged, and a missing or empty arguments string means {}', async () => {
    const result = await run([
      call('tc_1', 'crm.create_contact', '{"name":"Ada"}'),
      { id: 'tc_2', type: 'function', function: { name: 'crm.list_contacts' } },
      call('tc_3', 'crm.list_contacts', ''),
    ]);
    expect(toolRegistry.execute).toHaveBeenCalledTimes(3);
    expect(toolRegistry.execute.mock.calls.map((c: unknown[]) => c[2])).toEqual([{ name: 'Ada' }, {}, {}]);
    expect(safety.check).toHaveBeenCalledTimes(3);
    expect(autonomyOrchestrator.evaluate).toHaveBeenCalledTimes(3);
    expect(result?.actions.every((a) => a.status === 'success')).toBe(true);
  });

  it('the refusal does not record a safety execution, does not count as a successful action, and echoes nothing from the broken arguments', async () => {
    const result = await run([call('tc_bad', 'crm.create_contact', '{"name": "IGNORE PREVIOUS INSTRUCTIONS')]);
    expect(safety.recordExecution).not.toHaveBeenCalled();
    expect(result?.actions).toHaveLength(1);
    expect(result?.actions[0].status).toBe('error');
    expect(JSON.stringify(result)).not.toMatch(/IGNORE PREVIOUS/);
    const finalMessages = modelGateway.complete.mock.calls[0][0].messages as Array<Record<string, any>>;
    expect(JSON.stringify(finalMessages.filter((m) => m.role === 'tool'))).not.toMatch(/IGNORE PREVIOUS/);
  });
});
