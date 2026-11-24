/**
 * MEM-SALIENCE-SIGHT (D-234, D-100; owner ruling D-257), at the flow chat: the standing context appended to the
 * system prompt of POST flow/chat and POST flow/chat/stream is projected for the turn's member, by the module scopes
 * ModuleScopeGuard reads (readersModuleSight). A STAFF member whose explicit map gives no revenue read is not told the
 * business's overdue-invoice count; one with revenue read is; a turn with no member is told no module's signal.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FlowOrchestratorService } from './flow-orchestrator.service';
import { AiOversightService } from './ai-oversight.service';
import { RoleEngineService } from './role-engine.service';
import { AiFlowController } from './flow.controller';
import { KeyActionBoundaryService } from '../key-autonomy/action-boundary/key-action-boundary.service';
import { JobRolePolicyService } from '../structure/job-role-policy.service';
import { KeyCortexSalienceService } from '../key-cortex/key-cortex-salience.service';
import { KeyCortexEndocrineService } from '../key-cortex/key-cortex-endocrine.service';
import { CognitiveTriageService } from '../key-cortex/cognitive-triage.service';
import { AdaptiveRouterService } from '../key-cortex/adaptive-router.service';

const BIZ = 'biz_mem_salience_flow';
const USER = 'u_mem_salience_staff';
const REPLY = 'All good';
const HOUR = 3600_000;

const ENV_KEYS = ['AI_INTEGRATIONS_OPENAI_API_KEY', 'OPENAI_API_KEY', 'KEY_DISABLED'] as const;
const savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  vi.stubEnv('ENABLE_SCHEDULERS_IN_TEST', '1');
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

type Ev = { eventType: string; createdAt: Date; subjectId: string };
const EVENTS: Ev[] = [
  ...Array.from({ length: 12 }, (_, i) => ({ eventType: 'proactive.invoice_overdue', subjectId: `inv_${i}`, createdAt: new Date(Date.now() - (i + 1) * HOUR) })),
  ...Array.from({ length: 3 }, (_, i) => ({ eventType: 'proactive.booking_no_show', subjectId: `bk_${i}`, createdAt: new Date(Date.now() - (i + 1) * HOUR) })),
];

function eventsPrisma() {
  return {
    client: {
      $queryRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join('?');
        if (sql.includes('date_trunc')) return Promise.resolve([{ avg: null }]);
        const since = values[2] as Date;
        const n = new Set(EVENTS.filter((e) => e.eventType === values[1] && e.createdAt >= since).map((e) => e.subjectId)).size;
        return Promise.resolve([{ c: n }]);
      }),
      keyCortexMemory: { upsert: vi.fn(async () => ({})), deleteMany: vi.fn(async () => ({ count: 0 })) },
    },
  };
}

/** The membership the turn's member holds: a role and an explicit module map (null: role defaults). */
type Membership = { role: string; permissionScopes: Record<string, string> | null } | null;

async function makeTurn(membership: Membership) {
  const endocrine = new KeyCortexEndocrineService();
  const salience = new KeyCortexSalienceService(eventsPrisma() as never, endocrine);
  await salience.appraise(BIZ);
  const triage = new CognitiveTriageService(new AdaptiveRouterService(), endocrine, undefined, undefined, undefined, undefined, salience);

  const policy = new JobRolePolicyService();
  const roleEngine = new RoleEngineService({} as never, {} as never, {} as never);
  const settings = { autonomyLevel: 2, approvedTools: [], blockedTools: [], approvalTimeoutHours: 24 };
  const governance = new AiOversightService(
    { client: { autopilotSettings: { findUnique: async () => settings }, aiMemory: { findUnique: async () => null } } } as never,
    {} as never, {} as never, roleEngine, {} as never, policy,
  );
  const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2, estimatedCost: 0 };
  const trackAndComplete = vi.fn(async () => ({ content: REPLY, toolCalls: [], usage }));
  const trackAndStream = vi.fn(async function* () {
    yield { type: 'content_delta', content: REPLY };
    yield { type: 'usage', usage };
  });

  const orchestrator = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    logger: { log() {}, warn() {}, error() {}, debug() {} },
    prisma: {
      client: {
        membership: {
          findUnique: vi.fn(async (args: { where: { userId_businessId: { userId: string; businessId: string } } }) =>
            args.where.userId_businessId.userId === USER && args.where.userId_businessId.businessId === BIZ ? membership : null,
          ),
        },
      },
    },
    governance,
    roleEngine,
    executionLog: { log: async () => undefined, logToolExecution: async () => undefined },
    moduleRef: { get: (t: unknown) => (t === JobRolePolicyService ? policy : t === KeyActionBoundaryService ? { adopts: () => false } : undefined) },
    businessGraph: { invalidateCache() {}, getSnapshot: async () => ({ business: { name: 'Biz' } }), buildContextString: () => '' },
    aiUsage: { checkRateLimit() {}, checkCredits: async () => ({ allowed: true }), trackAndComplete, trackAndStream },
    memory: { buildContextBlock: async () => ({}), buildPromptSection: () => '' },
    semanticMemory: { search: async () => [] },
    buildAttachmentContext: async () => '',
    buildSemanticMemorySection: async () => '',
    buildBlueprintSection: async () => '',
    buildOnboardingDirective: async () => '',
    buildPerceptionSection: async () => '',
    getTriage: () => triage,
    selectToolsForRequest: async () => [],
    saveConversationHistory: vi.fn(async () => undefined),
    enforceDoNotSay: async () => undefined,
    finalizeStreamSession: async function* () {},
  }) as FlowOrchestratorService;

  const controller = new AiFlowController(orchestrator);
  const promptOf = (fn: typeof trackAndComplete | typeof trackAndStream) =>
    JSON.stringify((fn.mock.calls[0] as unknown[] | undefined)?.[3] ?? null);
  return { orchestrator, controller, trackAndComplete, trackAndStream, promptOf };
}

async function postChat(turn: Awaited<ReturnType<typeof makeTurn>>) {
  return turn.controller.flowChat(BIZ, { message: 'how are things?', history: [] } as never, { id: USER } as never);
}

async function postStream(turn: Awaited<ReturnType<typeof makeTurn>>): Promise<string> {
  const chunks: string[] = [];
  const res = { destroyed: false, setHeader() {}, flushHeaders() {}, write: (c: string) => chunks.push(c), end() {} };
  await turn.controller.flowChatStream(BIZ, { id: USER } as never, { message: 'how are things?', history: [] } as never, res as never);
  return chunks.join('');
}

const STAFF_NO_REVENUE: Membership = { role: 'STAFF', permissionScopes: { revenue: 'none', bookings: 'write', crm: 'read', operations: 'read' } };
const STAFF_WITH_REVENUE: Membership = { role: 'STAFF', permissionScopes: { revenue: 'read', bookings: 'write', crm: 'read', operations: 'read' } };

describe('MEM-SALIENCE-SIGHT: the flow chat system prompt is projected for the turn\'s member', () => {
  it('POST flow/chat: a STAFF member without revenue read is not told the overdue-invoice count', async () => {
    const turn = await makeTurn(STAFF_NO_REVENUE);
    const result = await postChat(turn);
    expect(result.reply).toBe(REPLY);
    const prompt = turn.promptOf(turn.trackAndComplete);
    expect(prompt).not.toContain('overdue invoices');
    expect(prompt).toContain('booking no-shows');
  });

  it('POST flow/chat/stream: a STAFF member without revenue read is not told the overdue-invoice count', async () => {
    const turn = await makeTurn(STAFF_NO_REVENUE);
    const sse = await postStream(turn);
    expect(sse).toContain('data: [DONE]');
    const prompt = turn.promptOf(turn.trackAndStream);
    expect(prompt).not.toContain('overdue invoices');
    expect(prompt).toContain('booking no-shows');
  });

  it('control: a STAFF member with revenue read is told it, on both paths', async () => {
    const chat = await makeTurn(STAFF_WITH_REVENUE);
    await postChat(chat);
    expect(chat.promptOf(chat.trackAndComplete)).toContain('overdue invoices');
    const stream = await makeTurn(STAFF_WITH_REVENUE);
    await postStream(stream);
    expect(stream.promptOf(stream.trackAndStream)).toContain('overdue invoices');
  });

  it('a turn by someone who is no member of the business is told no module\'s signal', async () => {
    const turn = await makeTurn(null);
    await postChat(turn);
    const prompt = turn.promptOf(turn.trackAndComplete);
    expect(prompt).not.toContain('overdue invoices');
    expect(prompt).not.toContain('booking no-shows');
  });

  it('a memberless turn (no user) is told no module\'s signal', async () => {
    const turn = await makeTurn(STAFF_WITH_REVENUE);
    await turn.orchestrator.chat(BIZ, 'how are things?', []);
    const prompt = turn.promptOf(turn.trackAndComplete);
    expect(prompt).not.toContain('overdue invoices');
    expect(prompt).not.toContain('booking no-shows');
  });
});
