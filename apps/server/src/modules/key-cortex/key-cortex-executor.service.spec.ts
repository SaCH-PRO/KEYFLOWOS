import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KeyCortexExecutorService, type ExecutionRecord } from './key-cortex-executor.service';
import type { ConnectorCommand } from './key-cortex-connector.types';

/**
 * R0-09e-KEY-PLAN-ACTOR (R0-09c review ST-7): the execute audit row.
 *
 * KeyCortexExecutorService.logExecution wrote fields AiExecutionLog does not
 * have (traceId, parameters, commandJson, resultData, executionTimeMs,
 * rolledBack, rollbackResult, startedAt, finishedAt, source) through an untyped
 * client, so Prisma refused every row ("Unknown argument `traceId`"), and
 * execute() called it fire-and-forget, so nothing waited for, or noticed, the
 * row that was never written. Pinned here: the row uses only the model's own
 * columns (read from packages/db/prisma/schema.prisma), names a human actor in
 * userId with actor 'user' and a system actor with no userId and actor
 * 'system', and execute() awaits it, logging (never throwing) a failed write.
 * The real-database half is test/key-cortex-actor-binding.integration.test.ts.
 */

/** The scalar column names of a Prisma model, read from the schema itself. */
function modelColumns(model: string): Set<string> {
  const schema = readFileSync(join(__dirname, '../../../../../packages/db/prisma/schema.prisma'), 'utf8');
  const body = schema.match(new RegExp(`\\nmodel ${model} \\{([\\s\\S]*?)\\n\\}`))?.[1];
  if (!body) throw new Error(`model ${model} not found in schema.prisma`);
  const columns = new Set<string>();
  for (const line of body.split('\n')) {
    const m = line.trim().match(/^(\w+)\s+(\w+)(\[\])?\??(\s|$)/);
    if (!m) continue;
    // A relation field (its type is another model) is not a column.
    if (/^[A-Z]/.test(m[2]) && !['String', 'Int', 'Boolean', 'DateTime', 'Json', 'Float', 'Decimal', 'BigInt', 'Bytes'].includes(m[2])) continue;
    columns.add(m[1]);
  }
  return columns;
}

const HUMAN = 'user_staff';

function command(over: Partial<ConnectorCommand> = {}): ConnectorCommand {
  return {
    module: 'settings' as any,
    action: 'update_business_profile',
    parameters: { name: 'k' },
    businessId: 'biz_1',
    userId: HUMAN,
    source: 'key_cortex',
    timestamp: new Date(),
    correlationId: 'corr_1',
    ...over,
  };
}

function record(over: Partial<ExecutionRecord> = {}, cmd: ConnectorCommand = command()): ExecutionRecord {
  return {
    id: 'exec_1',
    command: cmd,
    result: { success: false, error: 'Only the business owner can edit the business profile', executionTimeMs: 3, command: cmd },
    startedAt: new Date(),
    finishedAt: new Date(),
    durationMs: 3,
    traceId: 'trace_1',
    rolledBack: false,
    ...over,
  };
}

let executor: any;

function build(create: (args: any) => Promise<unknown>, users: string[] = [HUMAN]) {
  const prisma = {
    client: {
      aiExecutionLog: { create: vi.fn(create), count: vi.fn(async () => 0) },
      user: { findUnique: vi.fn(async ({ where }: any) => (users.includes(where.id) ? { id: where.id } : null)) },
      businessSetting: { findUnique: vi.fn(async () => null) },
    },
  };
  const connector = {
    execute: vi.fn(async (c: ConnectorCommand) => ({ success: true, data: { id: 'row_1' }, executionTimeMs: 1, command: c })),
    getAllCapabilities: () => [],
  };
  const orchestrator = { evaluateAction: vi.fn(async () => ({ allowed: true, requiresApproval: false })) };
  executor = new KeyCortexExecutorService(connector as any, prisma as any, { emit: vi.fn() } as any, {} as any, orchestrator as any);
  return { prisma, connector };
}

afterEach(() => {
  if (executor?.approvalCleanupInterval) clearInterval(executor.approvalCleanupInterval);
});

describe('KeyCortexExecutorService.logExecution — one ai_execution_logs row per execute, naming its actor (R0-09e, review ST-7)', () => {
  it('RED-BEFORE: the row uses only columns AiExecutionLog has (schema.prisma), so Prisma accepts it', async () => {
    const columns = modelColumns('AiExecutionLog');
    expect(columns.has('userId') && columns.has('inputSummary') && columns.has('durationMs')).toBe(true);
    const { prisma } = build(async () => ({}));
    await executor.logExecution(record());
    const data = prisma.client.aiExecutionLog.create.mock.calls[0][0].data;
    expect(Object.keys(data).filter((k) => !columns.has(k))).toEqual([]);
  });

  it("RED-BEFORE: a human actor is named in userId with actor 'user', with the command, the refusal and its duration", async () => {
    const { prisma } = build(async () => ({}));
    await executor.logExecution(record());
    expect(prisma.client.aiExecutionLog.create.mock.calls[0][0].data).toEqual({
      id: 'exec_1',
      businessId: 'biz_1',
      userId: HUMAN,
      actor: 'user',
      action: 'update_business_profile',
      toolName: 'settings.update_business_profile',
      module: 'settings',
      inputSummary: { actorId: HUMAN, parameters: { name: 'k' }, source: 'key_cortex', traceId: 'trace_1' },
      outputSummary: { data: null, rolledBack: false, rollbackError: null },
      success: false,
      errorMessage: 'Only the business owner can edit the business profile',
      durationMs: 3,
      correlationId: 'corr_1',
    });
  });

  it("RED-BEFORE: a system actor ('key_cortex', 'system', 'key_ai', or none) names no user (the User foreign key) and is labelled actor 'system', with the actor id kept in inputSummary", async () => {
    for (const actorId of ['key_cortex', 'system', 'key_ai', '']) {
      const { prisma } = build(async () => ({}));
      await executor.logExecution(record({}, command({ userId: actorId })));
      const data = prisma.client.aiExecutionLog.create.mock.calls[0][0].data;
      expect(data, actorId).toMatchObject({ userId: null, actor: 'system', inputSummary: { actorId } });
    }
  });

  it('RED-BEFORE: a large or unserializable payload is kept as a preview or a marker and still writes the row', async () => {
    const { prisma } = build(async () => ({}));
    await executor.logExecution(record({}, command({ parameters: { blob: 'x'.repeat(6000) } })));
    expect(prisma.client.aiExecutionLog.create.mock.calls[0][0].data.inputSummary.parameters).toMatchObject({ _truncated: true });
    await executor.logExecution(record({}, command({ parameters: { n: BigInt(1) } as any })));
    expect(prisma.client.aiExecutionLog.create.mock.calls[1][0].data.inputSummary.parameters).toEqual({ _error: 'Could not serialize payload' });
  });

  it('RED-BEFORE: execute() awaits the audit row: it is written before execute() resolves, and names the command actor', async () => {
    let written = false;
    const { prisma } = build(async () => {
      await new Promise((r) => setTimeout(r, 20));
      written = true;
      return {};
    });
    const rec = await executor.execute(command(), { skipApproval: true });
    expect(rec.result.success).toBe(true);
    expect(written).toBe(true);
    expect(prisma.client.aiExecutionLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.client.aiExecutionLog.create.mock.calls[0][0].data).toMatchObject({ userId: HUMAN, actor: 'user', success: true, outputSummary: { data: { id: 'row_1' } } });
  });

  it('RED-BEFORE: a failed audit write is logged by the time execute() returns, and execute() still returns its record', async () => {
    build(async () => { throw new Error('db down'); });
    const errors = vi.spyOn(executor.logger, 'error').mockImplementation(() => undefined);
    const rec = await executor.execute(command(), { skipApproval: true });
    expect(rec.result.success).toBe(true);
    expect(errors.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/Audit log failed: db down/);
  });
});

/**
 * R0-09e repair (review ST-1 / CR-1): execute() returned before logExecution on
 * five paths, all before the connector: a blocked action, an autonomy-
 * orchestrator deny, a legacy-gate BLOCK, a gate error and approval pending. So
 * a refused execute, the kind an audit most needs, left no ai_execution_logs
 * row. Pinned here: each of those paths writes exactly one row naming the
 * command's actor, with the refusal, before execute() resolves, and the record
 * execute() answers is unchanged.
 */
describe('KeyCortexExecutorService.execute — a refused execute writes its ai_execution_logs row too (R0-09e repair, review ST-1 / CR-1)', () => {
  function buildWith(opts: { orchestrator?: any; gate?: any; setting?: any } = {}) {
    const prisma = {
      client: {
        aiExecutionLog: { create: vi.fn(async (_args: any) => ({})), count: vi.fn(async () => 0) },
        user: { findUnique: vi.fn(async ({ where }: any) => (where.id === HUMAN ? { id: HUMAN } : null)) },
        businessSetting: { findUnique: vi.fn(async () => opts.setting ?? null) },
      },
    };
    const connector = {
      execute: vi.fn(async (c: ConnectorCommand) => ({ success: true, data: { id: 'row_1' }, executionTimeMs: 1, command: c })),
      getAllCapabilities: () => [],
    };
    const orchestrator = 'orchestrator' in opts
      ? opts.orchestrator
      : { evaluateAction: vi.fn(async () => ({ allowed: true, requiresApproval: false })) };
    executor = new KeyCortexExecutorService(connector as any, prisma as any, { emit: vi.fn() } as any, (opts.gate ?? {}) as any, orchestrator);
    return { prisma, connector };
  }
  const rows = (prisma: any) => prisma.client.aiExecutionLog.create.mock.calls.map((c: any[]) => c[0].data);

  it('RED-BEFORE: a blocked action (UPDATE_RECORD, EXECUTE_TOOL, QUERY_DATABASE) writes one row naming the actor, success false, with the refusal; the connector is not called', async () => {
    for (const action of ['UPDATE_RECORD', 'EXECUTE_TOOL', 'QUERY_DATABASE']) {
      const { prisma, connector } = buildWith();
      const rec = await executor.execute(command({ action }), { skipApproval: true });
      expect(rec.result.success, action).toBe(false);
      expect(connector.execute, action).not.toHaveBeenCalled();
      expect(rows(prisma), action).toHaveLength(1);
      expect(rows(prisma)[0], action).toMatchObject({
        id: rec.id, userId: HUMAN, actor: 'user', action, success: false, errorMessage: rec.result.error,
      });
      expect(String(rows(prisma)[0].errorMessage)).toMatch(/disabled in this build/);
    }
  });

  it('RED-BEFORE: an autonomy-orchestrator deny writes one row with the reason; the connector is not called', async () => {
    const { prisma, connector } = buildWith({ orchestrator: { evaluateAction: vi.fn(async () => ({ allowed: false, reason: 'tier 4 is locked' })) } });
    const rec = await executor.execute(command(), { skipApproval: true });
    expect(rec.result).toMatchObject({ success: false, error: 'tier 4 is locked' });
    expect(connector.execute).not.toHaveBeenCalled();
    expect(rows(prisma)).toHaveLength(1);
    expect(rows(prisma)[0]).toMatchObject({ id: rec.id, userId: HUMAN, actor: 'user', success: false, errorMessage: 'tier 4 is locked' });
  });

  it('RED-BEFORE: a legacy-gate BLOCK (no orchestrator) writes one row with the blocking reasons; the connector is not called', async () => {
    const gate = { checkGate: vi.fn(async () => ({ decision: 'BLOCK', blockingReasons: ['genome says no'] })) };
    const { prisma, connector } = buildWith({ orchestrator: undefined, gate });
    const rec = await executor.execute(command(), { skipApproval: true });
    expect(gate.checkGate).toHaveBeenCalledTimes(1);
    expect(rec.result).toMatchObject({ success: false, error: 'genome says no' });
    expect(connector.execute).not.toHaveBeenCalled();
    expect(rows(prisma)).toHaveLength(1);
    expect(rows(prisma)[0]).toMatchObject({ id: rec.id, userId: HUMAN, success: false, errorMessage: 'genome says no' });
  });

  it('RED-BEFORE: a gate error writes one row with the fail-closed refusal; the connector is not called', async () => {
    const { prisma, connector } = buildWith({ orchestrator: { evaluateAction: vi.fn(async () => { throw new Error('orchestrator down'); }) } });
    const rec = await executor.execute(command(), { skipApproval: true });
    expect(rec.result).toMatchObject({ success: false, error: 'Autonomy gate unavailable; execution blocked for safety.' });
    expect(connector.execute).not.toHaveBeenCalled();
    expect(rows(prisma)).toHaveLength(1);
    expect(rows(prisma)[0]).toMatchObject({ id: rec.id, userId: HUMAN, success: false, errorMessage: 'Autonomy gate unavailable; execution blocked for safety.' });
  });

  it("RED-BEFORE: approval pending writes one row naming the actor, with 'Approval pending' and the approval status; the record keeps the approval id and the connector is not called", async () => {
    const { prisma, connector } = buildWith();
    vi.spyOn(executor, 'requiresApproval').mockResolvedValue(true);
    vi.spyOn(executor, 'executeWithApproval').mockResolvedValue({ id: 'proposal_1', status: 'pending' });
    const rec = await executor.execute(command());
    expect(rec.id).toBe('proposal_1');
    expect(rec.result).toMatchObject({ success: false, error: 'Approval pending', data: { approvalStatus: 'pending' } });
    expect(connector.execute).not.toHaveBeenCalled();
    expect(rows(prisma)).toHaveLength(1);
    expect(rows(prisma)[0]).toMatchObject({
      id: 'proposal_1', userId: HUMAN, actor: 'user', success: false, errorMessage: 'Approval pending',
      outputSummary: { data: { approvalStatus: 'pending' } },
    });
  });

  it('RED-BEFORE: a refused execute whose audit write fails still answers its refusal, and the failure is logged', async () => {
    const { prisma } = buildWith();
    prisma.client.aiExecutionLog.create.mockRejectedValue(new Error('db down'));
    const errors = vi.spyOn(executor.logger, 'error').mockImplementation(() => undefined);
    const rec = await executor.execute(command({ action: 'UPDATE_RECORD' }), { skipApproval: true });
    expect(rec.result.success).toBe(false);
    expect(String(rec.result.error)).toMatch(/disabled in this build/);
    expect(errors.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/Audit log failed: db down/);
  });
});

/**
 * R0-09e repair (review ST-3): fetchApprovalPolicy counted aiExecutionLog rows
 * by `startedAt`, a column AiExecutionLog does not have, through an untyped
 * client. Prisma refused the count, the catch answered the fallback policy, and
 * the business's BusinessSetting (aiAutonomyLevel, aiAlwaysRequireApproval, the
 * spending limits, the hourly cap) was never applied. Pinned here: the count
 * filters on AiExecutionLog's own columns (createdAt), the setting decides, and
 * a business that sets no spending threshold keeps the 1000 every business was
 * in fact held to. The real-database half is in key-cortex-actor-binding.
 */
describe('KeyCortexExecutorService.requiresApproval — the business approval policy applies (R0-09e repair, review ST-3)', () => {
  function buildPolicy(setting: any, recent = 0) {
    const prisma = {
      client: {
        aiExecutionLog: { create: vi.fn(async () => ({})), count: vi.fn(async (_args: any) => recent) },
        user: { findUnique: vi.fn(async () => null) },
        businessSetting: { findUnique: vi.fn(async () => setting) },
      },
    };
    executor = new KeyCortexExecutorService({ execute: vi.fn(), getAllCapabilities: () => [] } as any, prisma as any, { emit: vi.fn() } as any, {} as any, undefined);
    return prisma;
  }
  const policySetting = (over: Record<string, unknown> = {}) => ({
    aiAutonomyLevel: 'supervised', aiAlwaysRequireApproval: [], aiNeverRequireApproval: [],
    aiSpendingThreshold: null, aiActionSpendingLimits: {}, aiMaxAutoExecutionsPerHour: 100, ...over,
  });

  it('RED-BEFORE: the hourly count filters only on AiExecutionLog columns (createdAt, not startedAt)', async () => {
    const prisma = buildPolicy(policySetting());
    await executor.requiresApproval(command());
    const where = prisma.client.aiExecutionLog.count.mock.calls[0][0].where;
    const columns = modelColumns('AiExecutionLog');
    expect(Object.keys(where).filter((k) => !columns.has(k))).toEqual([]);
    expect(where).toMatchObject({ businessId: 'biz_1', success: true, createdAt: { gte: expect.any(Date) } });
  });

  it("aiAutonomyLevel 'manual' requires approval for every action", async () => {
    buildPolicy(policySetting({ aiAutonomyLevel: 'manual' }));
    expect(await executor.requiresApproval(command())).toBe(true);
  });

  it('aiAlwaysRequireApproval names an action that then needs approval, even at full autonomy; another action does not', async () => {
    buildPolicy(policySetting({ aiAutonomyLevel: 'full', aiAlwaysRequireApproval: ['settings.update_branding'] }));
    expect(await executor.requiresApproval(command({ action: 'update_branding' }))).toBe(true);
    expect(await executor.requiresApproval(command({ action: 'update_business_profile' }))).toBe(false);
  });

  it("the hourly cap counts the business's recent successful executes", async () => {
    buildPolicy(policySetting({ aiAutonomyLevel: 'full', aiMaxAutoExecutionsPerHour: 3 }), 3);
    expect(await executor.requiresApproval(command())).toBe(true);
    buildPolicy(policySetting({ aiAutonomyLevel: 'full', aiMaxAutoExecutionsPerHour: 3 }), 2);
    expect(await executor.requiresApproval(command())).toBe(false);
  });

  it('a configured spending threshold applies; with none set (no row, or a null threshold) a supervised business keeps the 1000 threshold', async () => {
    buildPolicy(policySetting({ aiSpendingThreshold: 50 }));
    expect(await executor.requiresApproval(command({ parameters: { amount: 60 } }))).toBe(true);
    for (const setting of [null, policySetting()]) {
      buildPolicy(setting);
      expect(await executor.requiresApproval(command({ parameters: { amount: 1500 } }))).toBe(true);
      expect(await executor.requiresApproval(command({ parameters: { amount: 500 } }))).toBe(false);
    }
  });
});
