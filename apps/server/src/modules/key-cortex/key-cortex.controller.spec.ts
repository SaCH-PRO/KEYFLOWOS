import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { KeyCortexController } from './key-cortex.controller';
import { KeyCortexReasoningService } from './key-cortex-reasoning.service';
import { KeyCortexConversationService } from './key-cortex-conversation.service';
import { KeyAutonomySafetyService } from '../key-autonomy/key-autonomy-safety.service';
import { CortexSession } from './key-cortex.types';

describe('KeyCortexController new endpoints', () => {
  let controller: KeyCortexController;
  let conversation: Partial<KeyCortexConversationService>;
  let reasoning: Partial<KeyCortexReasoningService>;
  let safety: Partial<KeyAutonomySafetyService>;

  const mockSession: CortexSession = {
    id: 'sess_1',
    businessId: 'biz_1',
    userId: 'user_1',
    messages: [
      { id: 'm1', role: 'user', content: 'Hello', timestamp: new Date('2026-06-29T00:00:00Z'), metadata: {} },
      { id: 'm2', role: 'assistant', content: 'Hi there', timestamp: new Date('2026-06-29T00:00:01Z'), metadata: { model: 'gpt-4o' } },
    ],
  } as any;

  const mockProfile = {
    businessId: 'biz_1',
    globalKillSwitch: false,
    maxDailyAutoActions: 10,
    maxDailySpendTtd: 0,
    maxTierWithoutApproval: 3,
    notifyOnBlock: true,
  };

  beforeEach(() => {
    conversation = {
      getSession: vi.fn().mockResolvedValue(mockSession),
      listSessions: vi.fn().mockResolvedValue([mockSession]),
    };

    reasoning = {
      streamQuery: vi.fn().mockImplementation(async function* () {
        yield { type: 'text_delta', content: 'Working' };
        yield { type: 'done' };
      }),
    };

    safety = {
      ensureProfile: vi.fn().mockResolvedValue(mockProfile),
      updateProfile: vi.fn().mockImplementation(async (_businessId: string, updates: any) => ({ ...mockProfile, ...updates })),
    };

    controller = new KeyCortexController(
      reasoning as KeyCortexReasoningService,
      conversation as KeyCortexConversationService,
      {} as any, // voice
      {} as any, // personality
      {} as any, // actions
      {} as any, // context
      {} as any, // connector
      {} as any, // command
      {} as any, // executor
      {} as any, // contextV2
      {} as any, // insight
      {} as any, // monitorV2
      {} as any, // sandbox
      {} as any, // flowStudio
      {} as any, // evolution
      {} as any, // phone
      {} as any, // document
      {} as any, // learning
      safety as KeyAutonomySafetyService,
      {} as any, // approvalOrchestrator
    );
  });

  describe('GET /api/v1/cortex/messages', () => {
    it('returns messages for the latest session when no sessionId is given', async () => {
      const result = await controller.getMessages('biz_1');
      expect(conversation.listSessions).toHaveBeenCalledWith('biz_1');
      expect(result.messages).toHaveLength(2);
      expect(result.messages[1].sender).toBe('key');
    });

    it('returns messages for a specific sessionId', async () => {
      const result = await controller.getMessages('biz_1', 'sess_1');
      expect(conversation.getSession).toHaveBeenCalledWith('sess_1');
      expect(result.messages).toHaveLength(2);
    });

    it('throws when businessId is missing', async () => {
      await expect(controller.getMessages('')).rejects.toThrow(BadRequestException);
    });

    it("refuses a session id whose (cached) session belongs to another business (review ST-1)", async () => {
      (conversation.getSession as any) = vi.fn().mockResolvedValue({ ...mockSession, businessId: 'biz_2' });
      await expect(controller.getMessages('biz_1', 'sess_1')).rejects.toThrow(NotFoundException);
    });

    it('throws when no session exists', async () => {
      (conversation.listSessions as any) = vi.fn().mockResolvedValue([]);
      await expect(controller.getMessages('biz_1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('Sse /api/v1/cortex/stream', () => {
    it('streams query results when a message is provided', async () => {
      const observable = controller.streamEvents('biz_1', 'Do something');
      const values: any[] = [];
      await new Promise<void>((resolve, reject) => {
        observable.subscribe({
          next: (v) => values.push(v.data),
          error: reject,
          complete: resolve,
        });
      });

      expect(reasoning.streamQuery).toHaveBeenCalledWith(
        expect.objectContaining({ businessId: 'biz_1', text: 'Do something', enableActions: true }),
      );
      expect(values.some((v) => v.type === 'chunk' && v.content === 'Working')).toBe(true);
      expect(values.some((v) => v.type === 'complete')).toBe(true);
    });

    it('sends heartbeat when no message is provided', async () => {
      vi.useFakeTimers();
      const observable = controller.streamEvents('biz_1');
      const values: any[] = [];
      const sub = observable.subscribe((v) => values.push(v.data));

      vi.advanceTimersByTime(16000);
      sub.unsubscribe();
      vi.useRealTimers();

      expect(values.length).toBeGreaterThan(0);
      expect(values[0]).toMatchObject({ type: 'heartbeat', businessId: 'biz_1' });
    });

    it('throws when businessId is missing', () => {
      expect(() => controller.streamEvents('')).toThrow(BadRequestException);
    });
  });

  describe('autonomy profile', () => {
    it('returns the autonomy profile', async () => {
      const result = await controller.getAutonomyProfile('biz_1');
      expect(safety.ensureProfile).toHaveBeenCalledWith('biz_1');
      expect(result).toEqual(mockProfile);
    });

    it('updates the autonomy profile', async () => {
      const dto = { businessId: 'biz_1', globalKillSwitch: true };
      // The second argument is the tenant @GuardedBusinessId() resolves (the body's, here).
      const result = await controller.updateAutonomyProfile(dto as any, 'biz_1');
      expect(safety.updateProfile).toHaveBeenCalledWith('biz_1', dto);
      expect(result.globalKillSwitch).toBe(true);
    });
  });
});

/**
 * R0-09c-KEY-ACTOR-BINDING (R0-09-ID-HARDEN review R09-ST-4; R0-34b review
 * ST-3). The actor of every KEY cortex request is the principal AuthGuard
 * admitted (req.user, read with @CurrentUser()), never a body or query `userId`
 * and never 'system' or 'key_user'. A request userId naming someone else is
 * ignored; with no authenticated user the command routes answer 401 before
 * anything runs. The real-database half is
 * test/key-cortex-actor-binding.integration.test.ts.
 *
 * Handlers are called positionally, as Nest calls them: the principal takes the
 * place the `@Query('userId')` parameter had (listSessions, streamChat,
 * streamEvents, evolutionProfile) and is appended to the others.
 */
describe('R0-09c-KEY-ACTOR-BINDING — every handler acts for the authenticated principal (review R09-ST-4)', () => {
  const ME = { id: 'user_me', email: 'me@test.local', role: 'USER' };
  const OTHER = 'user_owner';
  let ctl: any;
  let executor: any;
  let command: any;
  let connector: any;
  let conversation: any;
  let sessionService: any;
  let reasoning: any;
  let learning: any;
  let evolution: any;
  let consciousness: any;

  const drain = (observable: { subscribe: (o: any) => unknown }) =>
    new Promise<void>((resolve, reject) => { observable.subscribe({ next: () => undefined, error: reject, complete: resolve }); });

  beforeEach(() => {
    executor = {
      execute: vi.fn().mockResolvedValue({ result: { success: true } }),
      executeBatch: vi.fn().mockResolvedValue({ results: [] }),
      rollback: vi.fn().mockResolvedValue({ success: true }),
    };
    command = {
      parseIntent: vi.fn().mockResolvedValue([
        { intent: 'create_contact', confidence: 1, module: 'crm', action: 'create_contact', parameters: {}, requiresApproval: false, naturalLanguage: 'x' },
      ]),
      toConnectorCommand: vi.fn((intent: any, businessId: string, userId: string) => ({ module: intent.module, action: intent.action, parameters: {}, businessId, userId })),
    };
    connector = { getAllCapabilities: vi.fn().mockReturnValue([]), query: vi.fn().mockResolvedValue({ success: true }) };
    conversation = {
      createSession: vi.fn().mockResolvedValue({ id: 'sess_new' }),
      listSessions: vi.fn().mockResolvedValue([]),
      getSession: vi.fn().mockResolvedValue(null),
    };
    sessionService = { getOrCreateSession: vi.fn().mockResolvedValue({ id: 'sess_new', businessId: 'biz_1' }) };
    reasoning = {
      processQuery: vi.fn().mockResolvedValue({ text: 'ok' }),
      streamQuery: vi.fn().mockImplementation(async function* () { yield { type: 'done' }; }),
    };
    learning = { recordFeedback: vi.fn().mockResolvedValue(undefined) };
    evolution = { getProfile: vi.fn().mockResolvedValue({ profile: {}, generatedAt: 'now' }) };
    consciousness = { processConsciously: vi.fn().mockResolvedValue({ text: 'ok', meta: {} }) };
    ctl = new KeyCortexController(
      reasoning, conversation, {} as any, {} as any, {} as any, { buildContextSnapshot: vi.fn().mockResolvedValue({}) } as any,
      connector, command, executor, { getFullContext: vi.fn().mockResolvedValue({}) } as any, {} as any, {} as any,
      {} as any, {} as any, evolution, {} as any, {} as any, learning,
      {} as any, {} as any, consciousness, sessionService, {} as any,
    );
  });

  it("RED-BEFORE: POST execute, batch, query and rollback with no authenticated user answer 401, and nothing reaches the executor, the parser or the connector", async () => {
    const structured = { businessId: 'biz_1', command: '', module: 'crm', action: 'create_contact', parameters: {}, userId: OTHER };
    await expect(ctl.executeCommand(structured, undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(ctl.executeCommand({ businessId: 'biz_1', command: 'add a contact' }, undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(ctl.executeBatch({ businessId: 'biz_1', userId: OTHER, commands: [{ type: 'natural', command: 'x' }] }, undefined))
      .rejects.toBeInstanceOf(UnauthorizedException);
    await expect(ctl.queryModule({ businessId: 'biz_1', module: 'crm', query: 'list_contacts' }, undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(ctl.rollback({ businessId: 'biz_1', correlationId: 'corr_1' }, {})).rejects.toBeInstanceOf(UnauthorizedException);
    expect(executor.execute).not.toHaveBeenCalled();
    expect(executor.executeBatch).not.toHaveBeenCalled();
    expect(executor.rollback).not.toHaveBeenCalled();
    expect(command.parseIntent).not.toHaveBeenCalled();
    expect(connector.query).not.toHaveBeenCalled();
  });

  it('RED-BEFORE: POST execute ignores a body userId naming someone else: the structured and the parsed command name req.user', async () => {
    await ctl.executeCommand({ businessId: 'biz_1', command: '', module: 'crm', action: 'create_contact', parameters: {}, userId: OTHER }, ME);
    await ctl.executeCommand({ businessId: 'biz_1', command: 'add a contact', userId: OTHER }, ME);
    expect(executor.execute.mock.calls.map(([c]: any[]) => c.userId)).toEqual([ME.id, ME.id]);
    expect(command.parseIntent.mock.calls.map(([, context]: any[]) => context.userId)).toEqual([ME.id]);
    expect(command.toConnectorCommand.mock.calls.map(([, , userId]: any[]) => userId)).toEqual([ME.id]);
  });

  it('RED-BEFORE: POST batch builds every command, structured and natural, for req.user', async () => {
    await ctl.executeBatch({
      businessId: 'biz_1',
      userId: OTHER,
      commands: [
        { type: 'structured', module: 'crm', action: 'create_contact', parameters: {} },
        { type: 'natural', command: 'add a contact' },
      ],
    }, ME);
    expect(executor.executeBatch.mock.calls[0][0].map((c: any) => c.userId)).toEqual([ME.id, ME.id]);
    expect(command.parseIntent.mock.calls.map(([, context]: any[]) => context.userId)).toEqual([ME.id]);
  });

  it("RED-BEFORE: POST query and POST rollback hand the connector and the executor req.user, never nobody or 'system'", async () => {
    await ctl.queryModule({ businessId: 'biz_1', module: 'crm', query: 'list_contacts', parameters: {} }, ME);
    expect(connector.query).toHaveBeenCalledWith('crm', 'list_contacts', {}, 'biz_1', ME.id);
    await ctl.rollback({ businessId: 'biz_1', correlationId: 'corr_1' }, ME);
    expect(executor.rollback.mock.calls[0][0].command.userId).toBe(ME.id);
  });

  it('RED-BEFORE: session writes and reads use req.user: POST sessions, GET sessions, POST conscious/chat and GET conscious/stream', async () => {
    await ctl.createSession({ businessId: 'biz_1', userId: OTHER }, ME);
    expect(conversation.createSession.mock.calls[0].slice(0, 2)).toEqual(['biz_1', ME.id]);

    await ctl.listSessions('biz_1', ME);
    expect(conversation.listSessions).toHaveBeenCalledWith('biz_1', ME.id);

    await ctl.consciousChat({ text: 'hello', businessId: 'biz_1', userId: OTHER }, ME);
    await drain(await ctl.consciousStream({ text: 'hello', businessId: 'biz_1', userId: OTHER }, 'biz_1', ME));
    expect(sessionService.getOrCreateSession.mock.calls.map(([q]: any[]) => q.userId)).toEqual([ME.id, ME.id]);
  });

  it("RED-BEFORE: reasoning, learning and evolution use req.user: POST chat, GET chat/stream, GET stream (never 'key_user'), POST feedback, GET evolution/profile", async () => {
    await ctl.chat({ text: 'hello', businessId: 'biz_1', userId: OTHER }, ME);
    await drain(await ctl.streamChat('biz_1', 'hello', ME));
    await drain(ctl.streamEvents('biz_1', 'hello', ME));
    expect(reasoning.processQuery.mock.calls.map(([q]: any[]) => q.userId)).toEqual([ME.id]);
    expect(reasoning.streamQuery.mock.calls.map(([q]: any[]) => q.userId)).toEqual([ME.id, ME.id]);

    await ctl.recordFeedback({ sessionId: 'sess_1', businessId: 'biz_1', userId: OTHER, userResponse: 'accepted' }, ME);
    expect(learning.recordFeedback.mock.calls[0][0]).toMatchObject({ sessionId: 'sess_1', businessId: 'biz_1', userId: ME.id });

    await ctl.evolutionProfile('biz_1', ME);
    expect(evolution.getProfile).toHaveBeenCalledWith('biz_1', { userId: ME.id });
  });

  it("RED-BEFORE: the actor-bound read and write routes refuse a request with no authenticated user instead of acting for nobody or 'key_user'", async () => {
    await expect(ctl.createSession({ businessId: 'biz_1', userId: OTHER }, undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(ctl.chat({ text: 'hello', businessId: 'biz_1', userId: OTHER }, undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(ctl.listSessions('biz_1', undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(() => ctl.streamEvents('biz_1', 'hello', undefined)).toThrow(UnauthorizedException);
    expect(conversation.createSession).not.toHaveBeenCalled();
    expect(conversation.listSessions).not.toHaveBeenCalled();
    expect(reasoning.processQuery).not.toHaveBeenCalled();
    expect(reasoning.streamQuery).not.toHaveBeenCalled();
  });

  it("RED-BEFORE: source — no handler reads userId from the request, and none falls back to 'system' or 'key_user'", async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const code = readFileSync(join(__dirname, 'key-cortex.controller.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code.match(/@Query\(\s*['"]userId['"]\s*\)/g) ?? []).toEqual([]);
    expect(code.match(/\b(dto|query|body)\.userId\b/g) ?? []).toEqual([]);
    expect(code.match(/(\?\?|userId\s*:)\s*['"](system|key_user)['"]/g) ?? []).toEqual([]);
  });

  it('RED-BEFORE: tsc emits as the @Body()/@Query() type of each handler the real-database suite drives the DTO class it writes, and each of those bodies passes the production pipe without a userId', async () => {
    const ts = await import('typescript');
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const out = ts.transpileModule(readFileSync(join(__dirname, 'key-cortex.controller.ts'), 'utf8'), {
      compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true, target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS },
    }).outputText;
    // The first entry of the method's design:paramtypes, inside its own __decorate([...]) call.
    const firstParamType = (method: string) => {
      const end = out.indexOf(`], KeyCortexController.prototype, "${method}"`);
      if (end < 0) return undefined;
      return out.slice(out.lastIndexOf('__decorate([', end), end).match(/__metadata\("design:paramtypes", \[(\w+)/)?.[1];
    };
    const SUITE_WRITES: Record<string, string> = {
      executeCommand: 'ExecuteCommandDto', executeBatch: 'ExecuteBatchDto', queryModule: 'QueryModuleDto', rollback: 'RollbackDto',
      createSession: 'CreateSessionDto', chat: 'ChatQueryDto', recordFeedback: 'FeedbackDto', consciousChat: 'ConsciousChatDto',
      consciousStream: 'ConsciousChatDto',
    };
    const emitted = Object.fromEntries(Object.keys(SUITE_WRITES).map((m) => [m, firstParamType(m)]));
    expect(emitted).toEqual(SUITE_WRITES);

    // Every DTO the suite writes is exported (so it can), and a body with no userId passes the production pipe.
    const { ValidationPipe } = await import('@nestjs/common');
    const mod: Record<string, any> = await import('./key-cortex.controller');
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    for (const name of new Set(Object.values(SUITE_WRITES))) expect(typeof mod[name], name).toBe('function');
    const bodies: Array<[string, Record<string, unknown>]> = [
      ['ExecuteCommandDto', { command: 'add a contact', businessId: 'biz_1' }],
      ['ExecuteBatchDto', { commands: [{ type: 'natural', command: 'x' }], businessId: 'biz_1' }],
      ['CreateSessionDto', { businessId: 'biz_1' }],
      ['ChatQueryDto', { text: 'hello', businessId: 'biz_1' }],
      ['FeedbackDto', { sessionId: 'sess_1', businessId: 'biz_1', userResponse: 'accepted' }],
      ['ConsciousChatDto', { text: 'hello', businessId: 'biz_1' }],
    ];
    for (const [name, body] of bodies) {
      await expect(pipe.transform(body, { type: 'body', metatype: mod[name] }), name).resolves.toBeDefined();
      // A userId that is present is still a string, or the body is refused.
      await expect(pipe.transform({ ...body, userId: { id: 'x' } }, { type: 'body', metatype: mod[name] }), name).rejects.toThrow();
    }
  });
});
