/**
 * Script-spec census (RR-SCRIPT-SPECS-IN-CI, owner rulings D-261 and D-262;
 * the "configured but not run" half of REC-ANTI-FAKE-GREEN).
 *
 * The repository carries node:test specs outside apps/ and packages/: the
 * control-plane tests, the security scanner contracts, the launch and deploy
 * contracts, the Node runtime pin, and the agent-memory layer's tests
 * (D-253). A spec gates nothing unless a workflow runs it, and nothing stopped
 * a spec from being added, passing locally and never running in CI. At main
 * 2c4e4bf2 that was true of three: scripts/agent-memory/tests/lib.spec.mjs,
 * scripts/intelligence/open_pr_inventory.spec.mjs and
 * scripts/agent-control/research/tests/compile-context.spec.mjs. Each passed
 * locally; a regression in status.mjs or bundle.mjs merged green.
 *
 * What it holds:
 *   1. Every tracked *.spec.mjs outside apps/ and packages/ (git ls-files) is
 *      named by a `node --test` run line in some .github/workflows/*.yml, as
 *      an exact file or as a `<dir>/*.spec.mjs` glob over its own directory,
 *      or is in EXEMPT with a one-line reason.
 *   2. Every EXEMPT entry still names a tracked file (a stale entry fails),
 *      and none of them is also run by a workflow (a needless entry fails).
 *   3. This census itself runs in ci-cd.yml's lint-and-typecheck job before
 *      `pnpm install`: it, and the specs it brought into CI, need no
 *      dependencies, and a step that moves behind install or out of the job
 *      every other job `needs:` stops gating.
 *
 * What does not count as running a spec (each is a recorded CI trap, see the
 * comments at ci-cd.yml "Verify launch health contract" and "Security scanner
 * contracts"):
 *   - a bare directory (`node --test scripts/x/`): runs zero specs on Node 20
 *     and only the directory's own files on 22;
 *   - a `<dir>/*.spec.mjs` glob for a file in a subdirectory of <dir>: the
 *     shell expands one level (this is how compile-context.spec.mjs under
 *     research/tests/ escaped `scripts/agent-control/tests/*.spec.mjs`);
 *   - a `**` glob: bash without globstar reads `**` as `*`;
 *   - a `node --test` line inside a YAML or shell comment;
 *   - an indirection through a package.json script: the workflow line itself
 *     must name the file, so a reader can see what CI runs.
 *
 * Reading is line-based, as scripts/ci/runtime-pin.spec.mjs reads workflows:
 * no YAML parser, no dependency, so it runs before `pnpm install`. Each rule
 * is also checked against fixtures below (negative controls), so the census
 * cannot pass vacuously.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOWS = path.join('.github', 'workflows');
const SELF = 'scripts/ci/script-specs-in-ci.spec.mjs';
const CENSUS_JOB = 'lint-and-typecheck';

/**
 * Specs that no workflow runs, each with the reason. Keep this list short and
 * every entry dated or ruled: an entry is a decision that a spec is not a gate.
 */
export const EXEMPT = Object.freeze({
  'docs/intelligence/sessions/2026-10-17-h1-review-and-continuation/proof/regression-expectations.spec.mjs':
    'Dated session proof under docs/intelligence: a historical record (D-141), written to FAIL against PR #179, not a gate.',
});

// ---------------------------------------------------------------------------
// Inputs

/** Tracked *.spec.mjs outside apps/ and packages/, repo-relative with forward slashes. */
export function trackedScriptSpecs(root = ROOT) {
  const res = spawnSync('git', ['ls-files', '-z', '--', '*.spec.mjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(res.status, 0, `git ls-files failed: ${res.stderr}`);
  return res.stdout
    .split('\0')
    .filter(Boolean)
    .map((f) => f.replace(/\\/g, '/'))
    .filter((f) => !/^(?:apps|packages)\//.test(f))
    .sort();
}

/** Every workflow file as { name: source }, sorted by name. */
export function workflowSources(root = ROOT) {
  const dir = path.join(root, WORKFLOWS);
  return Object.fromEntries(
    fs
      .readdirSync(dir)
      .filter((f) => /\.ya?ml$/.test(f))
      .sort()
      .map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]),
  );
}

// ---------------------------------------------------------------------------
// Workflow reading (line-based, as runtime-pin.spec.mjs does)

const indentOf = (line) => line.length - line.trimStart().length;
/** Comment lines read as empty, so a commented-out run line neither counts nor fails. */
const codeLines = (source) => source.split(/\r?\n/).map((line) => (/^\s*#/.test(line) ? '' : line));

/** The shell text of every `run:` (inline, block scalar or flow mapping), one entry per run. */
export function runCommands(source) {
  const lines = codeLines(source);
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(\s*(?:- )?)run:[ \t]*(.*)$/.exec(lines[i]) || /[{,]\s*run:[ \t]*()(.*)$/.exec(lines[i]);
    if (!m) continue;
    if (m[2] && !/^[|>][+-]?\s*$/.test(m[2])) {
      out.push({ line: i + 1, text: m[2].replace(/\s*[},]\s*$/, '') });
      continue;
    }
    const keyIndent = m[1].length;
    const block = [];
    for (let j = i + 1; j < lines.length && (lines[j].trim() === '' || indentOf(lines[j]) > keyIndent); j += 1) {
      block.push(lines[j]);
    }
    out.push({ line: i + 1, text: block.join('\n') });
  }
  return out;
}

const unquote = (t) => t.replace(/^(['"])(.*)\1$/, '$2');
const normalise = (t) => unquote(t).replace(/^\.\//, '').replace(/\\/g, '/');

/**
 * The patterns each `node --test` invocation in `shell` names: tokens after
 * `--test` that are not flags, up to the end of the simple command. Line
 * continuations are joined first. Every token is returned, bare directories
 * included, so the caller decides what counts.
 */
export function nodeTestPatterns(shell) {
  const joined = shell.replace(/\\\r?\n\s*/g, ' ');
  const patterns = [];
  for (const segment of joined.split(/\r?\n|;|&&|\|\||\|/)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    const at = tokens.findIndex((t, k) => t === 'node' && tokens.slice(k + 1).includes('--test'));
    if (at < 0) continue;
    const test = tokens.indexOf('--test', at + 1);
    // Node flags before --test (--import, --experimental-*) are read past; only --test's own arguments follow.
    if (tokens.slice(at + 1, test).some((t) => !t.startsWith('-'))) continue;
    for (const t of tokens.slice(test + 1)) if (!t.startsWith('-')) patterns.push(normalise(t));
  }
  return patterns;
}

/**
 * Whether `pattern` runs `spec`: an exact file, or `<dir>/*.spec.mjs` where
 * <dir> is exactly the spec's directory. A bare directory, a `**`, or any
 * other wildcard does not count.
 */
export function patternRuns(pattern, spec) {
  if (pattern.includes('**')) return false;
  if (!pattern.includes('*')) return pattern === spec;
  const m = /^(.*)\/\*\.spec\.mjs$/.exec(pattern);
  if (!m) return false;
  return path.posix.dirname(spec) === m[1];
}

/** For each spec: the `<workflow>:<line>` run lines that run it (empty when none). */
export function coverage(specs, sources) {
  const named = [];
  for (const [name, source] of Object.entries(sources)) {
    for (const run of runCommands(source)) {
      for (const pattern of nodeTestPatterns(run.text)) named.push({ pattern, where: `${name}:${run.line}` });
    }
  }
  return Object.fromEntries(
    specs.map((spec) => [spec, named.filter((n) => patternRuns(n.pattern, spec)).map((n) => n.where)]),
  );
}

/** The census: problems is empty when every spec is run or exempt and EXEMPT is honest. */
export function census(specs, sources, exempt = EXEMPT) {
  const covered = coverage(specs, sources);
  const problems = [];
  for (const spec of specs) {
    if (covered[spec].length) continue;
    if (spec in exempt) continue;
    problems.push(`${spec}: run by no workflow (no node --test line names it or <its dir>/*.spec.mjs)`);
  }
  for (const [spec, reason] of Object.entries(exempt)) {
    if (!reason || !reason.trim()) problems.push(`EXEMPT ${spec}: no reason`);
    if (!specs.includes(spec)) problems.push(`EXEMPT ${spec}: not a tracked spec (stale entry; remove it)`);
    else if (covered[spec].length) problems.push(`EXEMPT ${spec}: run by ${covered[spec].join(', ')} (needless entry; remove it)`);
  }
  return { covered, problems };
}

/** The top-level job's line range [start, end) under `jobs:`, or null. */
export function jobLines(source, jobId) {
  const lines = codeLines(source);
  const jobs = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (jobs < 0) return null;
  const start = lines.findIndex((l, k) => k > jobs && new RegExp(`^ {2}${jobId}:\\s*$`).test(l));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && !/^ {2}[A-Za-z_][\w-]*:\s*$/.test(lines[end]) && !/^\S/.test(lines[end])) end += 1;
  return { lines, start, end };
}

// ---------------------------------------------------------------------------
// The repository

describe('script-specs-in-ci: every scripts/** node:test spec runs in a workflow or is exempt with a reason', () => {
  const specs = trackedScriptSpecs();
  const sources = workflowSources();

  it('finds the specs and the workflows it is about to judge', () => {
    assert.ok(specs.includes(SELF), `this census is tracked (${SELF})`);
    assert.ok(specs.includes('scripts/ci/runtime-pin.spec.mjs'));
    assert.ok(Object.keys(sources).includes('ci-cd.yml'));
  });

  it('every tracked *.spec.mjs outside apps/ and packages/ is run by a node --test line or is in EXEMPT', () => {
    const { problems } = census(specs, sources);
    assert.deepEqual(problems, [], `\n${problems.join('\n')}\n`);
  });

  it('EXEMPT holds only the dated session proof', () => {
    assert.deepEqual(Object.keys(EXEMPT), [
      'docs/intelligence/sessions/2026-10-17-h1-review-and-continuation/proof/regression-expectations.spec.mjs',
    ]);
  });

  it(`this census runs in ci-cd.yml's ${CENSUS_JOB} job, before pnpm install`, () => {
    const job = jobLines(sources['ci-cd.yml'], CENSUS_JOB);
    assert.ok(job, `ci-cd.yml has a ${CENSUS_JOB} job`);
    const body = job.lines.slice(job.start, job.end);
    const runs = runCommands(body.join('\n'));
    const self = runs.find((r) => nodeTestPatterns(r.text).some((p) => patternRuns(p, SELF)));
    assert.ok(self, `a run line in ${CENSUS_JOB} names ${SELF}`);
    const install = runs.find((r) => /\bpnpm install\b/.test(r.text));
    assert.ok(install, `${CENSUS_JOB} installs dependencies`);
    assert.ok(self.line < install.line, `the census step (line ${self.line}) comes before pnpm install (line ${install.line})`);
  });
});

// ---------------------------------------------------------------------------
// Negative controls: each rule shown to bite on a fixture

describe('script-specs-in-ci: negative controls', () => {
  const sources = workflowSources();

  it('a spec under a fresh scripts/ directory is reported as run by no workflow', () => {
    const fresh = 'scripts/fresh-census-fixture/a.spec.mjs';
    const { problems } = census([...trackedScriptSpecs(), fresh], sources);
    assert.ok(problems.some((p) => p.startsWith(`${fresh}: run by no workflow`)), problems.join('\n'));
  });

  it('a bare directory does not count as running the specs in it', () => {
    const wf = { 'x.yml': 'jobs:\n  j:\n    steps:\n      - run: node --test scripts/x/\n' };
    assert.deepEqual(census(['scripts/x/a.spec.mjs'], wf, {}).problems, [
      'scripts/x/a.spec.mjs: run by no workflow (no node --test line names it or <its dir>/*.spec.mjs)',
    ]);
    assert.equal(patternRuns('scripts/x', 'scripts/x/a.spec.mjs'), false);
  });

  it('an exact file and a <dir>/*.spec.mjs glob count; the glob stops at the directory', () => {
    const wf = {
      'x.yml': 'jobs:\n  j:\n    steps:\n      - run: node --test scripts/x/*.spec.mjs scripts/y/b.spec.mjs\n',
    };
    const specs = ['scripts/x/a.spec.mjs', 'scripts/x/sub/c.spec.mjs', 'scripts/y/b.spec.mjs'];
    const { covered, problems } = census(specs, wf, {});
    assert.deepEqual(covered['scripts/x/a.spec.mjs'], ['x.yml:4']);
    assert.deepEqual(covered['scripts/y/b.spec.mjs'], ['x.yml:4']);
    assert.deepEqual(covered['scripts/x/sub/c.spec.mjs'], []);
    assert.deepEqual(problems, [
      'scripts/x/sub/c.spec.mjs: run by no workflow (no node --test line names it or <its dir>/*.spec.mjs)',
    ]);
  });

  it('a ** glob and a commented-out run line do not count', () => {
    assert.equal(patternRuns('scripts/**/*.spec.mjs', 'scripts/x/a.spec.mjs'), false);
    const wf = { 'x.yml': 'jobs:\n  j:\n    steps:\n      # - run: node --test scripts/x/a.spec.mjs\n      - run: echo hi\n' };
    assert.equal(census(['scripts/x/a.spec.mjs'], wf, {}).problems.length, 1);
  });

  it('block-scalar, flow-mapping and line-continued run lines are read', () => {
    const wf = {
      'x.yml': [
        'jobs:',
        '  j:',
        '    steps:',
        '      - run: |',
        '          echo start',
        '          node --test-reporter=spec --test scripts/a/one.spec.mjs \\',
        '            scripts/b/*.spec.mjs',
        '      - { name: flow, run: node --test scripts/c/three.spec.mjs }',
        '',
      ].join('\n'),
    };
    const specs = ['scripts/a/one.spec.mjs', 'scripts/b/two.spec.mjs', 'scripts/c/three.spec.mjs'];
    const { covered, problems } = census(specs, wf, {});
    assert.deepEqual(problems, []);
    assert.deepEqual(covered['scripts/a/one.spec.mjs'], ['x.yml:4']);
    assert.deepEqual(covered['scripts/b/two.spec.mjs'], ['x.yml:4']);
    assert.deepEqual(covered['scripts/c/three.spec.mjs'], ['x.yml:8']);
  });

  it('an inline shell comment after the patterns is not a pattern', () => {
    const wf = { 'x.yml': 'jobs:\n  j:\n    steps:\n      - run: node --test scripts/x/a.spec.mjs # not scripts/y/b.spec.mjs\n' };
    const { covered } = census(['scripts/x/a.spec.mjs', 'scripts/y/b.spec.mjs'], wf, {});
    assert.deepEqual(covered['scripts/x/a.spec.mjs'], ['x.yml:4']);
    assert.deepEqual(covered['scripts/y/b.spec.mjs'], []);
    assert.deepEqual(nodeTestPatterns('node --test scripts/x/a.spec.mjs # not scripts/y/b.spec.mjs'), ['scripts/x/a.spec.mjs']);
  });

  it('text that merely mentions node --test (echo, a here-doc body) is not a run', () => {
    const wf = {
      'x.yml': [
        'jobs:',
        '  j:',
        '    steps:',
        '      - run: echo "node --test scripts/x/a.spec.mjs"',
        '      - run: |',
        '          cat > note.txt <<EOF',
        '          run: node --test scripts/y/b.spec.mjs',
        '          EOF',
        '',
      ].join('\n'),
    };
    const { covered } = census(['scripts/x/a.spec.mjs', 'scripts/y/b.spec.mjs'], wf, {});
    assert.deepEqual(covered['scripts/x/a.spec.mjs'], []);
    assert.deepEqual(covered['scripts/y/b.spec.mjs'], []);
  });

  it('node as the command, behind env assignments, timeout or pnpm exec, counts; node flags with a separate value fail closed', () => {
    assert.deepEqual(nodeTestPatterns('CI=1 timeout 600 node --test scripts/x/a.spec.mjs'), ['scripts/x/a.spec.mjs']);
    assert.deepEqual(nodeTestPatterns('pnpm exec node --test scripts/x/a.spec.mjs'), ['scripts/x/a.spec.mjs']);
    assert.deepEqual(nodeTestPatterns('cd scripts && node --test ci/a.spec.mjs'), ['ci/a.spec.mjs']);
    // `--import ./setup.mjs` (a value in its own token) is not read past: the line names nothing, so CI
    // fails loudly rather than crediting the spec. Use `--import=./setup.mjs` on such a line.
    assert.deepEqual(nodeTestPatterns('node --import ./setup.mjs --test scripts/x/a.spec.mjs'), []);
    assert.deepEqual(nodeTestPatterns('node --import=./setup.mjs --test scripts/x/a.spec.mjs'), ['scripts/x/a.spec.mjs']);
  });

  it('a stale EXEMPT path fails, and so does a needless or unexplained one', () => {
    const wf = { 'x.yml': 'jobs:\n  j:\n    steps:\n      - run: node --test scripts/x/a.spec.mjs\n' };
    const stale = census(['scripts/x/a.spec.mjs'], wf, { 'scripts/gone/z.spec.mjs': 'was removed' }).problems;
    assert.deepEqual(stale, ['EXEMPT scripts/gone/z.spec.mjs: not a tracked spec (stale entry; remove it)']);
    const needless = census(['scripts/x/a.spec.mjs'], wf, { 'scripts/x/a.spec.mjs': 'no longer true' }).problems;
    assert.deepEqual(needless, ['EXEMPT scripts/x/a.spec.mjs: run by x.yml:4 (needless entry; remove it)']);
    const silent = census(['scripts/x/a.spec.mjs', 'scripts/q/q.spec.mjs'], wf, { 'scripts/q/q.spec.mjs': '' }).problems;
    assert.deepEqual(silent, ['EXEMPT scripts/q/q.spec.mjs: no reason']);
  });

  it('the real exempt file exists and is not run anywhere', () => {
    const specs = trackedScriptSpecs();
    for (const spec of Object.keys(EXEMPT)) {
      assert.ok(specs.includes(spec), `${spec} is tracked`);
      assert.deepEqual(coverage([spec], sources)[spec], []);
    }
  });
});
