// RR-CI-REQUIRED-JOBS-AGGREGATE (REC-ANTI-FAKE-GREEN, D-239, D-261):
// one 'CI verdict' job that is red when any gating CI job failed, was
// skipped or was cancelled.
//
// Why: main has no branch protection and no required status checks, yet the
// D-239 merge condition reads "CI is green at the exact head sha (every
// required check finished, none pending)". In ci-cd.yml build-server,
// build-web, e2e-mocked and test all `needs: [lint-and-typecheck]`: a type
// check failure turns them grey "skipped", which GitHub does not render as
// red (the 2026-08-08 failure the workflow records). This spec pins a final
// job, `ci-verdict`, that needs every gating job, runs `if: always()`, and
// exits 1 unless every need's result is exactly `success`.
//
// How it reads ci-cd.yml: line based, like runtime-pin.spec.mjs, with only
// node: builtins, because it runs in the Type Check job before install. A
// line it cannot read is a problem, never ignored. What the verdict step DOES
// is proven by running its script under the runner's shell with every
// combination of one non-success result substituted for the GitHub
// expressions (runVerdictScript), not by reading the shell.
//
// Folded in from the RR-SCRIPT-SPECS-IN-CI review (orchestrator note A1):
// the census step "Check every script spec runs in CI" can be neutered at
// step level (if: false, continue-on-error: true, env: NODE_TEST_CONTEXT=child)
// while every other guard stays green. censusStepProblems pins that step to
// `name` and `run` only, a single `node --test` command with plain file
// arguments, after Setup Node.
//
// Out of scope (the packet): making ci-verdict a required check or enabling
// branch protection (owner question), other workflows (a `needs:` cannot
// cross workflows), any gating job's steps, the WAVE-RUNBOOK wording.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOW = path.join('.github', 'workflows', 'ci-cd.yml');

export const VERDICT_JOB = 'ci-verdict';
export const VERDICT_NAME = 'CI verdict (gating jobs)';
export const VERDICT_STEP = 'Red unless every gating job succeeded';

/**
 * Jobs the verdict does not wait for, each with the reason. A job is gating
 * unless it is listed here, so a job added to ci-cd.yml later without being
 * named in the verdict's `needs:` fails this spec until it is listed in one
 * of the two places.
 */
export const NON_GATING = Object.freeze({
  lint: 'the debt ratchet (Lint job): by design it blocks nothing, ci-cd.yml records why',
});

/** The verdict job may set only these keys: env, continue-on-error, timeout-minutes, container, defaults, strategy or outputs can change what its step sees or whether its failure counts. */
const VERDICT_JOB_KEYS = ['name', 'runs-on', 'needs', 'if', 'steps'];
/** Its one step may set only these: shell, env, if, working-directory or continue-on-error can make it pass without checking. */
const STEP_KEYS = ['name', 'run'];
/** The only forms of "run even when a need failed or was skipped" this spec accepts. */
const ALWAYS = ['always()', '${{ always() }}'];
/** Every result GitHub gives a `needs.<id>.result`; only the first is green. */
export const RESULTS = ['success', 'failure', 'cancelled', 'skipped'];
/** How GitHub runs a `run:` step with no `shell:` on a Linux runner. */
const RUNNER_SHELL = ['bash', '--noprofile', '--norc', '-eo', 'pipefail'];

export const CENSUS_JOB = 'lint-and-typecheck';
export const CENSUS_SPEC = 'scripts/ci/script-specs-in-ci.spec.mjs';
/** A `node --test` line whose arguments are plain paths or `*.spec.mjs` globs: no env assignment, no `;`, `&&`, `||`, `|`, quotes, backticks or `$`. */
const PLAIN_NODE_TEST = /^node --test(?: [A-Za-z0-9_./*-]+)+$/;

// ---------------------------------------------------------------------------
// Reading the workflow, line by line

function indentOf(line) {
  return line.length - line.trimStart().length;
}

/** Lines with full-line comments and blanks dropped; CRLF tolerated. */
export function codeLines(source) {
  return source.split(/\r?\n/).filter((line) => line.trim() !== '' && !/^\s*#/.test(line));
}

/** A scalar's text: quotes removed, a trailing ` # comment` dropped. */
export function scalar(raw) {
  if (raw === undefined) return '';
  const value = raw.trim();
  const quoted = value.match(/^(['"])(.*)\1(\s+#.*)?$/);
  if (quoted) return quoted[2];
  return value.replace(/\s+#.*$/, '').trim();
}

/**
 * The jobs of a workflow: id -> its code lines (the `  id:` line included),
 * in file order. Null when the file has no `jobs:` region.
 */
export function jobBlocks(source) {
  const lines = codeLines(source);
  const jobs = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (jobs < 0) return null;
  const blocks = new Map();
  let id = null;
  for (const line of lines.slice(jobs + 1)) {
    if (/^\S/.test(line)) break; // the next top-level key ends the region
    const head = /^ {2}([A-Za-z_][\w-]*):\s*$/.exec(line);
    if (head) {
      id = head[1];
      blocks.set(id, [line]);
      continue;
    }
    if (id !== null) blocks.get(id).push(line);
  }
  return blocks;
}

/**
 * One job's header fields (indent 4, with any block value's lines) and its
 * steps (indent 6 `- key:`, indent 8 `key:`, deeper lines belong to the last
 * key). Anything else is reported in `unparsed`.
 */
export function readJob(lines) {
  const header = {};
  const steps = [];
  const unparsed = [];
  let inSteps = false;
  let field = null; // the header field collecting block lines
  let step = null;
  let key = null;
  for (const line of lines.slice(1)) {
    const indent = indentOf(line);
    if (indent <= 4) {
      const m = /^ {4}([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(line);
      inSteps = false;
      step = null;
      field = null;
      if (!m) {
        unparsed.push(line.trim());
        continue;
      }
      header[m[1]] = { inline: scalar(m[2]), block: [] };
      field = header[m[1]];
      inSteps = m[1] === 'steps';
      continue;
    }
    if (!inSteps) {
      if (field) field.block.push(line.trim());
      else unparsed.push(line.trim());
      continue;
    }
    const head = /^ {6}- ([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(line);
    const stepField = /^ {8}([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(line);
    if (head) {
      step = { fields: {} };
      steps.push(step);
      key = head[1];
      step.fields[key] = { inline: scalar(head[2]), block: [] };
    } else if (step && stepField) {
      key = stepField[1];
      step.fields[key] = { inline: scalar(stepField[2]), block: [] };
    } else if (step && key && indent >= 10) {
      step.fields[key].block.push(line.slice(10));
    } else {
      unparsed.push(line.trim());
    }
  }
  const value = (f) => {
    if (!f) return undefined;
    return f.inline === '' || /^[|>][+-]?$/.test(f.inline) ? f.block.join('\n') : f.inline;
  };
  return {
    header: Object.fromEntries(Object.entries(header).map(([k, f]) => [k, value(f)])),
    headerFields: header,
    unparsed,
    steps: steps.map((s) => ({
      keys: Object.keys(s.fields),
      name: value(s.fields.name),
      uses: value(s.fields.uses),
      run: value(s.fields.run),
    })),
  };
}

/**
 * A header field read as a list: flow `[a, b]`, block `- a` lines, or one
 * scalar. Null when the field is absent or not readable as a list.
 */
export function listValue(field) {
  if (!field) return null;
  const flow = /^\[(.*)\]$/.exec(field.inline);
  if (flow) {
    if (field.block.length) return null;
    return flow[1]
      .split(',')
      .map((item) => scalar(item))
      .filter((item) => item !== '');
  }
  if (field.inline !== '') return field.block.length ? null : [field.inline];
  const items = [];
  for (const line of field.block) {
    const m = /^- (.+)$/.exec(line);
    if (!m) return null;
    items.push(scalar(m[1]));
  }
  return items;
}

// ---------------------------------------------------------------------------
// The verdict job

const EXPRESSION = /\$\{\{[^}]*\}\}/g;
const resultExpression = (id) => `\${{ needs.${id}.result }}`;

/**
 * Runs the verdict step's script as the runner would, with each
 * `${{ needs.<id>.result }}` replaced by `results[id]`, GITHUB_STEP_SUMMARY
 * pointing at a scratch file. Returns the exit status and the summary text.
 */
export function runVerdictScript(script, results) {
  let body = script;
  for (const [id, result] of Object.entries(results)) {
    body = body.split(resultExpression(id)).join(result);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-verdict-'));
  try {
    const file = path.join(dir, 'step.sh');
    const summary = path.join(dir, 'summary.md');
    fs.writeFileSync(file, body);
    fs.writeFileSync(summary, '');
    const env = { PATH: process.env.PATH, HOME: dir, GITHUB_STEP_SUMMARY: summary };
    const run = spawnSync(RUNNER_SHELL[0], [...RUNNER_SHELL.slice(1), file], { env, encoding: 'utf8' });
    return {
      status: run.status,
      stdout: run.stdout ?? '',
      stderr: run.stderr ?? '',
      summary: fs.readFileSync(summary, 'utf8'),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The verdict step's script: it reads exactly one `${{ needs.<id>.result }}`
 * per gating job and nothing else from the expression context, exits 0 when
 * every result is success, exits 1 when any one result is failure, cancelled,
 * skipped or something unexpected, and names every job and result in the
 * step summary. Proven by running the script.
 */
export function verdictScriptProblems(script, gating) {
  const problems = [];
  if (!script || !script.trim()) return [`the '${VERDICT_STEP}' step has no run script`];
  const expressions = script.match(EXPRESSION) ?? [];
  for (const id of gating) {
    const count = expressions.filter((e) => e === resultExpression(id)).length;
    if (count !== 1) problems.push(`the verdict script must read ${resultExpression(id)} exactly once, found ${count}`);
  }
  const allowed = new Set(gating.map(resultExpression));
  for (const e of expressions) {
    if (!allowed.has(e)) problems.push(`the verdict script reads ${e}: only needs.<gating job>.result may reach the shell`);
  }
  if (problems.length) return problems;

  const allGreen = Object.fromEntries(gating.map((id) => [id, 'success']));
  const green = runVerdictScript(script, allGreen);
  if (green.status !== 0) {
    problems.push(`with every result success the verdict step must exit 0, exited ${green.status}: ${green.stderr.trim()}`);
  }
  for (const id of gating) {
    const line = green.summary.split('\n').find((l) => l.includes(id) && l.includes('success'));
    if (!line) problems.push(`the step summary must name ${id} with its result, got ${JSON.stringify(green.summary)}`);
  }
  for (const id of gating) {
    for (const result of [...RESULTS.slice(1), '']) {
      const run = runVerdictScript(script, { ...allGreen, [id]: result });
      if (run.status !== 1) {
        problems.push(`with ${id} ${JSON.stringify(result)} and every other job success the verdict step must exit 1, exited ${run.status}`);
      } else if (result && !run.summary.split('\n').some((l) => l.includes(id) && l.includes(result))) {
        problems.push(`the step summary must name ${id} as ${result}, got ${JSON.stringify(run.summary)}`);
      }
    }
  }
  return problems;
}

/**
 * Every problem with the verdict job in a workflow source: missing, not
 * running always, not needing every gating job (or needing a non-gating
 * one), carrying keys that can neuter it, or a step that does not fail on a
 * non-success result. Empty means the verdict stands.
 */
export function verdictProblems(source, nonGating = NON_GATING) {
  const problems = [];
  const blocks = jobBlocks(source);
  if (!blocks) return ['the workflow has no jobs: region this spec can read'];
  for (const id of Object.keys(nonGating)) {
    if (!blocks.has(id)) problems.push(`NON_GATING names ${id}, which is not a job in the workflow (stale exemption)`);
  }
  const block = blocks.get(VERDICT_JOB);
  if (!block) {
    return [...problems, `the workflow has no ${VERDICT_JOB} job: a gating job that is skipped turns grey and nothing turns red`];
  }
  const gating = [...blocks.keys()].filter((id) => id !== VERDICT_JOB && !(id in nonGating));
  const { header, headerFields, unparsed, steps } = readJob(block);
  for (const line of unparsed) problems.push(`${VERDICT_JOB} line this spec cannot read: ${line}`);
  for (const key of Object.keys(header)) {
    if (!VERDICT_JOB_KEYS.includes(key)) {
      problems.push(`job-level ${key} on ${VERDICT_JOB} (it may set only ${VERDICT_JOB_KEYS.join(', ')})`);
    }
  }
  if (header.name !== VERDICT_NAME) problems.push(`${VERDICT_JOB} must be named '${VERDICT_NAME}', found ${JSON.stringify(header.name)}`);
  if (!header['runs-on']) problems.push(`${VERDICT_JOB} has no runs-on`);
  if (!ALWAYS.includes(header.if)) {
    problems.push(`${VERDICT_JOB} must run 'if: always()' so it runs when a need failed or was skipped, found ${JSON.stringify(header.if)}`);
  }
  const needs = listValue(headerFields.needs);
  if (needs === null) {
    problems.push(`${VERDICT_JOB} must list its needs as [a, b] or as '- a' lines, found ${JSON.stringify(header.needs)}`);
  } else {
    for (const id of gating) {
      if (!needs.includes(id)) problems.push(`${VERDICT_JOB} does not need ${id}: list it in needs or in NON_GATING with a reason`);
    }
    for (const id of needs) {
      if (id in nonGating) problems.push(`${VERDICT_JOB} needs ${id}, which NON_GATING says blocks nothing`);
      else if (!blocks.has(id)) problems.push(`${VERDICT_JOB} needs ${id}, which is not a job in the workflow`);
    }
    if (new Set(needs).size !== needs.length) problems.push(`${VERDICT_JOB} lists a need twice`);
  }
  if (steps.length !== 1) {
    problems.push(`${VERDICT_JOB} must have exactly one step, found ${steps.length}`);
  } else {
    const step = steps[0];
    const extra = step.keys.filter((k) => !STEP_KEYS.includes(k));
    if (extra.length) problems.push(`the verdict step may not set ${extra.join(', ')} (only ${STEP_KEYS.join(', ')})`);
    if (step.name !== VERDICT_STEP) problems.push(`the verdict step must be named '${VERDICT_STEP}', found ${JSON.stringify(step.name)}`);
    if (step.run === undefined) problems.push('the verdict step must be a run step');
    else if (needs !== null && !problems.length) problems.push(...verdictScriptProblems(step.run, gating));
  }
  return problems;
}

// ---------------------------------------------------------------------------
// The census step (orchestrator note A1 on RR-SCRIPT-SPECS-IN-CI)

/**
 * The step in the Type Check job that runs the script-spec census: exactly
 * one, after Setup Node, `name` and `run` only, one plain `node --test`
 * command naming the census spec. Any step-level if, env, shell,
 * continue-on-error or working-directory, any env assignment or shell
 * operator in the command, is a problem.
 */
export function censusStepProblems(source) {
  const blocks = jobBlocks(source);
  if (!blocks) return ['the workflow has no jobs: region this spec can read'];
  const block = blocks.get(CENSUS_JOB);
  if (!block) return [`the workflow has no ${CENSUS_JOB} job`];
  const { steps, unparsed } = readJob(block);
  const problems = unparsed.map((line) => `${CENSUS_JOB} line this spec cannot read: ${line}`);
  const mentions = steps.filter((s) => (s.run ?? '').includes(CENSUS_SPEC));
  if (mentions.length !== 1) {
    return [...problems, `${CENSUS_JOB} must have exactly one step running ${CENSUS_SPEC}, found ${mentions.length}`];
  }
  const step = mentions[0];
  const extra = step.keys.filter((k) => !STEP_KEYS.includes(k));
  if (extra.length) {
    problems.push(`the census step may not set ${extra.join(', ')} (only ${STEP_KEYS.join(', ')}: if, env, shell, working-directory or continue-on-error can make it pass without checking)`);
  }
  if (!PLAIN_NODE_TEST.test(step.run)) {
    problems.push(`the census step must run one plain 'node --test <files...>' command, found ${JSON.stringify(step.run)}`);
  }
  const before = steps.slice(0, steps.indexOf(step));
  if (!before.some((s) => /^actions\/setup-node@/.test(s.uses ?? ''))) {
    problems.push('the census step must run after Setup Node, on the pinned Node');
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Fixtures: a small ci-cd-shaped workflow for the negative controls

/** The verdict script this packet puts in ci-cd.yml, for the given needs. */
export function verdictScript(gating) {
  return [
    'verdict=0',
    '{',
    "  echo '| Gating job | Result |'",
    "  echo '| --- | --- |'",
    '} >> "$GITHUB_STEP_SUMMARY"',
    "while IFS='=' read -r job result; do",
    '  echo "| $job | $result |" >> "$GITHUB_STEP_SUMMARY"',
    '  echo "$job: $result"',
    '  if [ "$result" != success ]; then verdict=1; fi',
    "done <<'RESULTS'",
    ...gating.map((id) => `${id}=${resultExpression(id)}`),
    'RESULTS',
    'exit "$verdict"',
  ].join('\n');
}

function indentBlock(text, spaces) {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line === '' ? '' : pad + line))
    .join('\n');
}

/**
 * A workflow with jobs lint-and-typecheck, build, test (both need the first) and lint, a
 * verdict job and whatever `extraJobs` adds. Every part of the verdict job
 * can be overridden by the controls.
 */
export function fixture({
  needs = ['lint-and-typecheck', 'build', 'test'],
  ifValue = 'always()',
  jobKeys = '',
  stepKeys = '',
  stepName = VERDICT_STEP,
  script = verdictScript(needs),
  verdict = true,
  extraJobs = '',
  testJobKeys = '',
  beforeCensus = '',
} = {}) {
  const verdictJob = verdict
    ? [
        `  ${VERDICT_JOB}:`,
        `    name: ${VERDICT_NAME}`,
        '    runs-on: ubuntu-latest',
        `    needs: [${needs.join(', ')}]`,
        ...(ifValue === null ? [] : [`    if: ${ifValue}`]),
        ...(jobKeys ? [jobKeys] : []),
        '    steps:',
        `      - name: ${stepName}`,
        ...(stepKeys ? [stepKeys] : []),
        '        run: |',
        indentBlock(script, 10),
      ].join('\n')
    : '';
  return [
    'name: Fixture',
    'on: [push]',
    'jobs:',
    '  lint-and-typecheck:',
    '    name: Type Check',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v7',
    '      - uses: actions/setup-node@v4',
    '      - name: Check the Node runtime pin',
    '        run: node --test scripts/ci/runtime-pin.spec.mjs',
    beforeCensus,
    '      - name: Check every script spec runs in CI',
    `        run: node --test ${CENSUS_SPEC} scripts/agent-memory/tests/*.spec.mjs`,
    '  # the debt ratchet',
    '  lint:',
    '    name: Lint (debt ratchet)',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: echo lint',
    '  build:',
    '    name: Build',
    '    runs-on: ubuntu-latest',
    '    needs: [lint-and-typecheck]',
    '    steps:',
    '      - run: echo build',
    '  test:',
    '    name: Run Tests',
    '    runs-on: ubuntu-latest',
    '    needs: [lint-and-typecheck]',
    testJobKeys,
    '    steps:',
    '      - run: echo test',
    extraJobs,
    verdictJob,
    '',
  ]
    .filter((part) => part !== '')
    .join('\n');
}

const FIXTURE_GATING = ['lint-and-typecheck', 'build', 'test'];

// ---------------------------------------------------------------------------
// The repository

describe('ci-verdict: one CI verdict job is red when any gating job failed, was skipped or was cancelled', () => {
  const source = fs.readFileSync(path.join(ROOT, WORKFLOW), 'utf8');

  it('ci-cd.yml has every job this spec expects to judge, read line by line', () => {
    const blocks = jobBlocks(source);
    assert.ok(blocks, 'ci-cd.yml has a jobs: region');
    for (const id of ['lint-and-typecheck', 'lint', 'security-scan', 'build-server', 'build-web', 'e2e-mocked', 'test']) {
      assert.ok(blocks.has(id), `ci-cd.yml has the ${id} job`);
    }
    for (const [id, lines] of blocks) {
      const { unparsed } = readJob(lines);
      assert.deepEqual(unparsed, [], `${id} has no line this spec cannot read`);
    }
  });

  it("ci-cd.yml ends in a 'CI verdict (gating jobs)' job that needs every gating job, runs always, and is red unless every result is success", () => {
    const problems = verdictProblems(source);
    assert.deepEqual(problems, [], `\n${problems.join('\n')}\n`);
    const ids = [...jobBlocks(source).keys()];
    assert.equal(ids.at(-1), VERDICT_JOB, 'the verdict is the last job in the file');
  });

  it('NON_GATING holds only the lint debt ratchet', () => {
    assert.deepEqual(Object.keys(NON_GATING), ['lint']);
  });

  it('the Type Check job runs this spec in the script-specs step (the census would fail otherwise)', () => {
    const { steps } = readJob(jobBlocks(source).get(CENSUS_JOB));
    const census = steps.find((s) => (s.run ?? '').includes(CENSUS_SPEC));
    assert.ok(census, 'the census step exists');
    assert.ok(census.run.split(' ').includes('scripts/ci/ci-verdict.spec.mjs'), `the census step names this spec: ${census.run}`);
  });

  it('A1: the census step cannot be skipped or neutered at step level', () => {
    const problems = censusStepProblems(source);
    assert.deepEqual(problems, [], `\n${problems.join('\n')}\n`);
  });
});

// ---------------------------------------------------------------------------
// Negative controls over fixture workflow text (the DoD's four, and the
// shapes that neuter a job or a step)

describe('ci-verdict: negative controls', () => {
  it('the fixture verdict passes, so each control below fails for its own reason', () => {
    assert.deepEqual(verdictProblems(fixture()), []);
    assert.deepEqual(censusStepProblems(fixture()), []);
  });

  it('a workflow without a verdict job fails (RED on main)', () => {
    const problems = verdictProblems(fixture({ verdict: false }));
    assert.equal(problems.length, 1);
    assert.match(problems[0], /no ci-verdict job/);
  });

  it("a verdict job that omits 'test' from needs fails", () => {
    const problems = verdictProblems(fixture({ needs: ['lint-and-typecheck', 'build'], script: verdictScript(['lint-and-typecheck', 'build']) }));
    assert.deepEqual(problems, ['ci-verdict does not need test: list it in needs or in NON_GATING with a reason']);
  });

  it('a verdict job without if: always() fails, and so does any other condition', () => {
    assert.match(verdictProblems(fixture({ ifValue: null })).join('\n'), /must run 'if: always\(\)'/);
    assert.match(verdictProblems(fixture({ ifValue: 'success()' })).join('\n'), /must run 'if: always\(\)'/);
    assert.match(verdictProblems(fixture({ ifValue: "${{ github.event_name == 'push' }}" })).join('\n'), /must run 'if: always\(\)'/);
    assert.deepEqual(verdictProblems(fixture({ ifValue: '${{ always() }}' })), []);
  });

  it("a verdict step that accepts 'skipped' fails, found by running it", () => {
    const lenient = verdictScript(FIXTURE_GATING).replace(
      'if [ "$result" != success ]; then verdict=1; fi',
      'if [ "$result" = failure ] || [ "$result" = cancelled ]; then verdict=1; fi',
    );
    const problems = verdictProblems(fixture({ script: lenient }));
    assert.ok(problems.length >= 3, problems.join('\n'));
    for (const id of FIXTURE_GATING) {
      assert.ok(problems.some((p) => p.includes(`with ${id} "skipped"`) && p.includes('must exit 1')), problems.join('\n'));
    }
  });

  it('a verdict step that always exits 0, or that never reads a result, fails', () => {
    const silent = `${verdictScript(FIXTURE_GATING)}\n`.replace('exit "$verdict"', 'exit 0');
    assert.ok(verdictProblems(fixture({ script: silent })).some((p) => /must exit 1/.test(p)));
    const blind = verdictProblems(fixture({ script: 'echo all good' }));
    assert.deepEqual(
      blind,
      FIXTURE_GATING.map((id) => `the verdict script must read \${{ needs.${id}.result }} exactly once, found 0`),
    );
  });

  it('a verdict step that fails on an unexpected result value, not only the three named ones, is required', () => {
    const named = verdictScript(FIXTURE_GATING).replace(
      'if [ "$result" != success ]; then verdict=1; fi',
      'case "$result" in failure|cancelled|skipped) verdict=1 ;; esac',
    );
    const problems = verdictProblems(fixture({ script: named }));
    assert.ok(problems.some((p) => /with lint-and-typecheck "" and every other job success the verdict step must exit 1/.test(p)), problems.join('\n'));
  });

  it('a new job that is neither in needs nor in NON_GATING fails', () => {
    const extraJobs = ['  fresh:', '    name: Fresh', '    runs-on: ubuntu-latest', '    steps:', '      - run: echo fresh'].join('\n');
    const problems = verdictProblems(fixture({ extraJobs }));
    assert.deepEqual(problems, ['ci-verdict does not need fresh: list it in needs or in NON_GATING with a reason']);
    assert.deepEqual(verdictProblems(fixture({ extraJobs }), { ...NON_GATING, fresh: 'a control' }), []);
  });

  it('needing a NON_GATING job, a job that does not exist, or a job twice fails', () => {
    const lint = [...FIXTURE_GATING, 'lint'];
    assert.deepEqual(verdictProblems(fixture({ needs: lint, script: verdictScript(FIXTURE_GATING) })), [
      'ci-verdict needs lint, which NON_GATING says blocks nothing',
    ]);
    const ghost = [...FIXTURE_GATING, 'ghost'];
    assert.deepEqual(verdictProblems(fixture({ needs: ghost, script: verdictScript(FIXTURE_GATING) })), [
      'ci-verdict needs ghost, which is not a job in the workflow',
    ]);
    const twice = [...FIXTURE_GATING, 'test'];
    assert.deepEqual(verdictProblems(fixture({ needs: twice, script: verdictScript(FIXTURE_GATING) })), ['ci-verdict lists a need twice']);
  });

  it('a stale NON_GATING entry fails', () => {
    assert.deepEqual(verdictProblems(fixture(), { lint: 'ok', gone: 'removed job' }), [
      'NON_GATING names gone, which is not a job in the workflow (stale exemption)',
    ]);
  });

  it('job-level keys that can neuter the verdict fail: continue-on-error, env, timeout-minutes, strategy', () => {
    for (const line of ['    continue-on-error: true', '    env:\n      NODE_TEST_CONTEXT: child', '    timeout-minutes: 1', '    strategy:\n      matrix:\n        x: [1]']) {
      const problems = verdictProblems(fixture({ jobKeys: line }));
      assert.equal(problems.length, 1, `${line}\n${problems.join('\n')}`);
      assert.match(problems[0], /^job-level [a-z-]+ on ci-verdict/);
    }
  });

  it('step-level keys that can neuter the verdict step fail: if, continue-on-error, env, shell, working-directory', () => {
    for (const line of ['        if: false', '        continue-on-error: true', '        env:\n          X: y', '        shell: python', '        working-directory: /tmp']) {
      const problems = verdictProblems(fixture({ stepKeys: line }));
      assert.equal(problems.length, 1, `${line}\n${problems.join('\n')}`);
      assert.match(problems[0], /^the verdict step may not set/);
    }
  });

  it('a verdict step that reads anything but needs.<gating job>.result from the expression context fails', () => {
    const script = `${verdictScript(FIXTURE_GATING)}\necho '\${{ toJSON(needs) }}'`;
    assert.deepEqual(verdictProblems(fixture({ script })), [
      'the verdict script reads ${{ toJSON(needs) }}: only needs.<gating job>.result may reach the shell',
    ]);
    const outputs = `${verdictScript(FIXTURE_GATING)}\necho '\${{ needs.test.outputs.note }}'`;
    assert.deepEqual(verdictProblems(fixture({ script: outputs })), [
      'the verdict script reads ${{ needs.test.outputs.note }}: only needs.<gating job>.result may reach the shell',
    ]);
  });

  it('a second step, a wrong name, or needs this spec cannot read fail', () => {
    const second = fixture().replace('        run: |', "      - run: echo first\n      - name: Red unless every gating job succeeded\n        run: |").replace(
      `      - name: ${VERDICT_STEP}\n      - run: echo first`,
      '      - run: echo first',
    );
    assert.ok(verdictProblems(second).some((p) => /exactly one step/.test(p)), verdictProblems(second).join('\n'));
    assert.ok(verdictProblems(fixture({ stepName: 'Verdict' })).some((p) => /must be named/.test(p)));
    const flowAndBlock = fixture().replace('    needs: [lint-and-typecheck, build, test]', '    needs: [typecheck, build, test]\n      - lint');
    assert.ok(verdictProblems(flowAndBlock).some((p) => /must list its needs/.test(p)), verdictProblems(flowAndBlock).join('\n'));
  });

  it('a # line inside the run block is script, not a YAML comment: the spec judges the script GitHub runs', () => {
    // Review round 1, R1. A shell comment line in the step is content and stays.
    const commented = verdictScript(FIXTURE_GATING).replace('verdict=0', '# every gating job must be success\nverdict=0');
    assert.deepEqual(verdictProblems(fixture({ script: commented })), []);
    // H1: lines that look like a comment to a reader that drops `#` lines, but
    // that bash joins into `x="\n#"; verdict=0; y="\n"`, exit 0 on every result.
    const fakeGreen = verdictScript(FIXTURE_GATING).replace('exit "$verdict"', 'x="\n#"; verdict=0; y="\n"\nexit "$verdict"');
    const problems = verdictProblems(fixture({ script: fakeGreen }));
    assert.ok(problems.some((p) => /with lint-and-typecheck "skipped" and every other job success the verdict step must exit 1, exited 0/.test(p)), problems.join('\n'));
    // H1b: a note inside the here-document is read as a job line and turns the verdict permanently red.
    const noted = verdictScript(FIXTURE_GATING).replace('RESULTS\nexit', '# note\nRESULTS\nexit');
    assert.ok(verdictProblems(fixture({ script: noted })).some((p) => /with every result success the verdict step must exit 0, exited 1/.test(p)));
  });

  it('the run block must be a literal block scalar (|): a folded (>) or inline script is a different script', () => {
    // Review round 1, R2. GitHub folds `>` lines with spaces; the spec would otherwise prove the unfolded text.
    const folded = fixture().replace('        run: |', '        run: >');
    assert.deepEqual(verdictProblems(folded), ["the verdict step's run must be a literal block scalar (run: |), found '>'"]);
    const inline = fixture().replace(/        run: \|\n[\s\S]*$/, '        run: exit 0\n');
    assert.ok(verdictProblems(inline).some((p) => /must be a literal block scalar/.test(p)), verdictProblems(inline).join('\n'));
  });

  it("every '${{' opener in the script must start an allowed result expression, whatever follows it", () => {
    // Review round 1, F2: `[^}]*` cannot cross the `}` in `{0}`, so an expression
    // that formats a PR body into the shell was invisible to the earlier check.
    const formatted = `${verdictScript(FIXTURE_GATING)}\ncat <<'NOTE'\n\${{ format('Judged PR: {0}', github.event.pull_request.body) }}\nNOTE`;
    const problems = verdictProblems(fixture({ script: formatted }));
    assert.deepEqual(problems, [
      "the verdict script has 4 '${{' expression openers for 3 gating jobs: only needs.<gating job>.result may reach the shell",
    ]);
    const nested = `${verdictScript(FIXTURE_GATING)}\necho '\${{ fromJSON('{"a":{"b":1}}').a.b }}'`;
    assert.ok(verdictProblems(fixture({ script: nested })).some((p) => /expression openers/.test(p)));
  });

  it('a gating job with job-level continue-on-error (or one inside its strategy) fails: its failure would reach the verdict as success', () => {
    // Review round 1, F3.
    assert.deepEqual(verdictProblems(fixture({ testJobKeys: '    continue-on-error: true' })), [
      'gating job test sets job-level continue-on-error: a failed run would reach the verdict as success',
    ]);
    assert.deepEqual(verdictProblems(fixture({ testJobKeys: '    continue-on-error: ${{ github.event_name == \'push\' }}' })), [
      'gating job test sets job-level continue-on-error: a failed run would reach the verdict as success',
    ]);
    const strategy = fixture({ testJobKeys: '    strategy:\n      fail-fast: false\n      matrix:\n        node: [22]\n    continue-on-error: ${{ matrix.node == 22 }}' });
    assert.ok(verdictProblems(strategy).some((p) => /gating job test sets job-level continue-on-error/.test(p)));
    assert.deepEqual(verdictProblems(fixture({ testJobKeys: '    timeout-minutes: 30' })), []);
  });

  it('A1: a step inserted before the census step fails, unless it is checkout, pnpm setup, setup-node or the runtime-pin step', () => {
    // Review round 1, F4: an earlier run step can write NODE_TEST_CONTEXT to GITHUB_ENV.
    const envWriter = '      - run: echo NODE_TEST_CONTEXT=child >> "$GITHUB_ENV"';
    assert.deepEqual(censusStepProblems(fixture({ beforeCensus: envWriter })), [
      "'echo NODE_TEST_CONTEXT=child >> \"$GITHUB_ENV\"' runs before the census step; only the checkout, pnpm setup, setup-node and runtime-pin steps may (an earlier step can write GITHUB_ENV or GITHUB_PATH)",
    ]);
    const action = '      - name: Prepare\n        uses: someone/prepare@v1';
    assert.ok(censusStepProblems(fixture({ beforeCensus: action })).some((p) => /'Prepare' runs before the census step/.test(p)));
    const pinWithEnv = fixture().replace(
      '        run: node --test scripts/ci/runtime-pin.spec.mjs',
      '        run: node --test scripts/ci/runtime-pin.spec.mjs\n        env:\n          NODE_TEST_CONTEXT: child',
    );
    assert.ok(censusStepProblems(pinWithEnv).some((p) => /'Check the Node runtime pin' .*may not set env/.test(p)), censusStepProblems(pinWithEnv).join('\n'));
    const checkoutWith = fixture().replace('      - uses: actions/checkout@v7', '      - uses: actions/checkout@v7\n        with:\n          fetch-depth: 0');
    assert.deepEqual(censusStepProblems(checkoutWith), []);
  });

  it('duplicate keys are reported, not resolved first- or last-wins', () => {
    // Review round 1, F5. GitHub rejects duplicate mapping keys; the spec must not read past them.
    const twoJobs = fixture().replace('jobs:\n', 'jobs:\n  ci-verdict:\n    name: decoy\n    runs-on: x\n    steps:\n      - run: exit 0\n');
    assert.ok(verdictProblems(twoJobs).some((p) => /job id ci-verdict appears 2 times/.test(p)), verdictProblems(twoJobs).join('\n'));
    const twoRegions = `${fixture()}\njobs:\n  ghost:\n    runs-on: x\n`;
    assert.ok(verdictProblems(twoRegions).some((p) => /2 top-level jobs: lines/.test(p)), verdictProblems(twoRegions).join('\n'));
    const twoRuns = fixture().replace('        run: |', '        run: exit 0\n        run: |');
    assert.ok(verdictProblems(twoRuns).some((p) => /duplicate key run/.test(p)), verdictProblems(twoRuns).join('\n'));
    const twoIfs = fixture().replace('    if: always()', '    if: always()\n    if: false');
    assert.ok(verdictProblems(twoIfs).some((p) => /duplicate key if/.test(p)), verdictProblems(twoIfs).join('\n'));
  });

  it('a job head with a trailing comment is read as that job', () => {
    const commented = fixture().replace(`  ${VERDICT_JOB}:`, `  ${VERDICT_JOB}: # the last word`);
    assert.deepEqual(verdictProblems(commented), []);
  });

  it('a verdict job with needs written as block lines passes', () => {
    const block = fixture().replace('    needs: [lint-and-typecheck, build, test]', '    needs:\n      - lint-and-typecheck\n      - build\n      - test');
    assert.deepEqual(verdictProblems(block), []);
  });

  it('A1 controls: the census step with if, continue-on-error or env, or a command that is not one plain node --test, fails', () => {
    const base = fixture();
    const at = `      - name: Check every script spec runs in CI\n`;
    for (const extra of ['        if: false\n', '        continue-on-error: true\n', '        env:\n          NODE_TEST_CONTEXT: child\n']) {
      const problems = censusStepProblems(base.replace(at, at + extra));
      assert.equal(problems.length, 1, problems.join('\n'));
      assert.match(problems[0], /^the census step may not set/);
    }
    const command = `        run: node --test ${CENSUS_SPEC} scripts/agent-memory/tests/*.spec.mjs`;
    for (const bad of [
      `        run: NODE_TEST_CONTEXT=child node --test ${CENSUS_SPEC}`,
      `        run: node --test ${CENSUS_SPEC} || true`,
      `        run: node --test ${CENSUS_SPEC}; true`,
      `        run: node --test ${CENSUS_SPEC} | tail -1`,
      `        run: node --test ${CENSUS_SPEC} 2>/dev/null`,
    ]) {
      const problems = censusStepProblems(base.replace(command, bad));
      assert.equal(problems.length, 1, `${bad}\n${problems.join('\n')}`);
      assert.match(problems[0], /one plain 'node --test <files\.\.\.>' command/);
    }
    const commentedOut = censusStepProblems(base.replace(command, `        run: echo skip # node --test ${CENSUS_SPEC}`));
    assert.deepEqual(commentedOut, ['lint-and-typecheck must have exactly one step running scripts/ci/script-specs-in-ci.spec.mjs, found 0']);
    const twoSteps = base.replace(command, `${command}\n      - name: again\n        run: node --test ${CENSUS_SPEC}`);
    assert.deepEqual(censusStepProblems(twoSteps), ['lint-and-typecheck must have exactly one step running scripts/ci/script-specs-in-ci.spec.mjs, found 2']);
    const noNode = base.replace('      - uses: actions/setup-node@v4\n', '');
    assert.deepEqual(censusStepProblems(noNode), ['the census step must run after Setup Node, on the pinned Node']);
  });
});
