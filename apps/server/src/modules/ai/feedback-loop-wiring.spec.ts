/**
 * The plan-execution feedback loop had to be given something to react to.
 *
 * FeedbackLoopService is 223 lines that decide whether to continue, skip or
 * replan after a step, and record learned corrections into memory. It was
 * registered in ai.module.ts (providers AND exports) and injected by NOTHING.
 * DispatchContext already carried planId and planStepId — exactly the shape
 * FeedbackContext wants — so the design was finished and the wiring simply
 * never happened.
 *
 * What these tests protect is the cost and safety envelope, because a feedback
 * hook in the execution path is easy to make expensive or fragile:
 *
 *   - it runs only for dispatches that belong to a plan
 *   - it cannot fail the dispatch that already succeeded
 *   - it is optional, so a module without it can still execute tools
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dispatcher = readFileSync(join(__dirname, 'action-dispatcher.service.ts'), 'utf8');
const loop = readFileSync(join(__dirname, 'feedback-loop.service.ts'), 'utf8');
const aiModule = readFileSync(join(__dirname, 'ai.module.ts'), 'utf8');

describe('feedback loop wiring', () => {
  it('the dispatcher can reach the feedback loop', () => {
    expect(dispatcher).toMatch(/FeedbackLoopService/);
  });

  it('runs on BOTH outcomes — success and final failure', () => {
    // A loop that only sees successes cannot learn from failures, which is the
    // case it exists for.
    const calls = dispatcher.match(/await this\.runFeedback\(/g) ?? [];
    expect(calls.length).toBe(2);
    expect(dispatcher).toMatch(/runFeedback\(ctx, result, true\)/);
    expect(dispatcher).toMatch(/runFeedback\(ctx, undefined, false, lastError\)/);
  });

  it('only engages for dispatches that belong to a plan', () => {
    // A one-off tool call has no plan to adapt; analyze() would have nothing
    // to act on and applyFeedbackToPlan would look up a null plan.
    const fn = dispatcher.slice(dispatcher.indexOf('private async runFeedback('));
    const body = fn.slice(0, fn.indexOf('\n  }'));
    expect(body).toMatch(/!ctx\.planId \|\| !ctx\.planStepId/);
  });

  it('cannot fail a dispatch that already ran', () => {
    // The tool has executed and its result must be returned regardless.
    const fn = dispatcher.slice(dispatcher.indexOf('private async runFeedback('));
    const body = fn.slice(0, fn.indexOf('\n  }'));
    expect(body).toMatch(/try \{/);
    expect(body).toMatch(/catch \(error: unknown\)/);
  });

  it('is optional, so a module without it can still execute tools', () => {
    expect(dispatcher).toMatch(/@Optional\(\)/);
    expect(dispatcher).toMatch(/private readonly feedbackLoop\?: FeedbackLoopService/);
  });

  it('uses forwardRef — the loop pulls in PlannerService', () => {
    expect(dispatcher).toMatch(/forwardRef\(\(\) => FeedbackLoopService\)/);
  });

  it('is APPENDED to the constructor, not spliced in', () => {
    const ctor = dispatcher.slice(dispatcher.indexOf('  constructor('));
    const body = ctor.slice(0, ctor.indexOf('\n  ) {'));
    const params = body
      .split('\n')
      .map((l) => /(?:private readonly )(\w+)\??:/.exec(l)?.[1])
      .filter((n): n is string => Boolean(n));

    expect(params.indexOf('feedbackLoop')).toBe(params.length - 1);
  });

  it('applies the analysis, rather than computing and discarding it', () => {
    // Calling analyze() alone would pay the cost and change nothing — the same
    // failure this repo has had repeatedly.
    const fn = dispatcher.slice(dispatcher.indexOf('private async runFeedback('));
    const body = fn.slice(0, fn.indexOf('\n  }'));
    expect(body).toMatch(/const analysis = await this\.feedbackLoop\.analyze\(/);
    expect(body).toMatch(/applyFeedbackToPlan\(feedbackCtx, analysis\)/);
  });
});

describe('cost envelope', () => {
  it('analyze() short-circuits a healthy success before any model call', () => {
    // This is what makes it safe to call on every plan step: the model is only
    // consulted when something actually went wrong.
    const fn = loop.slice(loop.indexOf('async analyze('));
    const head = fn.slice(0, fn.indexOf('const analysis = await this.runAiAnalysis'));
    expect(head).toMatch(/ctx\.success && this\.isResultHealthy\(/);
    expect(head).toMatch(/return \{ shouldContinue: true/);
  });
});

describe('registration', () => {
  it('FeedbackLoopService is a registered provider', () => {
    expect(aiModule).toMatch(/FeedbackLoopService/);
  });
});
