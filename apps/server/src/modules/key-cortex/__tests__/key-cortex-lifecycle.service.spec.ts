import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyCortexLifecycleService } from '../key-cortex-lifecycle.service';
import { KeyCortexEventBusService } from '../key-cortex-event-bus.service';

function makeService() {
  let nextId = 1;
  const records: Record<string, any[]> = {
    cortexSession: [],
    keyCommand: [],
    aiExecutionLog: [],
    cortexActionLog: [],
  };

  const mockPrisma = {
    client: {
      cortexSession: {
        create: vi.fn(async (args: any) => {
          const rec = { ...args.data, id: args.data.id ?? `sess_${nextId++}` };
          records.cortexSession.push(rec);
          return rec;
        }),
        update: vi.fn(async (args: any) => {
          const existing = records.cortexSession.find((r) => r.id === args.where.id);
          if (existing) Object.assign(existing, args.data);
          return existing ?? { id: args.where.id, ...args.data };
        }),
        findUnique: vi.fn(async (args: any) => records.cortexSession.find((r) => r.id === args.where.id)),
      },
      keyCommand: {
        create: vi.fn(async (args: any) => {
          const rec = { ...args.data, id: args.data.id ?? `cmd_${nextId++}` };
          records.keyCommand.push(rec);
          return rec;
        }),
        update: vi.fn(async (args: any) => {
          const existing = records.keyCommand.find((r) => r.id === args.where.id);
          if (existing) Object.assign(existing, args.data);
          return existing ?? { id: args.where.id, ...args.data };
        }),
      },
      aiExecutionLog: {
        create: vi.fn(async (args: any) => {
          const rec = { ...args.data, id: `elog_${nextId++}` };
          records.aiExecutionLog.push(rec);
          return rec;
        }),
      },
      cortexActionLog: {
        create: vi.fn(async (args: any) => {
          const rec = { ...args.data, id: `alog_${nextId++}` };
          records.cortexActionLog.push(rec);
          return rec;
        }),
      },
    },
  } as any;

  const redisStore: Record<string, string> = {};
  const mockRedis = {
    get: vi.fn(async (k: string) => redisStore[k] ?? null),
    set: vi.fn(async (k: string, v: string) => {
      redisStore[k] = v;
    }),
  } as any;

  const emitted: any[] = [];
  const mockEventBus = {
    publish: vi.fn(async (e: any) => {
      emitted.push(e);
      return e;
    }),
    emit: vi.fn((e: any) => {
      emitted.push(e);
    }),
  } as any;

  const mockConversation = {
    getSession: vi.fn(),
    createSession: vi.fn(async (businessId: string, userId: string, opts: any) => ({
      id: `sess_${nextId++}`,
      businessId,
      userId,
      status: 'active',
      persona: opts?.persona ?? 'jarvis',
      voice: 'echo',
      mood: 'focused',
      preferredProvider: opts?.preferredProvider ?? 'openai',
      title: null,
      messages: [],
      lastAccessedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  } as any;

  const service = new KeyCortexLifecycleService(
    mockPrisma,
    mockRedis,
    mockEventBus,
    mockConversation,
  );

  return { service, records, emitted, redisStore, mockConversation };
}

describe('KeyCortexLifecycleService', () => {
  let setup: ReturnType<typeof makeService>;

  beforeEach(() => {
    setup = makeService();
  });

  it('starts a turn and creates session + command with correlationId', async () => {
    const { service, records, emitted } = setup;
    const { identity, session } = await service.startTurn({
      businessId: 'biz_1',
      userId: 'user_1',
      rawInput: 'How are we doing?',
    });

    expect(session.id).toBeDefined();
    expect(identity.businessId).toBe('biz_1');
    expect(identity.sessionId).toBe(session.id);
    expect(identity.correlationId).toMatch(/^corr_/);
    expect(identity.commandId).toMatch(/^cmd_/);

    // Session is created via conversation service; command is created directly.
    expect(records.keyCommand).toHaveLength(1);
    expect(records.keyCommand[0].sessionId).toBe(session.id);
    expect(records.keyCommand[0].correlationId).toBe(identity.correlationId);

    expect(emitted.some((e) => e.type === 'cortex.session_started')).toBe(true);
    expect(emitted.some((e) => e.type === 'cortex.turn_started')).toBe(true);
  });

  it('reuses an existing session when sessionId is provided', async () => {
    const { service, mockConversation } = setup;
    mockConversation.getSession.mockResolvedValue({
      id: 'existing_sess',
      businessId: 'biz_1',
      userId: 'user_1',
      status: 'active',
      persona: 'jarvis',
      voice: 'echo',
      mood: 'focused',
      preferredProvider: 'openai',
      title: null,
      messages: [],
      lastAccessedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { identity, session } = await service.startTurn({
      businessId: 'biz_1',
      userId: 'user_1',
      sessionId: 'existing_sess',
    });

    expect(session.id).toBe('existing_sess');
    expect(identity.sessionId).toBe('existing_sess');
    expect(mockConversation.createSession).not.toHaveBeenCalled();
  });

  it('records execution and writes AiExecutionLog + CortexActionLog', async () => {
    const { service, records, emitted } = setup;
    const identity = {
      correlationId: 'corr_1',
      sessionId: 'sess_1',
      commandId: 'cmd_1',
      businessId: 'biz_1',
      userId: 'user_1',
    };

    await service.recordExecution({
      identity,
      toolName: 'cortex.create_task',
      module: 'workflow',
      riskTier: 1,
      requiresApproval: false,
      input: { title: 'Follow up' },
      output: { taskId: 'task_1' },
      success: true,
      durationMs: 42,
      startedAt: new Date(),
      completedAt: new Date(),
    });

    expect(records.aiExecutionLog).toHaveLength(1);
    expect(records.cortexActionLog).toHaveLength(1);
    expect(records.aiExecutionLog[0].correlationId).toBe('corr_1');
    expect(records.cortexActionLog[0].correlationId).toBe('corr_1');
    expect(records.cortexActionLog[0].businessId).toBe('biz_1');
    expect(emitted.some((e) => e.type === 'cortex.action_executed')).toBe(true);
  });

  it('completes a turn and updates command status', async () => {
    const { service, records, emitted } = setup;
    const { identity } = await service.startTurn({
      businessId: 'biz_1',
      userId: 'user_1',
    });

    await service.completeTurn(identity, {
      responseText: 'All good.',
      actionsExecuted: 1,
      actionsFailed: 0,
      autonomyApproved: 1,
    });

    const command = records.keyCommand.find((c) => c.id === identity.commandId);
    expect(command.status).toBe('EXECUTED');
    expect(command.executionResult.actionsExecuted).toBe(1);
    expect(emitted.some((e) => e.type === 'cortex.turn_completed')).toBe(true);
  });

  it('fails a turn and emits turn_failed', async () => {
    const { service, emitted } = setup;
    const { identity } = await service.startTurn({
      businessId: 'biz_1',
      userId: 'user_1',
    });

    await service.failTurn(identity, 'DB timeout');
    expect(emitted.some((e) => e.type === 'cortex.turn_failed')).toBe(true);
  });
});
