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

/** The text of a brace-balanced `{ ... }` starting at src[open]. */
function balanced(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error('unbalanced braces');
}

/** The top-level comma-separated entries of an object literal's text. */
function entries(objectText: string): string[] {
  const inner = objectText.slice(1, -1);
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    else if (c === ',' && depth === 0) {
      out.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(inner.slice(start).trim());
  return out.filter(Boolean);
}

/** The parameter list of a named async method. */
function methodParams(src: string, name: string): string {
  const at = src.indexOf(`async ${name}(`);
  expect(at, `${name}() not found — was it renamed?`).toBeGreaterThan(-1);
  return src.slice(at + `async ${name}(`.length, src.indexOf(')', at));
}

/**
 * Every BusinessGoal write a where clause can scope (update, updateMany,
 * upsert, delete, deleteMany) in the named method must:
 *   - take an object literal, so its where clause can be read here (a
 *     variable argument hides it);
 *   - name `businessId` in that where clause as the shorthand `businessId` or
 *     as `businessId: businessId`, i.e. bound to the method's own parameter.
 *     `businessId: undefined` is not a scope: Prisma drops an undefined
 *     filter, so the write reaches every tenant whenever no tenant context is
 *     set (a job or scheduler calling the service). Any other value is not
 *     the caller's tenant.
 * The method must also take `businessId: string` and never rebind it.
 * Returns one line per violation; empty means scoped.
 */
function unscopedGoalWrites(src: string, name: string): string[] {
  const problems: string[] = [];
  if (!/\bbusinessId\s*:\s*string\b/.test(methodParams(src, name))) {
    problems.push(`${name} does not take businessId: string`);
  }
  const body = methodBody(src, name);
  if (/\b(?:const|let|var)\s+(?:\{[^}]*\b)?businessId\b|(?<![.\w])businessId\s*=(?![=>])/.test(body)) {
    problems.push(`${name} rebinds businessId, so the where clause no longer names the caller's tenant`);
  }
  const writes = [...body.matchAll(/businessGoal\.(update|updateMany|upsert|delete|deleteMany)\s*\(\s*/g)];
  if (writes.length === 0) problems.push(`${name} has no BusinessGoal write to check`);
  for (const write of writes) {
    const method = write[1];
    const argAt = write.index! + write[0].length;
    if (body[argAt] !== '{') {
      problems.push(`${name}: businessGoal.${method} takes a non-literal argument; its where clause cannot be checked`);
      continue;
    }
    const arg = balanced(body, argAt);
    const whereAt = /\bwhere\s*:\s*\{/.exec(arg);
    if (!whereAt) {
      problems.push(`${name}: businessGoal.${method} has no where object`);
      continue;
    }
    const where = entries(balanced(arg, whereAt.index + whereAt[0].length - 1));
    const scoped = where.some((e) => e === 'businessId' || /^businessId\s*:\s*businessId$/.test(e));
    if (!scoped) {
      problems.push(`${name}: businessGoal.${method} where { ${where.join(', ')} } does not bind businessId to the parameter`);
    }
  }
  return problems;
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

  it('goal-tracker updateProgress keeps every BusinessGoal mutation tenant-scoped', () => {
    expect(unscopedGoalWrites(read('modules/ai/goal-tracker.service.ts'), 'updateProgress')).toEqual([]);
  });

  it('goal-tracker suggestActions keeps every BusinessGoal mutation tenant-scoped', () => {
    expect(unscopedGoalWrites(read('modules/ai/goal-tracker.service.ts'), 'suggestActions')).toEqual([]);
  });

  // The guard above must fail on the shapes that look scoped but are not.
  // Each mutant is the real method with one write changed.
  it('the BusinessGoal scope guard rejects writes that only look scoped', () => {
    const src = read('modules/ai/goal-tracker.service.ts');
    const progressWrite = 'where: { id: goalId, businessId },\n      data: { currentValue }';
    const actionsWrite = 'where: { id: goalId, businessId },\n      data: { actions';
    const achievedWhere = "where: { id: goalId, businessId, status: 'active' }";
    for (const needle of [progressWrite, actionsWrite, achievedWhere]) {
      expect(src.includes(needle), `goal-tracker changed shape; update this guard's mutants (${needle})`).toBe(true);
    }
    const mutants: Array<[string, string, string]> = [
      ['updateProgress', 'undefined tenant filter', src.replace(progressWrite, progressWrite.replace('businessId }', 'businessId: undefined }'))],
      ['suggestActions', 'undefined tenant filter', src.replace(actionsWrite, actionsWrite.replace('businessId }', 'businessId: undefined }'))],
      ['updateProgress', 'another value as the tenant', src.replace(achievedWhere, "where: { id: goalId, businessId: goal.businessId, status: 'active' }")],
      ['updateProgress', 'tenant only in a comment', src.replace(achievedWhere, "where: { id: goalId /* businessId */, status: 'active' }")],
      [
        'updateProgress',
        'arguments passed as a variable',
        src.replace(
          'const progressUpdate = await this.prisma.client.businessGoal.updateMany({',
          'const progressArgs = { where: { id: goalId }, data: { currentValue } };\n    const progressUpdate = await this.prisma.client.businessGoal.updateMany(progressArgs);\n    void ({',
        ),
      ],
      [
        'suggestActions',
        'an unscoped upsert',
        src.replace(
          'const stored = await this.prisma.client.businessGoal.updateMany({',
          'await this.prisma.client.businessGoal.upsert({ where: { id: goalId }, update: {}, create: {} as any });\n    const stored = await this.prisma.client.businessGoal.updateMany({',
        ),
      ],
      [
        'suggestActions',
        'businessId rebound',
        src.replace(
          'async suggestActions(businessId: string, goalId: string): Promise<GoalAction[]> {',
          'async suggestActions(businessId: string, goalId: string): Promise<GoalAction[]> {\n    businessId = undefined as any;',
        ),
      ],
    ];
    for (const [method, label, mutant] of mutants) {
      expect(mutant, `mutant "${label}" did not apply`).not.toBe(src);
      expect(unscopedGoalWrites(mutant, method).length, `the guard accepted ${method} with ${label}`).toBeGreaterThan(0);
    }
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
