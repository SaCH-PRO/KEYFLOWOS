/**
 * The CNS surface — proving the nine organs are actually reachable.
 *
 * Before this, `processConsciously` (labelled "THE method" in its own doc
 * comment) had NO caller anywhere in the repository. The organs were registered
 * providers and injectable, but nothing drove them: registered != reachable.
 *
 * It also would have thrown if reached. KeyCortexTemporalReasoningService
 * .getTemporalContext returns a preformatted STRING, while the call site asserts
 * it to TemporalAnalysis; filterRelevantTemporal then read `.anomalies` off it.
 * Wiring a route to that would have converted silent-dead into silent-fallback,
 * which is worse — it looks like it works.
 *
 * These pin both: the route exists and calls the orchestrator, and the temporal
 * shape mismatch degrades instead of crashing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const controller = readFileSync(join(__dirname, 'key-cortex.controller.ts'), 'utf8');
const consciousness = readFileSync(
  join(__dirname, 'key-cortex-consciousness.service.ts'),
  'utf8',
);

describe('conscious chat route', () => {
  it('exists', () => {
    expect(controller).toMatch(/@Post\('conscious\/chat'\)/);
  });

  it('actually calls the orchestrator — the organs are driven by something', () => {
    expect(controller).toMatch(/this\.consciousness\.processConsciously\(/);
  });

  it('injects the orchestrator and the session service', () => {
    expect(controller).toMatch(/private readonly consciousness: KeyCortexConsciousnessService/);
    expect(controller).toMatch(/private readonly sessionService: KeyCortexSessionService/);
  });

  it('injects them at the END of the constructor', () => {
    // Positional construction elsewhere depends on existing argument order;
    // inserting mid-list previously broke 8 tests across 3 files.
    const ctor = controller.slice(controller.indexOf('  constructor('));
    const body = ctor.slice(0, ctor.indexOf('\n  ) {'));
    const params = body.split('\n').filter((l) => /private readonly \w+:/.test(l));
    const lastTwo = params.slice(-2).join(' ');
    expect(lastTwo).toContain('consciousness');
    expect(lastTwo).toContain('sessionService');
  });

  it('has a DECORATED dto — an undecorated one is stripped to {} by the global pipe', () => {
    const dto = controller.slice(controller.indexOf('class ConsciousChatDto'));
    const block = dto.slice(0, dto.indexOf('\n}'));
    expect(block).toMatch(/@IsString\(\)/);
    // every declared field needs metadata or whitelist:true deletes it
    const fields = (block.match(/^\s+\w+\??: /gm) ?? []).length;
    const decorators = (block.match(/@Is\w+\(|@Allow\(/g) ?? []).length;
    expect(decorators).toBeGreaterThanOrEqual(fields);
  });

  it('surfaces the per-layer thinking phases, not just the answer', () => {
    expect(controller).toMatch(/phases:/);
    expect(controller).toMatch(/reasoningMode:/);
    expect(controller).toMatch(/confidence:/);
    expect(controller).toMatch(/permitted:/);
  });
});

describe('conscious stream route', () => {
  // Bound the slice by the method's own closing return. Searching for a
  // two-space-indented `}` instead would stop at the brace that closes the
  // inline `Observable<{...}>` return type, before the body even starts.
  const route = controller.slice(controller.indexOf("@Sse('conscious/stream')"));
  const streamBody = route.slice(0, route.indexOf('return subject.asObservable();'));

  it('exists as SSE', () => {
    expect(controller).toMatch(/@Sse\('conscious\/stream'\)/);
  });

  it('takes its parameters from the QUERY, never the body', () => {
    // @Sse registers RequestMethod.GET (see @nestjs/common sse.decorator.js).
    // EventSource cannot send a body on a GET, so a @Body()-taking SSE route is
    // uncallable from any standard client.
    const route = controller.slice(controller.indexOf("@Sse('conscious/stream')"));
    const signature = route.slice(0, route.indexOf('{'));
    expect(signature).toMatch(/@Query\(\)/);
    expect(signature).not.toMatch(/@Body\(\)/);
  });

  it('passes a phase listener into the pipeline', () => {
    // Without the third argument the route would emit nothing until the end,
    // which is the behaviour it exists to avoid.
    expect(streamBody).toMatch(/processConsciously\([\s\S]*?\(phase\) =>/);
  });

  it('emits phase then answer, and completes on error rather than hanging', () => {
    const body = streamBody;
    expect(body).toMatch(/type: 'phase'/);
    expect(body).toMatch(/type: 'answer'/);
    expect(body).toMatch(/type: 'error'/);
    // An SSE stream that errors without completing leaves the client hanging.
    expect(body.match(/subject\.complete\(\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe('phase emission', () => {
  it('emits one phase per cognitive step', () => {
    const emits = consciousness.match(/^\s+emit\(/gm) ?? [];
    expect(emits.length).toBe(10);
  });

  it('declares the same total it emits', () => {
    expect(consciousness).toMatch(/TOTAL_CONSCIOUS_PHASES = 10/);
  });

  it('a listener that throws does not kill the pipeline', () => {
    // An SSE client disconnecting mid-think must not abort the cognition and
    // lose the response. Emission is observation, not control flow.
    const start = consciousness.indexOf('const emit = (');
    const emitFn = consciousness.slice(start, consciousness.indexOf('\n    };', start));
    expect(emitFn).toMatch(/try \{/);
    expect(emitFn).toMatch(/\} catch \{/);
    expect(emitFn).toMatch(/onPhase\(\{/);
  });

  it('reports measured durations, not estimates', () => {
    // Every emit passes a timing.*Ms value computed from Date.now() deltas.
    const emitCalls = consciousness.match(/emit\(\s*'[a-zA-Z]+',\s*'[^']+',\s*([^,]+),/g) ?? [];
    expect(emitCalls.length).toBeGreaterThanOrEqual(9);
    for (const call of emitCalls) {
      expect(call).toMatch(/timing\.\w+Ms/);
    }
  });
});

describe('temporal shape mismatch', () => {
  it('filterRelevantTemporal accepts the string form instead of crashing', () => {
    // getTemporalContext returns a string; the call site asserts TemporalAnalysis.
    expect(consciousness).toMatch(/typeof temporal === 'string'/);
  });

  it('guards the array reads that would otherwise throw', () => {
    expect(consciousness).toMatch(/Array\.isArray\(temporal\.anomalies\)/);
    expect(consciousness).toMatch(/Array\.isArray\(temporal\.cycles\)/);
  });

  it('the guard precedes every unguarded read', () => {
    const guardAt = consciousness.indexOf("typeof temporal === 'string'");
    const firstRead = consciousness.indexOf('temporal.anomalies.filter');
    expect(guardAt).toBeGreaterThan(-1);
    expect(firstRead).toBeGreaterThan(guardAt);
  });
});

describe('the nine organs', () => {
  const ORGANS = [
    'Emotion',
    'Ethics',
    'ReasoningEngine',
    'TemporalReasoning',
    'Creativity',
    'Reflection',
    'Intuition',
    'Metacognition',
    'Consciousness',
  ];

  it('are all registered in the module', () => {
    const mod = readFileSync(join(__dirname, 'key-cortex.module.ts'), 'utf8');
    const missing = ORGANS.filter((o) => !mod.includes(`KeyCortex${o}Service`));
    expect(missing).toEqual([]);
  });

  it('are all composed by the orchestrator', () => {
    // Each organ must be injected into the consciousness service, otherwise it
    // is a registered provider nothing consumes.
    const missing = ORGANS.filter(
      (o) => o !== 'Consciousness' && !consciousness.includes(`KeyCortex${o}Service`),
    );
    expect(missing).toEqual([]);
  });
});
