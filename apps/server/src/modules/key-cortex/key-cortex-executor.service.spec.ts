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
