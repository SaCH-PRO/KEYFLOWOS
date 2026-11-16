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
import { PROMPT_MEMORY_HEADROOM } from '../key-cortex/key-cortex-prompt-context.service';

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
  id?: string;
  sourceType: string;
  title: string;
  content: string;
  entityType?: string | null;
};

/** The stores UnifiedMemoryRetrievalService does not read when handed includeEpisodic false. */
const EPISODIC_STORES = ['business_event', 'ai_execution_log', 'cortex_action_log'];

/**
 * W11-FLOW-PERCEPTION-SCOPE review CR-W11FPS-2: answers as the real retrieval service answers the options it is handed
 * (pinned against its source in 'the real retrieval service behaves as the stub assumes'): includeEpisodic false reads
 * no business event and no personal store, and sourceTypes keeps only the stores it names. A stub that ignored them
 * passed a case the real code failed (a turn with no reader lost every business event).
 */
class MemoryStub {
  fragments: Fragment[] = [];
  retrieveContext = vi.fn((_businessId?: string, opts: { includeEpisodic?: boolean; sourceTypes?: string[] } = {}) =>
    Promise.resolve(
      this.fragments.filter(
        (f) =>
          !(opts.includeEpisodic === false && EPISODIC_STORES.includes(f.sourceType)) &&
          (!opts.sourceTypes || opts.sourceTypes.includes(f.sourceType)),
      ),
    ),
  );
}

/**
 * W11-FLOW-PERCEPTION-SCOPE (review SEC-W11MC-3, D-130): the two reads the block's reader rule makes, answered from
 * this table. user_1 is a member of biz_1 (BusinessGuard's predicate, userCanAccessBusiness); user_9 is no member.
 * COGNITION_OWNERS: the member each cognition row of biz_1 is recorded for (null: a member-less row).
 */
const MEMBERS: Record<string, string[]> = { biz_1: ['user_1', 'user_2'] };
const COGNITION_OWNERS: Record<string, string | null> = { cog_own: 'user_1', cog_other: 'user_2', cog_nobody: null };
const prismaStub = {
  client: {
    // W1F-PERCEPTION-MODULE-SCOPE (SEC-W11FPS-3): the reader's membership, whose module levels project the business-wide
    // event stores. Both members of biz_1 are STAFF on role defaults (read on revenue, expenses, crm, ...).
    membership: {
      findUnique: vi.fn(async ({ where }: { where: { userId_businessId: { userId: string; businessId: string } } }) =>
        (MEMBERS[where.userId_businessId.businessId] ?? []).includes(where.userId_businessId.userId)
          ? { role: 'STAFF', permissionScopes: null }
          : null,
      ),
    },
    business: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; members: { some: { userId: string } } } }) =>
        (MEMBERS[where.id] ?? []).includes(where.members.some.userId) ? { id: where.id } : null,
      ),
    },
    cognitionMemory: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] }; businessId: string; userId: string } }) =>
        where.businessId === 'biz_1'
          ? where.id.in.filter((id) => COGNITION_OWNERS[id] === where.userId).map((id) => ({ id }))
          : [],
      ),
    },
  },
};

/**
 * Runs the REAL method against a stub instance.
 *
 * Constructing FlowOrchestratorService properly would mean stubbing ~30
 * injected services, and the method under test only touches two of them. Taking
 * the implementation off the prototype exercises the shipped code without that
 * ceremony — and it still fails if the method is deleted or renamed.
 */
/**
 * W1F-PERCEPTION-MODULE-SCOPE (D-202): the envelopes JobRolePolicyService issued (isIssued), as the staff bridge hands
 * chat() one with the position's verified holder (FlowServerContext). A copy is not issued.
 *
 * Review SEC-W1FPMS-2 / COR-W1FPMS-2: what a position's turn perceives is what the policy resolved for the position
 * whose envelope governs the turn (JobRolePolicyService.perceptionOf(envelope)): the member whose own history it reads
 * (the holder, only when the message came from the holder's own phone) and the modules whose events it sees. The holder
 * named beside the envelope (positionHolderUserId, which call_create_task reads) is not, by itself, a reader.
 */
type Perception = { readerUserId: string | null; modules: readonly string[] };
const ISSUED = new Set<unknown>();
const PERCEPTIONS = new Map<unknown, Perception>();
/** What a STAFF member on role defaults reads: every event module but team. */
const STAFF_MODULES = ['revenue', 'expenses', 'crm', 'bookings', 'projects', 'operations', 'storefront', 'content', 'automations'];
const issuedEnvelope = (perception: Perception | null) => {
  const envelope = Object.freeze({ jobRoleName: 'Staff', approvedTools: [], blockedTools: [], maxRiskTier: 1 });
  ISSUED.add(envelope);
  if (perception) PERCEPTIONS.set(envelope, perception);
  return envelope;
};
const ISSUED_ENVELOPE = issuedEnvelope({ readerUserId: 'user_1', modules: STAFF_MODULES });
type ServerContext = { jobRoleEnvelope: unknown; positionHolderUserId?: string | null };
/**
 * A position's turn whose holder is `holder` and whose policy perception names the same holder as its reader (the
 * message came from the holder's own phone) with `modules`; a contact-only position (null) has no reader. `envelope`
 * replaces the issued one (a copy is not issued).
 */
const holderTurn = (holder: string | null, envelope?: unknown, modules: readonly string[] = holder ? STAFF_MODULES : []): ServerContext => ({
  jobRoleEnvelope: envelope ?? issuedEnvelope({ readerUserId: holder, modules }),
  positionHolderUserId: holder,
});
/** A position's turn whose holder is `holder` but whose policy perception is `perception` (SEC-W1FPMS-2, COR-W1FPMS-2). */
const positionTurn = (holder: string | null, perception: Perception | null): ServerContext => ({
  jobRoleEnvelope: issuedEnvelope(perception),
  positionHolderUserId: holder,
});

function makeOrchestrator(memory: MemoryStub) {
  const impl = (
    FlowOrchestratorService.prototype as unknown as Record<
      string,
      (b: string, q: string, t?: string, u?: string, s?: ServerContext) => Promise<string>
    >
  ).buildPerceptionSection;

  const instance = {
    moduleRef: { get: () => memory },
    logger: { warn: vi.fn() },
    getUnifiedMemory: () => memory,
    // W11-FLOW-PERCEPTION-SCOPE: the reader's membership and their own cognition rows are read with it.
    prisma: prismaStub,
    // W1F-PERCEPTION-MODULE-SCOPE (D-202): whether the staff bridge's envelope is one the policy issued, and (review
    // SEC-W1FPMS-2 / COR-W1FPMS-2) what the policy resolved that position's turn perceives.
    getJobRolePolicy: () => ({
      isIssued: (envelope: unknown) => ISSUED.has(envelope),
      perceptionOf: (envelope: unknown) => (ISSUED.has(envelope) ? PERCEPTIONS.get(envelope) ?? null : null),
    }),
  };

  return {
    buildPerceptionSection: (b: string, q: string, t?: string, u?: string, s?: ServerContext) =>
      impl.call(instance, b, q, t, u, s),
  };
}

/**
 * W11-FLOW-PERCEPTION-SCOPE review CR-W11FPS-1: the read a turn with no reader makes: nobody's userId, episodic stores
 * not turned off, and sourceTypes naming the business-wide stores (business events included) and no personal one.
 */
function expectNoReaderRead(memory: MemoryStub, label: string) {
  const opts = (memory.retrieveContext.mock.calls[0] as unknown as [
    string,
    { userId?: string; includeEpisodic?: boolean; sourceTypes?: string[] },
  ])[1];
  expect(opts.userId, label).toBeUndefined();
  expect(opts.includeEpisodic, label).not.toBe(false);
  expect(opts.sourceTypes, label).toEqual(
    expect.arrayContaining(['business_event', 'cognitive_event', 'ai_memory', 'genome_memory_event', 'temporal_flow_memory']),
  );
  for (const personal of ['ai_execution_log', 'cortex_action_log', 'cognition_memory']) {
    expect(opts.sourceTypes, `${label}: ${personal}`).not.toContain(personal);
  }
}

describe('perception reaches the prompt', () => {
  // W1F-PERCEPTION-MODULE-SCOPE (D-203): these turns are a member's (user_1, STAFF on role defaults). A turn that names
  // no member and no staff position is the customer support desk's, which perceives nothing (pinned below).
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
    const out = await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'how are we doing', 'standard', 'user_1');

    expect(out).toContain('WHAT YOU HAVE OBSERVED');
    expect(out).toContain('INV-014');
  });

  it('labels the source, so KEY can say how it knows', async () => {
    const out = await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'q', 'standard', 'user_1');
    expect(out).toContain('[cognitive_event]');
  });

  it('says nothing when nothing was observed', async () => {
    memory.fragments = [];
    const out = await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'q', 'standard', 'user_1');
    expect(out).toBe('');
  });

  it('cannot fail the request', async () => {
    // Missing context must degrade the answer, never break the chat.
    memory.retrieveContext.mockRejectedValue(new Error('table locked'));
    const out = await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'q', 'standard', 'user_1');
    expect(out).toBe('');
  });
});

describe('cost is graded by the thalamus', () => {
  // W1F-PERCEPTION-MODULE-SCOPE (D-203): a member's turns (user_1); the support desk's perceives nothing at all.
  let memory: MemoryStub;

  beforeEach(() => {
    memory = new MemoryStub();
    memory.fragments = [{ sourceType: 'business_event', title: 't', content: 'c' }];
  });

  it('reflex pays NOTHING — no query at all', async () => {
    // A greeting does not need to know what the watchers saw last week.
    const out = await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'hi', 'reflex', 'user_1');

    expect(memory.retrieveContext).not.toHaveBeenCalled();
    expect(out).toBe('');
  });

  it('deliberate gets a wider window than standard', async () => {
    const svc = makeOrchestrator(memory);
    await svc.buildPerceptionSection('biz_1', 'q', 'standard', 'user_1');
    await svc.buildPerceptionSection('biz_1', 'q', 'deliberate', 'user_1');

    const [std] = memory.retrieveContext.mock.calls[0] as unknown as [string, { limit: number }];
    void std;
    const stdOpts = (memory.retrieveContext.mock.calls[0] as unknown as [string, { limit: number }])[1];
    const delOpts = (memory.retrieveContext.mock.calls[1] as unknown as [string, { limit: number }])[1];

    expect(delOpts.limit).toBeGreaterThan(stdOpts.limit);
  });

  it('is bounded and filtered — never an unbounded scan', async () => {
    await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'q', 'deliberate', 'user_1');

    const opts = (memory.retrieveContext.mock.calls[0] as unknown as [string, Record<string, number>])[1];
    expect(opts.limit).toBeGreaterThan(0);
    // W11-FLOW-PERCEPTION-SCOPE (SEC-W11MC-3, CR-W10CCS-1): the window (12 for deliberate; it was the whole limit, at
    // most 25) plus the shared headroom buildMemoryContext asks for, so leaving out the rows that are not the reader's
    // still fills the window. The headroom is no more than the eight stores can hand back (50 rows each), and the
    // block renders at most the window (pinned in 'the block renders at most its window' below).
    expect(opts.limit).toBe(12 + PROMPT_MEMORY_HEADROOM);
    expect(PROMPT_MEMORY_HEADROOM).toBeGreaterThan(0);
    expect(PROMPT_MEMORY_HEADROOM).toBeLessThanOrEqual(8 * 50);
    expect(opts.minRankScore).toBeGreaterThan(0);
  });

  it('the block renders at most its window: 6 fragments for standard, 12 for deliberate, however many the store answers', async () => {
    memory.fragments = Array.from({ length: 200 }, (_, i) => ({ sourceType: 'genome_memory_event', title: `g${i}`, content: `c${i}` }));
    const lines = (out: string) => out.split('\n').filter((l) => l.startsWith('- ['));
    expect(lines(await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'q', 'standard', 'user_1'))).toHaveLength(6);
    expect(lines(await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'q', 'deliberate', 'user_1'))).toHaveLength(12);
  });

  it('gives up rather than stalling time-to-first-token', async () => {
    // Eight tables are queried in parallel and awaited BEFORE the first token,
    // so one locked table would stall every message. Perception is context:
    // worth a moment, never worth making the chat feel broken.
    memory.retrieveContext = vi.fn(() => new Promise(() => {})) as never;

    const started = Date.now();
    const out = await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'q', 'standard', 'user_1');

    expect(out).toBe('');
    expect(Date.now() - started, 'no deadline — a hung query blocks the answer').toBeLessThan(3000);
  });

  it('applies a quality floor that can actually reject a row', async () => {
    // 0.3 was decorative: rankScore floors at 0.5*0.45 + 0*0.35 + 0.75*0.2 =
    // 0.375, so nothing was ever below the "floor". The value must sit inside
    // the real 0.375–1.0 range or the filter is a comment.
    await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'q', 'standard', 'user_1');

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
    await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'how are we doing', 'standard', 'user_1');

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

  // W11-FLOW-PERCEPTION-SCOPE (review SEC-W11MC-3, D-130): the reader is the caller only while they are a member of
  // the business (buildMemoryContext's rule). A turn with no member (the Chatwoot support desk, the staff bridge) and
  // a caller who is no member (a platform SUPER_ADMIN) read no per-member memory: no personal store at all, rather than
  // every member's rows (an absent userId used to leave AiExecutionLog and CortexActionLog unnarrowed).
  // Review CR-W11FPS-1: but the business-wide stores, business events included (an overdue invoice), are still read:
  // the read names the business-wide stores (sourceTypes) instead of turning off every episodic store.
  // W1F-PERCEPTION-MODULE-SCOPE: the turn with no member is now told apart. A staff position's turn with no holder (a
  // contact-only position on the staff bridge) is the no-reader read below; the support desk's turn (no member, no
  // staff position: D-203) reads nothing at all, and a position's verified holder is its reader (D-202), both pinned in
  // the describe blocks that follow.
  it('a caller who is no member, or a staff position with no holder, reads no member\'s personal memory: no userId, and only the business-wide stores, business events included', async () => {
    for (const [label, userId, server] of [
      ['user_9', 'user_9', undefined],
      ['contact-only position', undefined, holderTurn(null)],
    ] as const) {
      memory.retrieveContext.mockClear();
      await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'q', 'standard', userId, server);
      expectNoReaderRead(memory, label);
    }
  });

  // W1F-PERCEPTION-MODULE-SCOPE (D-202): the staff bridge's turn names no member but passes the position, and with it
  // the position's holder; both chat paths hand it on.
  it('is passed on BOTH chat paths', () => {
    const wired = src.match(/buildPerceptionSection\(businessId, message, triage\?\.tier, userId, server\)/g) ?? [];
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

describe("only the reader's own cognition memory, and no KEY tool-call record (W11-FLOW-PERCEPTION-SCOPE, SEC-W11MC-3)", () => {
  // CognitionMemory is per member (what a member typed and KEY's whole answer to them) but the retrieval reads it
  // business-wide; the business-wide event stores carry every KEY tool call's input and answer. buildMemoryContext keeps
  // neither (readersOwnCognitionMemory, isToolCallRecord); this block now keeps neither either, through the same helper.
  let memory: MemoryStub;

  beforeEach(() => {
    memory = new MemoryStub();
    memory.fragments = [
      { id: 'cog_other', sourceType: 'cognition_memory', title: 'Memory fragment', content: 'Query: OTHER-MEMBER typed' },
      { id: 'cog_nobody', sourceType: 'cognition_memory', title: 'Memory fragment', content: 'Query: NOBODY typed' },
      { id: 'be_tool', sourceType: 'business_event', title: 'ACTION_EXECUTED', entityType: 'tool_execution', content: 'TOOL-ANSWER' },
      { id: 'ce_tool', sourceType: 'cognitive_event', title: 'tool.executed', content: 'tool.executed: TOOL-INPUT' },
      { id: 'cog_own', sourceType: 'cognition_memory', title: 'Memory fragment', content: 'Query: OWN typed' },
      { id: 'be_invoice', sourceType: 'business_event', title: 'invoice.overdue', entityType: 'invoice', content: 'INV-014 overdue' },
      // W1F-PERCEPTION-MODULE-SCOPE: a business-wide record that names no module (kept for every reader).
      { id: 'be_proposal', sourceType: 'business_event', title: 'GOVERNANCE_DECISION', entityType: 'key_action_proposal', content: 'ai propose key_action_proposal: PROPOSAL-PENDING' },
    ];
  });

  it("keeps a cognition fragment only when it is the reader's own: another member's row and a member-less row are left out", async () => {
    const out = await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'q', 'standard', 'user_1');
    expect(out).toContain('OWN typed');
    expect(out).not.toContain('OTHER-MEMBER');
    expect(out).not.toContain('NOBODY');
  });

  it('leaves out the business-wide records of KEY tool calls (isToolCallRecord), and keeps the business events that are not one', async () => {
    const out = await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'q', 'standard', 'user_1');
    expect(out).not.toContain('TOOL-ANSWER');
    expect(out).not.toContain('TOOL-INPUT');
    expect(out).toContain('INV-014 overdue');
  });

  // W1F-PERCEPTION-MODULE-SCOPE (SEC-W11FPS-3, D-57): a reader with no membership has no module scope, so the overdue
  // invoice (money, at revenue read) no longer reaches them; the business-wide proposal still does. The support desk's
  // turn (no member, no position) perceives nothing at all (D-203).
  it('a caller who is no member, or a staff position with no holder, gets no cognition fragment at all, and no money event; a business-wide record still reaches them', async () => {
    for (const [label, userId, server] of [
      ['user_9', 'user_9', undefined],
      ['contact-only position', undefined, holderTurn(null)],
    ] as const) {
      const out = await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'q', 'standard', userId, server);
      expect(out, label).not.toContain('[cognition_memory]');
      expect(out, label).not.toContain('INV-014 overdue');
      expect(out, label).toContain('PROPOSAL-PENDING');
    }
  });

  it('a membership check that cannot be made reads as no member (fail closed), and never fails the request', async () => {
    prismaStub.client.business.findFirst.mockRejectedValueOnce(new Error('connection reset'));
    const out = await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'q', 'standard', 'user_1');
    expect(out).not.toContain('[cognition_memory]');
    expectNoReaderRead(memory, 'check failed');
    // W1F-PERCEPTION-MODULE-SCOPE: no reader, so no module scope: the money event is left out too.
    expect(out).not.toContain('INV-014 overdue');
    expect(out).toContain('PROPOSAL-PENDING');
  });
});

describe("module scopes (W1F-PERCEPTION-MODULE-SCOPE, review SEC-W11FPS-3; D-71/D-146, D-57)", () => {
  // The business-wide event stores carry every domain event the bridge forwards, figures included. A reader sees an
  // event only with read on the module it names, by their membership (ModuleScopeGuard's reading). The full rule is
  // pinned in key-cortex-prompt-module-scope.spec.ts; this pins it on the block itself.
  let memory: MemoryStub;

  beforeEach(() => {
    memory = new MemoryStub();
    memory.fragments = [
      { id: 'be_expense', sourceType: 'business_event', title: 'expense.created', entityType: 'Expense', content: 'expenses PUBLISHED Expense: EXPENSE-7777' },
      { id: 'ce_payment', sourceType: 'cognitive_event', title: 'payment.received', content: 'payment.received: PAYMENT-4321' },
      { id: 'be_contact', sourceType: 'business_event', title: 'contact.created', entityType: 'Contact', content: 'crm PUBLISHED Contact: CONTACT-ADA' },
      { id: 'be_proposal', sourceType: 'business_event', title: 'GOVERNANCE_DECISION', entityType: 'key_action_proposal', content: 'PROPOSAL-PENDING' },
    ];
  });

  it("a member whose expenses and revenue scopes are none perceives no money event, and the events of the modules they read; another member on role defaults perceives them", async () => {
    prismaStub.client.membership.findUnique.mockResolvedValueOnce({ role: 'STAFF', permissionScopes: { crm: 'read', expenses: 'none', revenue: 'none' } } as any);
    const blind = await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'q', 'standard', 'user_1');
    expect(blind).not.toContain('EXPENSE-7777');
    expect(blind).not.toContain('PAYMENT-4321');
    expect(blind).toContain('CONTACT-ADA');
    expect(blind).toContain('PROPOSAL-PENDING');

    const staff = await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'q', 'standard', 'user_2');
    for (const marker of ['EXPENSE-7777', 'PAYMENT-4321', 'CONTACT-ADA', 'PROPOSAL-PENDING']) expect(staff, marker).toContain(marker);
  });
});

describe("the customer support desk perceives only the conversation in front of it (W1F-PERCEPTION-MODULE-SCOPE, owner ruling D-203 `supportdesk`)", () => {
  it('a turn that names no member and no staff position (chatwoot.service.ts calls chat() so) reads no memory store and renders no block', async () => {
    const memory = new MemoryStub();
    memory.fragments = [
      { id: 'mem', sourceType: 'ai_memory', title: 'fact', content: 'FACT-NINE' },
      { id: 'be_proposal', sourceType: 'business_event', title: 'GOVERNANCE_DECISION', entityType: 'key_action_proposal', content: 'PROPOSAL-PENDING' },
      { id: 'be_invoice', sourceType: 'business_event', title: 'invoice.overdue', entityType: 'invoice', content: 'INV-014 overdue' },
    ];
    for (const tier of ['standard', 'deliberate']) {
      memory.retrieveContext.mockClear();
      const out = await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'q', tier, undefined, undefined);
      expect(out, tier).toBe('');
      expect(memory.retrieveContext, tier).not.toHaveBeenCalled();
    }
  });
});

describe("a staff member on the WhatsApp/SMS bridge perceives their own history (W1F-PERCEPTION-MODULE-SCOPE, owner ruling D-202 `bridgememory`)", () => {
  let memory: MemoryStub;

  beforeEach(() => {
    memory = new MemoryStub();
    memory.fragments = [
      { id: 'cog_own', sourceType: 'cognition_memory', title: 'Memory fragment', content: 'Query: OWN typed' },
      { id: 'cog_other', sourceType: 'cognition_memory', title: 'Memory fragment', content: 'Query: OTHER-MEMBER typed' },
      { id: 'exec_own', sourceType: 'ai_execution_log', title: 'own.exec', content: 'OWN-EXEC' },
    ];
  });

  it("the position's verified holder (FlowServerContext.positionHolderUserId, on an envelope JobRolePolicyService issued) is the reader: their own personal rows and cognition, no one else's", async () => {
    const out = await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'q', 'standard', undefined, holderTurn('user_1'));
    const opts = (memory.retrieveContext.mock.calls[0] as unknown as [string, { userId?: string; sourceTypes?: string[] }])[1];
    expect(opts.userId).toBe('user_1');
    expect(opts.sourceTypes).toBeUndefined();
    expect(out).toContain('OWN typed');
    expect(out).toContain('OWN-EXEC');
    expect(out).not.toContain('OTHER-MEMBER');
  });

  it('a holder on an envelope the policy did not issue, or a holder who is no member of the business, is nobody\'s reader (fail closed)', async () => {
    for (const [label, server] of [
      ['copied envelope', holderTurn('user_1', { ...ISSUED_ENVELOPE })],
      ['holder no member', holderTurn('user_9')],
    ] as const) {
      memory.retrieveContext.mockClear();
      const out = await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'q', 'standard', undefined, server);
      expectNoReaderRead(memory, label);
      expect(out, label).not.toContain('OWN typed');
    }
  });

  it('a member in the app stays the reader even when a position is named beside them (the member, never the holder)', async () => {
    await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'q', 'standard', 'user_2', holderTurn('user_1'));
    const opts = (memory.retrieveContext.mock.calls[0] as unknown as [string, { userId?: string }])[1];
    expect(opts.userId).toBe('user_2');
  });

  // Review SEC-W1FPMS-2: the holder is the reader only when the policy's perception names them (the message came from the
  // holder's own phone and no other member's). A position held by one member on another person's phone, or on a phone
  // that is no member's account phone, reads nobody's history: whoever texts from that phone is not shown to be the
  // holder.
  it("the holder named beside the envelope is nobody's reader when the policy's perception names no reader (the phone is not the holder's own)", async () => {
    for (const [label, server] of [
      ['phone of another member', positionTurn('user_1', { readerUserId: null, modules: [] })],
      ['no perception resolved for the envelope', positionTurn('user_1', null)],
    ] as const) {
      memory.retrieveContext.mockClear();
      const out = await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'q', 'standard', undefined, server);
      expectNoReaderRead(memory, label);
      expect(out, label).not.toContain('OWN typed');
      expect(out, label).not.toContain('OWN-EXEC');
    }
  });

  it('the reader the policy names is the reader even when another member is named as the holder (the perception decides)', async () => {
    await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'q', 'standard', undefined, positionTurn('user_2', { readerUserId: 'user_1', modules: STAFF_MODULES }));
    const opts = (memory.retrieveContext.mock.calls[0] as unknown as [string, { userId?: string }])[1];
    expect(opts.userId).toBe('user_1');
  });
});

describe("a staff position's turn sees the modules the policy resolved for the position (review SEC-W1FPMS-2, COR-W1FPMS-2; D-202, D-73/D-93)", () => {
  let memory: MemoryStub;

  beforeEach(() => {
    memory = new MemoryStub();
    memory.fragments = [
      { id: 'be_booking', sourceType: 'business_event', title: 'booking.created', entityType: 'Booking', content: 'bookings PUBLISHED Booking: BOOKING-0900' },
      { id: 'ce_project', sourceType: 'cognitive_event', title: 'project.created', content: 'project.created: PROJECT-ROOF' },
      { id: 'be_expense', sourceType: 'business_event', title: 'expense.created', entityType: 'Expense', content: 'expenses PUBLISHED Expense: EXPENSE-7777' },
      { id: 'be_contact', sourceType: 'business_event', title: 'contact.created', entityType: 'Contact', content: 'crm PUBLISHED Contact: CONTACT-ADA' },
      { id: 'be_proposal', sourceType: 'business_event', title: 'GOVERNANCE_DECISION', entityType: 'key_action_proposal', content: 'PROPOSAL-PENDING' },
    ];
  });

  it('a contact-only position (no reader) sees the modules its JobRole map grants, as its tools do: a booking and a project, not money and not contacts', async () => {
    const out = await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'q', 'standard', undefined, positionTurn(null, { readerUserId: null, modules: ['bookings', 'projects', 'operations'] }));
    expectNoReaderRead(memory, 'contact-only');
    expect(out).toContain('BOOKING-0900');
    expect(out).toContain('PROJECT-ROOF');
    expect(out).toContain('PROPOSAL-PENDING');
    expect(out).not.toContain('EXPENSE-7777');
    expect(out).not.toContain('CONTACT-ADA');
  });

  it("the holder-reader's turn sees the position's modules (the JobRole map capped by the phone members' scopes), not their membership's whole sight", async () => {
    // user_1 is STAFF on role defaults (reads expenses); the position grants bookings and crm only.
    const out = await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'q', 'standard', undefined, positionTurn('user_1', { readerUserId: 'user_1', modules: ['bookings', 'crm'] }));
    const opts = (memory.retrieveContext.mock.calls[0] as unknown as [string, { userId?: string }])[1];
    expect(opts.userId).toBe('user_1');
    expect(out).toContain('BOOKING-0900');
    expect(out).toContain('CONTACT-ADA');
    expect(out).not.toContain('EXPENSE-7777');
    expect(out).not.toContain('PROJECT-ROOF');
  });

  it('a reader the policy names who is no member of the business (removed since) reads nothing personal and sees no module (fail closed)', async () => {
    const out = await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'q', 'standard', undefined, positionTurn('user_9', { readerUserId: 'user_9', modules: STAFF_MODULES }));
    expectNoReaderRead(memory, 'removed holder');
    for (const marker of ['BOOKING-0900', 'PROJECT-ROOF', 'EXPENSE-7777', 'CONTACT-ADA']) expect(out, marker).not.toContain(marker);
    expect(out).toContain('PROPOSAL-PENDING');
  });
});

describe("no business-wide record of one person's KEY turn or KEY action, for any reader (W11-FLOW-PERCEPTION-SCOPE review SEC-W11FPS-1, SEC-W11FPS-2)", () => {
  // The bus persists every KEY event to business_events and cognitive_events, both read business-wide. KEY's own turn
  // records carry what a member typed (cortex.turn_started rawInput) and KEY's whole answer (cortex.turn_completed
  // responseText); KeyCortexActionsService's action.<status> carries the tool's answer; the ledger's ACTION_* rows carry
  // it too, also as the copies EventEmitterFlowBridgeService republishes (subject 'Tool_execution') and the approval
  // orchestrator's execution row (subject key_action_proposal, its executionResult).
  let memory: MemoryStub;
  const MARKERS = [
    'TURN-TYPED', 'TURN-ANSWER', 'TURN-FAILED', 'SESSION-PERSONA', 'STATUS-CHANGE', 'ACTION-ANSWER', 'ACTION-ERROR-ANSWER',
    'BRIDGED-LEDGER-ANSWER', 'BRIDGED-COGNITIVE-ANSWER', 'PROPOSAL-EXECUTION-RESULT',
  ];

  beforeEach(() => {
    memory = new MemoryStub();
    memory.fragments = [
      { id: 'ce_turn', sourceType: 'cognitive_event', title: 'cortex.turn_started', content: 'cortex.turn_started: {"rawInput":"TURN-TYPED"}' },
      { id: 'be_turn', sourceType: 'business_event', title: 'cortex.turn_completed', entityType: 'KeyCommand', content: 'key_cortex PUBLISHED KeyCommand: {"responseText":"TURN-ANSWER"}' },
      { id: 'ce_turn_failed', sourceType: 'cognitive_event', title: 'cortex.turn_failed', content: 'cortex.turn_failed: {"error":"TURN-FAILED"}' },
      { id: 'be_session', sourceType: 'business_event', title: 'cortex.session_started', entityType: 'CortexSession', content: 'key_cortex PUBLISHED CortexSession: SESSION-PERSONA' },
      { id: 'ce_status', sourceType: 'cognitive_event', title: 'cortex.command_status_changed', content: 'STATUS-CHANGE' },
      { id: 'ce_action', sourceType: 'cognitive_event', title: 'action.success', content: 'action.success: {"result":"ACTION-ANSWER"}' },
      { id: 'be_action', sourceType: 'business_event', title: 'action.error', entityType: 'KEY_CORTEX_EVENT', content: 'key_cortex PUBLISHED KEY_CORTEX_EVENT: ACTION-ERROR-ANSWER' },
      { id: 'be_bridged', sourceType: 'business_event', title: 'ACTION_EXECUTED', entityType: 'Tool_execution', content: 'ai PUBLISHED Tool_execution: BRIDGED-LEDGER-ANSWER' },
      { id: 'ce_bridged', sourceType: 'cognitive_event', title: 'ACTION_EXECUTED', content: 'ACTION_EXECUTED: BRIDGED-COGNITIVE-ANSWER' },
      { id: 'be_proposal', sourceType: 'business_event', title: 'ACTION_EXECUTED', entityType: 'key_action_proposal', content: 'ai execute key_action_proposal: PROPOSAL-EXECUTION-RESULT' },
      { id: 'be_insight', sourceType: 'business_event', title: 'insight.generated', entityType: 'KEY_CORTEX_EVENT', content: 'key_cortex PUBLISHED KEY_CORTEX_EVENT: CASHFLOW-DIP' },
      { id: 'be_invoice', sourceType: 'business_event', title: 'invoice.overdue', entityType: 'invoice', content: 'INV-014 overdue' },
      { id: 'be_governance', sourceType: 'business_event', title: 'GOVERNANCE_DECISION', entityType: 'key_action_proposal', content: 'ai propose key_action_proposal: PROPOSAL-PENDING' },
    ];
  });

  // W1F-PERCEPTION-MODULE-SCOPE: the overdue invoice is money (revenue read), so it stays for the members (STAFF on role
  // defaults) and not for a caller who is no member (no module scope, SEC-W11FPS-3); the support desk's turn (no member,
  // no position) perceives nothing at all (D-203).
  it('leaves them out for a member, the owner, a caller who is no member and a turn with no member; the business events that are not one stay', async () => {
    for (const userId of ['user_1', 'user_2', 'user_9', undefined]) {
      const out = await makeOrchestrator(memory).buildPerceptionSection('biz_1', 'q', 'deliberate', userId);
      for (const marker of MARKERS) expect(out, `${String(userId)}: ${marker}`).not.toContain(marker);
      if (userId === undefined) {
        expect(out, 'the support desk').toBe('');
        continue;
      }
      if (userId === 'user_9') expect(out, String(userId)).not.toContain('INV-014 overdue');
      else expect(out, String(userId)).toContain('INV-014 overdue');
      // Review SEC-W1FPMS-1: a record that names no module (insight.generated) needs read on every module, which no
      // STAFF member on role defaults (team none) and no caller who is no member holds; the business-wide proposal stays.
      expect(out, String(userId)).not.toContain('CASHFLOW-DIP');
      expect(out, String(userId)).toContain('PROPOSAL-PENDING');
    }
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

  // W11-FLOW-PERCEPTION-SCOPE review CR-W11FPS-2: what MemoryStub mirrors. includeEpisodic false skips the business
  // events query, and sourceTypes drops what it does not name before the limit is cut (so naming the stores costs no
  // fragment of the window). That a read naming its stores does not query the personal ones it leaves out is pinned at
  // runtime in unified-memory-retrieval.service.spec.ts.
  it('includeEpisodic false reads no business event; sourceTypes filters before the limit', () => {
    const fn = unified.slice(unified.indexOf('private async loadStructuredMemory('));
    const body = fn.slice(0, fn.indexOf('\n  private '));
    expect(body).toMatch(/includeEpisodic\s*\?\s*this\.prisma\.client\.businessEvent\.findMany/);
    const filterAt = unified.indexOf('options.sourceTypes && !options.sourceTypes.includes(f.sourceType)');
    expect(filterAt).toBeGreaterThan(0);
    expect(unified.indexOf('filtered.slice(0, limit)')).toBeGreaterThan(filterAt);
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
