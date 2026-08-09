/**
 * `(this.x as any).method()` must call a method that exists.
 *
 * `as any` turns off the one check that would have caught this. The compiler
 * stops asking whether `method` is on `x`, so a plausible-looking name compiles
 * forever and fails only when the line is reached — inside a try/catch, in a
 * background pass, at three in the morning.
 *
 * KeyCortexContextV2Service is the reason this exists, and is now FIXED — the
 * tense matters, because a gate whose header describes a repaired defect as
 * present is the same lie it was built to catch.
 *
 * What it was: all eight of its context getters called methods that did not
 * exist on the services they were cast from. TemporalFlowMemoryService never
 * had getRecentMemories (that is TemporalAdapterService) or getDetectedPatterns
 * (that is nothing); KeyInboxIntelligenceService is a reporting service and
 * never had any of the six inbox methods. Every one threw, hourly, in
 * production. The rejections were absorbed and KEY reasoned from an empty
 * context that was then cached to Redis, so the emptiness outlived the failure.
 *
 * The repair was not method-by-method. Deleting the 47 casts first and letting
 * tsc enumerate the wreckage turned "find the bugs" into a printed list of 32,
 * each naming its model and field — 10 wrong Contact columns, 4 impossible
 * relations, 6 enum casings. That is the technique this gate exists to make
 * available: a cast is what stops the compiler doing that work for you.
 *
 * THE NEAR-MISS NAMES ARE THE TELL
 * --------------------------------
 *   getEventLog()  called; KeyCortexEventService has getEvents()
 *   shouldAct()    called; KeyProactiveEngineService has evaluateProactiveActions()
 *
 * Nobody invented these at random. They are what the method OUGHT to be called,
 * written by someone who did not check, in a place the compiler had been told
 * to stop looking.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * It does not ban `as any`. Most of the 55 casts in the context service alone
 * are property reads on loosely-typed payloads, which is a different argument.
 * It checks one thing: if you cast a field to `any` and CALL a method on it,
 * that method has to exist on the type the field was declared with. A cast is
 * for silencing a type you know better than the compiler — not for calling into
 * the void.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';

const SRC = join(__dirname, '..', '..');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.name.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(e.name) ? [p] : [];
  });
}

export interface CastCall {
  file: string;
  line: number;
  field: string;
  declaredType: string;
  method: string;
}

/**
 * Every `(this.x as any).m()` where `m` is not declared on `x`'s type.
 *
 * Deliberately conservative — a call is only reported when the field's declared
 * type is a class defined IN THIS REPO and its method list could be read. An
 * imported library type, an interface, or a field whose declaration cannot be
 * found is skipped rather than guessed at. A false accusation here sends
 * someone to "fix" working code, which is how a gate gets switched off.
 */
export function findBrokenCastCalls(): CastCall[] {
  const files = walk(SRC);

  const methodsOf = new Map<string, Set<string>>();
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/export class (\w+)/g)) {
      const body = s.slice(m.index! + m[0].length).split('\nexport class ')[0];
      const names = new Set(
        [...body.matchAll(/^\s{2,}(?:public |private |protected )?(?:async )?(\w+)\s*\(/gm)].map(
          (x) => x[1],
        ),
      );
      // Arrow-function properties are methods too: `handle = async () => {}`.
      for (const a of body.matchAll(/^\s{2,}(?:public |private |protected )?(?:readonly )?(\w+)\s*=\s*(?:async\s*)?\(/gm)) {
        names.add(a[1]);
      }
      methodsOf.set(m[1], names);
    }
  }

  const found: CastCall[] = [];
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    const declared = new Map<string, string>();
    for (const d of s.matchAll(/(?:private|public|protected)\s+(?:readonly\s+)?(\w+)\??\s*:\s*(\w+)/g)) {
      declared.set(d[1], d[2]);
    }
    for (const c of s.matchAll(/\(this\.(\w+)\s+as\s+any\)\.(\w+)\(/g)) {
      const type = declared.get(c[1]);
      if (!type) continue;                       // cannot resolve — do not guess
      const known = methodsOf.get(type);
      if (!known) continue;                      // not a class in this repo
      if (known.has(c[2])) continue;
      found.push({
        file: f.slice(SRC.length + 1).split(sep).join('/'),
        line: s.slice(0, c.index).split('\n').length,
        field: c[1],
        declaredType: type,
        method: c[2],
      });
    }
  }
  return found;
}

/**
 * The thirteen that exist today, as `file:line field.method`.
 *
 * Eight are KeyCortexContextV2Service's context getters. The other five are the
 * same shape in five other files, and two of them are near-miss names for
 * methods that do exist under another spelling.
 *
 * This list may only SHRINK. Every entry is a call that throws when reached.
 */
const KNOWN_BROKEN = [
  // NOT A CRASH — a capability probe. The call site tests
  // `typeof (this.replySender as any).markAsDraft === 'function'` first, so it
  // never throws; the method has never existed, the probe is always false, and
  // it falls through to the documented soft-delete fallback. Listed anyway
  // because the "prefer" branch is unreachable code describing a feature that
  // was never built, and that is worth knowing. Distinguishing it matters: the
  // other twelve throw when reached, this one does not.
  'modules/key-cortex/key-cortex-compensation.service.ts replySender.markAsDraft',
  // FIXED — all eight context-v2 entries are gone. TemporalFlowMemoryService
  // never had getRecentMemories or getDetectedPatterns (the first belongs to
  // TemporalAdapterService, the second to nothing), and KeyInboxIntelligence is
  // a reporting service that never had any of the six inbox methods. Both
  // getters now query TemporalFlowMemory and KeyInboxThread/Message directly and
  // typecheck with no cast at all, which is the proof the shapes are real.
  //
  // They were not silent: all eight threw hourly in production, and
  // Promise.allSettled in getFullContext swallowed every rejection, so KEY
  // reasoned with an empty context and cached it to Redis.
  // FIXED — both getEventLog calls now use getEventChain(correlationId), and
  // typecheck without a cast, which is the proof the method and the shapes are
  // real. Removed from this list rather than left as decoration.
  //
  // THE TWO BELOW ARE NOT RENAMES, AND ARE DELIBERATELY NOT GUESSED AT.
  //
  //   proactive.shouldAct(businessId) -> {shouldAct, suggestions}
  //     KeyProactiveEngineService has evaluateProactiveActions(), which takes NO
  //     arguments and returns triggers for EVERY business. Adapting it would
  //     mean evaluating the whole estate on every chat turn to answer a question
  //     about one business. The per-business method was never written.
  //
  //   insight.generateInsights(businessId, query, modules)
  //     KeyCortexInsightService has analyzeRevenue, analyzeCashFlow,
  //     analyzePipeline, generateRecommendations, generateBusinessReport — no
  //     query-and-modules entry point. This one is reached from an HTTP
  //     controller, so the endpoint has always thrown into its own try.
  //
  // Both are "the API was never built", not "the name is wrong". Building them
  // is a product decision and inventing a plausible adaptation here would be
  // the same mistake that produced the original casts.
  'modules/key-cortex/key-cortex-query-pipeline.service.ts proactive.shouldAct',
  'modules/key-cortex/key-cortex.controller.ts insight.generateInsights',
];

const key = (c: CastCall) => `${c.file} ${c.field}.${c.method}`;

describe('a cast may silence a type, not invent a method', () => {
  const broken = findBrokenCastCalls();

  it('adds no new call to a method that does not exist', () => {
    const fresh = broken.filter((c) => !KNOWN_BROKEN.includes(key(c)));

    expect(
      fresh.map((c) => `${c.file}:${c.line} (${c.declaredType}).${c.method}()`),
      'This throws the moment it runs. `as any` stopped the compiler checking, ' +
        'so nothing else will tell you — and if the call site catches, it will ' +
        'never tell you at all. Call the method that exists, or inject the class ' +
        'that has it.',
    ).toEqual([]);
  });

  it('the known list does not outlive the defects', () => {
    // A fixed entry left here is a lie about the codebase, and the next reader
    // takes the list as current.
    const fixed = KNOWN_BROKEN.filter((k) => !broken.some((c) => key(c) === k));

    expect(fixed, 'these are fixed — remove them from KNOWN_BROKEN').toEqual([]);
  });

  it('the detector still resolves types, rather than passing by finding nothing', () => {
    // If the field-declaration or class-method regexes stop matching, every
    // call resolves to "cannot tell" and both assertions above go green on an
    // empty set. That is the shape of failure this whole exercise is about, so
    // the detector asserts it can still see the thing it was built to see.
    expect(
      broken.length,
      'the scanner found NOTHING at all — it has probably stopped parsing rather ' +
        'than the codebase having been fixed. Check findBrokenCastCalls().',
    ).toBeGreaterThan(0);
  });
});
