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
      (b: string, q: string, t?: string) => Promise<string>
    >
  ).buildPerceptionSection;

  const instance = {
    moduleRef: { get: () => memory },
    logger: { warn: vi.fn() },
    getUnifiedMemory: () => memory,
  };

  return {
    buildPerceptionSection: (b: string, q: string, t?: string) => impl.call(instance, b, q, t),
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
    expect(src).toMatch(/buildPerceptionSection\(businessId, message, triage\?\.tier\)/);
  });

  it('skips retrieval on reflex inside the method itself', () => {
    expect(methodSource('buildPerceptionSection')).toMatch(/tier === 'reflex'/);
  });
});
