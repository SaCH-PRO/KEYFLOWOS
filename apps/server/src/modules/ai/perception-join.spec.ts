/**
 * KEY answered from a different memory than it perceived with.
 *
 * The afferent side is real and busy: webhooks, three Google pollers, five
 * organ adapters, and ~18 crons feed CognitiveEvent, BusinessEvent,
 * GenomeMemoryEvent, TemporalFlowMemory, CognitionMemory, AiExecutionLog and
 * CortexActionLog.
 *
 * The chat that actually answers users read businessGraph, AiMemory and
 * semanticMemory — and NONE of those seven tables. So KEY could watch an
 * invoice go overdue, record it, raise an alert about it, and then answer
 * "how are we doing?" without knowing.
 *
 * UnifiedMemoryRetrievalService already reads all of them and ranks by
 * recency, relevance and confidence. Its only consumers sat on the cortex query
 * pipeline, which the web never calls — so a complete retrieval layer was
 * running for nobody.
 *
 * Cost is graded by the thalamus rather than paid on every message, which is
 * the difference between joining perception and doubling the bill.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FlowOrchestratorService } from './flow-orchestrator.service';

const src = readFileSync(join(__dirname, 'flow-orchestrator.service.ts'), 'utf8');

/** Method source with comments stripped — an assertion that matches the comment
 *  explaining a defect would pass against the defect itself. */
function methodSource(name: string): string {
  const i = src.indexOf(`private async ${name}(`);
  const body = src.slice(i, src.indexOf('\n  private ', i + 10));
  return body
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/**');
    })
    .join('\n');
}

type Fragment = {
  sourceType: string;
  title: string;
  content: string;
};

class MemoryStub {
  fragments: Fragment[] = [];
  retrieveContext = vi.fn(() => Promise.resolve(this.fragments));
}

/**
 * Runs the REAL method against a stub instance.
 *
 * Constructing FlowOrchestratorService properly would mean stubbing ~30
 * injected services, and the method under test only touches two of them. Taking
 * the implementation off the prototype exercises the shipped code without that
 * ceremony — and it still fails if the method is deleted or renamed.
 */
function makeOrchestrator(memory: MemoryStub) {
  const impl = (
    FlowOrchestratorService.prototype as unknown as Record<
      string,
      (b: string, q: string, t?: string, u?: string) => Promise<string>
    >
  ).buildPerceptionSection;

  const instance = {
    moduleRef: { get: () => memory },
    logger: { warn: vi.fn() },
    getUnifiedMemory: () => memory,
  };

  return {
    buildPerceptionSection: (b: string, q: string, t?: string, u?: string) =>
      impl.call(instance, b, q, t, u),
  };
}

describe('perception reaches the prompt', () => {
  let memory: MemoryStub;

  beforeEach(() => {
    memory = new MemoryStub();
    memory.fragments = [
      {
        sourceType: 'cognitive_event',
        title: 'Invoice overdue',
        content: 'INV-014 for Acme is 21 days overdue',
      },
    ];
  });

  it('includes what KEY observed', async () => {
    const out = await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'how are we doing', 'standard');

    expect(out).toContain('WHAT YOU HAVE OBSERVED');
    expect(out).toContain('INV-014');
  });

  it('labels the source, so KEY can say how it knows', async () => {
    const out = await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'q', 'standard');
    expect(out).toContain('[cognitive_event]');
  });

  it('says nothing when nothing was observed', async () => {
    memory.fragments = [];
    const out = await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'q', 'standard');
    expect(out).toBe('');
  });

  it('cannot fail the request', async () => {
    // Missing context must degrade the answer, never break the chat.
    memory.retrieveContext.mockRejectedValue(new Error('table locked'));
    const out = await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'q', 'standard');
    expect(out).toBe('');
  });
});

describe('cost is graded by the thalamus', () => {
  let memory: MemoryStub;

  beforeEach(() => {
    memory = new MemoryStub();
    memory.fragments = [{ sourceType: 'business_event', title: 't', content: 'c' }];
  });

  it('reflex pays NOTHING — no query at all', async () => {
    // A greeting does not need to know what the watchers saw last week.
    const out = await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'hi', 'reflex');

    expect(memory.retrieveContext).not.toHaveBeenCalled();
    expect(out).toBe('');
  });

  it('deliberate gets a wider window than standard', async () => {
    const svc = makeOrchestrator(memory);
    await svc.buildPerceptionSection('biz_1', 'q', 'standard');
    await svc.buildPerceptionSection('biz_1', 'q', 'deliberate');

    const [std] = memory.retrieveContext.mock.calls[0] as unknown as [string, { limit: number }];
    void std;
    const stdOpts = (memory.retrieveContext.mock.calls[0] as unknown as [string, { limit: number }])[1];
    const delOpts = (memory.retrieveContext.mock.calls[1] as unknown as [string, { limit: number }])[1];

    expect(delOpts.limit).toBeGreaterThan(stdOpts.limit);
  });

  it('is bounded and filtered — never an unbounded scan', async () => {
    await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'q', 'deliberate');

    const opts = (memory.retrieveContext.mock.calls[0] as unknown as [string, Record<string, number>])[1];
    expect(opts.limit).toBeGreaterThan(0);
    expect(opts.limit).toBeLessThanOrEqual(25);
    expect(opts.minRankScore).toBeGreaterThan(0);
  });

  it('gives up rather than stalling time-to-first-token', async () => {
    // Eight tables are queried in parallel and awaited BEFORE the first token,
    // so one locked table would stall every message. Perception is context:
    // worth a moment, never worth making the chat feel broken.
    memory.retrieveContext = vi.fn(() => new Promise(() => {})) as never;

    const started = Date.now();
    const out = await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'q', 'standard');

    expect(out).toBe('');
    expect(Date.now() - started, 'no deadline — a hung query blocks the answer').toBeLessThan(3000);
  });

  it('applies a quality floor that can actually reject a row', async () => {
    // 0.3 was decorative: rankScore floors at 0.5*0.45 + 0*0.35 + 0.75*0.2 =
    // 0.375, so nothing was ever below the "floor". The value must sit inside
    // the real 0.375–1.0 range or the filter is a comment.
    await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'q', 'standard');

    const opts = (memory.retrieveContext.mock.calls[0] as unknown as [
      string,
      { minRankScore: number },
    ])[1];
    expect(opts.minRankScore, 'floor is below the minimum achievable rank').toBeGreaterThan(0.375);
  });

  it('does NOT pass a query — that would buy a second embedding call per message', async () => {
    // The defect this pins actually shipped, and every test above passed
    // while it was live, because they stub retrieveContext wholesale and a
    // stub cannot reveal what the real implementation does.
    //
    // UnifiedMemoryRetrievalService.retrieveContext branches on options.query
    // and runs semanticMemory.search, which calls generateEmbedding — a real
    // API request. FlowOrchestrator already runs that exact search on the same
    // message ~40 lines earlier, so passing a query here doubled the embedding
    // cost of every chat message for a result already in the prompt.
    //
    // The structured stores are what this call is for.
    await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'how are we doing', 'standard');

    const opts = (memory.retrieveContext.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ])[1];
    expect(opts.query, 'passing query re-runs semantic search and re-embeds').toBeUndefined();
  });
});

describe('personal memory stays personal', () => {
  // The audit's finding: "any business member sees every other member's queries
  // and actions in their prompt". AiExecutionLog and CortexActionLog record
  // what a SPECIFIC person asked KEY to do, including a rationale explaining
  // why — "draft a termination letter for Ana" is not shared business context.
  //
  // The line drawn: business events describe the BUSINESS and stay shared,
  // because an assistant that could not see an invoice went overdue just
  // because a colleague noticed it first would be useless. Episodic memory
  // describes a PERSON.
  let memory: MemoryStub;

  beforeEach(() => {
    memory = new MemoryStub();
    memory.fragments = [{ sourceType: 'ai_execution_log', title: 't', content: 'c' }];
  });

  it('narrows retrieval to the caller', async () => {
    await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'q', 'standard', 'user_1');

    const opts = (memory.retrieveContext.mock.calls[0] as unknown as [
      string,
      { userId?: string },
    ])[1];
    expect(opts.userId, 'perception is not scoped to the caller').toBe('user_1');
  });

  it('is passed on BOTH chat paths', () => {
    const wired = src.match(/buildPerceptionSection\(businessId, message, triage\?\.tier, userId\)/g) ?? [];
    expect(wired.length, 'a chat path leaks other members’ history').toBe(2);
  });

  it('only the EPISODIC stores are narrowed, not the business-wide ones', () => {
    // Over-restricting is the opposite failure: narrowing cognitive/business
    // events by user would make KEY blind to anything a colleague's action
    // triggered.
    const unified = readFileSync(
      join(__dirname, '..', 'key-cortex', 'unified-memory-retrieval.service.ts'),
      'utf8',
    );
    const fn = unified.slice(unified.indexOf('private async loadStructuredMemory('));
    const body = fn.slice(0, fn.indexOf('\n  private '));

    // This used to assert `episodicWhere.userId = options.userId` and passed
    // while the bug was live, because ONE object called `episodicWhere` was
    // shared by businessEvent, aiExecutionLog and cortexActionLog. Only the
    // latter two have a userId column, so the businessEvent query referenced a
    // column that does not exist, Prisma rejected it, and a single shared
    // `.catch()` returning eight empty arrays wiped out every store.
    //
    // A variable NAME is not the behaviour. Assert which query gets which
    // where-clause instead — see unified-memory-retrieval-scoping.spec.ts for
    // the runtime proof that businessEvent is never handed a userId.
    expect(body).toMatch(/personalWhere\.userId = options\.userId/);
    expect(body).not.toMatch(/whereBase\.userId/);
    expect(body).not.toMatch(/episodicWhere\.userId/);

    const businessEventQuery = body.slice(body.indexOf('businessEvent.findMany'));
    expect(businessEventQuery.slice(0, 200)).toMatch(/where:\s*episodicWhere/);

    for (const personal of ['aiExecutionLog', 'cortexActionLog']) {
      const q = body.slice(body.indexOf(`${personal}.findMany`));
      expect(q.slice(0, 200), `${personal} must be narrowed to the caller`).toMatch(
        /where:\s*personalWhere/,
      );
    }
  });

  it('one failing store cannot impersonate an empty business', () => {
    // The concealment mechanism, not the bug itself: a single Promise.all with
    // one shared catch returned eight empty arrays, so any malformed query made
    // perception look merely quiet rather than broken.
    const unified = readFileSync(
      join(__dirname, '..', 'key-cortex', 'unified-memory-retrieval.service.ts'),
      'utf8',
    );
    const code = unified
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'))
      .join('\n');

    expect(code).not.toMatch(/\[\]\s*,\s*\[\]\s*,\s*\[\]\s*,\s*\[\]\s*,\s*\[\]\s*,\s*\[\]/);
    expect(code).toMatch(/Structured memory load failed for/);
  });
});

describe('the real retrieval service behaves as the stub assumes', () => {
  // Guards the gap that let the defect through: these assertions read the
  // ACTUAL implementation, so they fail if its contract changes underneath the
  // stub the tests above rely on.
  const unified = readFileSync(
    join(__dirname, '..', 'key-cortex', 'unified-memory-retrieval.service.ts'),
    'utf8',
  );

  it('still runs semantic search only when a query is supplied', () => {
    expect(unified).toMatch(/options\.query \? this\.loadSemanticMemory\(/);
  });

  it('its semantic path really does embed — this is why we omit the query', () => {
    // Sliced to the NEXT method rather than the first `\n  }`, which lands on a
    // nested block and truncates the body before the call.
    const semantic = readFileSync(join(__dirname, 'semantic-memory.service.ts'), 'utf8');
    const start = semantic.indexOf('async search(');
    const next = semantic.slice(start + 10).search(/\n {2}(private |async |[a-z][a-zA-Z]*\()/);
    expect(semantic.slice(start, start + 10 + next)).toMatch(/generateEmbedding\(/);
  });

  it('its structured reads stay bounded and tenant-scoped', () => {
    // 8 tables in one parallel batch, on the chat path. If any loses its take
    // or its businessId scope, that is a per-message full scan or a leak.
    const fn = unified.slice(unified.indexOf('private async loadStructuredMemory('));
    const body = fn.slice(0, fn.indexOf('\n  private '));

    const takes = body.match(/take: \d+/g) ?? [];
    const wheres = body.match(/where: \w+/g) ?? [];
    expect(takes.length).toBeGreaterThanOrEqual(8);
    expect(wheres.length).toBeGreaterThanOrEqual(8);
    expect(body).toMatch(/businessId/);
  });
});

describe('it is wired into BOTH chat paths', () => {
  it('appends perception on the streaming and non-streaming paths', () => {
    // Asserts the ASSIGNMENT, not the call.
    //
    // A first version of this matched `await this.buildPerceptionSection(` and
    // passed when the call site was changed to
    // `void (await this.buildPerceptionSection(...))` — computing the section
    // and throwing it away. That is this repo's signature defect, and the test
    // meant to catch it reproduced it.
    const appended = src.match(/systemPrompt \+= await this\.buildPerceptionSection\(/g) ?? [];
    expect(appended.length).toBe(2);
  });

  it('passes the triage tier through, so grading actually applies', () => {
    // Tolerant of trailing arguments: `userId` was appended when perception was
    // scoped per user, and an exact-arity match silently stopped testing
    // anything the moment the signature grew.
    expect(src).toMatch(/buildPerceptionSection\(businessId, message, triage\?\.tier[,)]/);
  });

  it('skips retrieval on reflex inside the method itself', () => {
    expect(methodSource('buildPerceptionSection')).toMatch(/tier === 'reflex'/);
  });
});
