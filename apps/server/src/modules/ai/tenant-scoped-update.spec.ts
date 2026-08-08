/**
 * Two writes that resolved a record id without proving the caller owned it, or
 * wrote a request body wholesale into a row carrying a settable businessId.
 *
 * Found by an adversarial preflight on 2026-08-08, the night the body-override
 * class was fixed everywhere else. Neither was part of that class — which is why
 * the sweep and its gate both walked straight past them:
 *
 *   goal-tracker.service.ts  updateGoal(businessId, goalId, data)
 *     took businessId as an argument, used it ONLY for the event emit, and wrote
 *     `update({ where: { id: goalId } })`. Any authenticated caller could edit
 *     any business's goal. deleteGoal, immediately below it, was already correct.
 *
 *   project-planner.service.ts  updatePlan(businessId, planId, body)
 *     checked ownership properly, then wrote `data: body`. ProjectPlan.businessId
 *     is a settable scalar and the controller's @Body() is an inline type literal
 *     (erases to Object, so ValidationPipe strips nothing) — so the body could
 *     RELOCATE a plan you owned into a business you did not.
 *
 * These are source assertions, not behavioural ones. That is deliberate: both
 * defects are visible in the shape of the query, and a mocked-Prisma test would
 * assert against the mock rather than the isolation. A real-database test lives
 * in apps/server/test/ and is the right place for behavioural coverage.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '..', '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), 'utf8');
}

/** The body of a named async method, brace-balanced. */
function methodBody(src: string, name: string): string {
  const at = src.indexOf(`async ${name}(`);
  expect(at, `${name}() not found — was it renamed?`).toBeGreaterThan(-1);
  const open = src.indexOf('{', src.indexOf(')', at));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`could not find the end of ${name}()`);
}

describe('a record id from a request is not a tenant scope', () => {
  it('goal-tracker updateGoal scopes its write by businessId', () => {
    const body = methodBody(read('modules/ai/goal-tracker.service.ts'), 'updateGoal');

    // The precise defect: a where clause naming only the record id.
    expect(
      /where:\s*\{\s*id:\s*goalId\s*\}/.test(body),
      'updateGoal writes with `where: { id: goalId }` — no tenant scope. Any ' +
        'authenticated caller can edit any business\'s goal by id. Add businessId ' +
        'to the where clause (deleteGoal in the same file shows the shape).',
    ).toBe(false);

    expect(
      /businessGoal\.(update|updateMany|delete|deleteMany)/.test(body) &&
        /businessId/.test(body.slice(body.indexOf('businessGoal.'))),
      'the write in updateGoal must carry businessId',
    ).toBe(true);
  });

  it('project-planner updatePlan cannot be handed a new tenant by the body', () => {
    const body = methodBody(read('modules/projects/project-planner.service.ts'), 'updatePlan');

    expect(
      /data:\s*body\s*,/.test(body),
      'updatePlan writes `data: body` verbatim. ProjectPlan.businessId is a ' +
        'settable scalar and the controller\'s @Body() is an inline type literal, ' +
        'so ValidationPipe strips nothing — the body can relocate the plan into ' +
        'another business. Write named fields instead.',
    ).toBe(false);

    // Ownership check must survive too; it was already correct here.
    expect(
      /findFirst\(\{[\s\S]*?businessId[\s\S]*?\}\)/.test(body),
      'updatePlan lost its ownership check',
    ).toBe(true);
  });

  /*
   * THERE IS DELIBERATELY NO REPO-WIDE CHECK HERE, AND THAT IS THE FINDING.
   *
   * The obvious third test is "no service anywhere writes `data: body` into
   * Prisma". It was written, and then removed, because every regex expressing it
   * was wrong. Four attempts, four different failures, all on real code:
   *
   *   1. `{ businessId, ...\w+ }`      — missed `...(body ?? {})`, a parenthesised
   *                                      spread, which was a LIVE hole
   *                                      (key-genome.controller.ts:174).
   *   2. brace-balanced object scan    — treated class bodies as object literals;
   *                                      flagged a doc comment, missed the same hole.
   *   3. "tenant key before a spread"  — 53 hits, nearly all
   *                                      `...(cond ? { x } : {})` locals, and it
   *                                      still excluded the known hole.
   *   4. `data:\s*(body|dto|input)`    — matched a JSON COLUMN named `data` whose
   *                                      value happened to be called `payload`
   *                                      (community.service.ts:291), and an RxJS
   *                                      SSE event.
   *
   * Every one of those would have failed the build on code that was fine, which
   * is how a gate gets deleted; and every one also missed at least one case that
   * was not fine, which is worse — it reports "clean" while the class survives.
   *
   * The class is real and worth gating. It needs an AST pass (ts-morph: resolve
   * the argument to a Prisma write, check whether it is an identifier bound to a
   * @Body() parameter, check whether the model has a settable tenant scalar), not
   * a fifth regex. Until that exists, these two assertions cover the two known
   * instances and nothing pretends to cover more than it does.
   */
});
