/**
 * Security Scan contract (V1-01-SEC-CREDENTIAL-SECRET-SCAN, PRS-M07).
 *
 * Ports the secret-scan hunk of #189 (this spec started as its contract at
 * 861f5c14) and the dependency-audit outcome capture of #114. Owner ruling
 * D-22 (docs/reconstruction/BUILD-MAP-001.md section (g)) makes the secret
 * scan blocking: nothing in the security-scan job, step or job header, may
 * skip the job or swallow a failure. D-22 does not name the dependency audit
 * and the packet makes its enforcement wait on D-22 while high advisories
 * exist, so the audit runs on every head and its exit code is recorded (log,
 * ::warning, step summary) without failing the job.
 *
 * Before this packet the job could never fail: a shallow checkout,
 * trufflehog@main told to scan from a literal `base: main` that a checkout
 * need not contain, and continue-on-error on both the audit and the scan
 * (ci-cd.yml:187-219 at 0796a728).
 *
 * The contract reads the security-scan job of .github/workflows/ci-cd.yml
 * and the root package.json. It checks the job header, the workflow-level
 * env and defaults, and the step fields statically (every key a scanner step
 * may carry is listed; a line this reader cannot read is refused), and it
 * also EXECUTES the three shell steps that decide the outcome:
 *   - the dependency audit's result capture, against a stand-in pnpm;
 *   - the scan-range preflight, against a throwaway git repository, for
 *     usable ranges (net-zero ones included) and for each unusable one
 *     (all-zero push base, missing or unknown endpoint, no file touched);
 *   - the outcome enforcement, once with every scanner green, once for each
 *     scanner failed, skipped or cancelled, and for the audit's verdict.
 * The negative controls restore each old false-green mechanism (and the
 * whole pre-V1-01 job, and #114's job ported alone), and each way found in
 * review to skip or neuter the job while every step reports success, and
 * require the contract to reject it.
 *
 * Run: node --test scripts/security/tests/secret-scan-contract.spec.mjs
 * CI runs it with every other security spec: node --test scripts/security/tests/*.spec.mjs
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SUITE_DIR = path.join(ROOT, 'scripts', 'security', 'tests');
const source = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci-cd.yml'), 'utf8');
const packageSource = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');

// refs/tags/v3.99.7 of trufflesecurity/trufflehog (git ls-remote, 2026-11-02).
// Its action.yml is byte-identical to #189's untagged pin 69734591: it derives
// the event's commit range when base/head are not given, and passes --fail.
const SCANNER_ACTION = 'trufflesecurity/trufflehog@31ce31ee1abbcc7dc8eee5764c17121c3044c8b2';
const UNTAGGED_PIN = 'trufflesecurity/trufflehog@69734591624d2afb8e152fcc8f3c2325ab577dae';
// The action runs `docker run "${IMAGE}:${VERSION}"`, and a tag on ghcr.io can
// be re-pushed, so the CLI image is pinned by digest too: the multi-arch index
// that ghcr.io/trufflesecurity/trufflehog:3.99.7 resolved to on 2026-11-02
// (docker-content-digest, and the sha256 of the manifest body). Docker ignores
// the tag when a digest follows it.
const SCANNER_VERSION = '3.99.7@sha256:0d003fc3abc4e1565eca8462b992001314de51451e96e3c44de80d116794d5d1';
const SCANNER_WITH = {
  path: './',
  version: SCANNER_VERSION,
  extra_args: '--only-verified --fail-on-scan-errors',
};
// An explicit file glob. `node --test scripts/security/tests/` runs ZERO specs
// on Node 20 (a .spec.mjs file in a directory not named `test` matches none
// of its naming rules, and it exits 0) and fails to start on Node 22.
const SECURITY_SUITE = 'node --test scripts/security/tests/*.spec.mjs';
const AUDIT = 'pnpm audit --audit-level high';
// The audit's result is recorded, not enforced (see the header).
const AUDIT_CAPTURE = ['audit_exit=0', `${AUDIT} || audit_exit=$?`, 'echo "exit_code=$audit_exit" >> "$GITHUB_OUTPUT"'];
const ZERO_SHA = '0'.repeat(40);

// Every key the job and its deciding steps may carry. A job-level `if` skips
// the job, which GitHub reports as success even for a required check; a
// job-level continue-on-error, env or defaults, or a step-level shell, env,
// working-directory or continue-on-error, can make a scanner pass without
// scanning (NODE_TEST_CONTEXT=child alone makes `node --test` skip every file
// and exit 0).
const JOB_KEYS = ['name', 'runs-on', 'permissions', 'steps'];
const JOB_PERMISSIONS = ['contents: read'];
const STEP_KEYS = {
  checkout: ['name', 'uses', 'with'],
  audit: ['name', 'id', 'run'],
  suite: ['name', 'id', 'if', 'run'],
  range: ['name', 'id', 'if', 'shell', 'env', 'run'],
  scan: ['name', 'id', 'if', 'uses', 'with'],
  enforce: ['name', 'if', 'shell', 'env', 'run'],
};
const STEP_IF = {
  suite: '${{ !cancelled() }}',
  range: '${{ !cancelled() }}',
  scan: "${{ !cancelled() && steps.secret_scan_range.outcome == 'success' }}",
};
const RANGE_ENV = {
  SCAN_BASE: '${{ github.event.pull_request.base.sha || github.event.before }}',
  SCAN_HEAD: '${{ github.event.pull_request.head.sha || github.sha }}',
};
const RANGE_FILES = 'git log --format= --name-only "$SCAN_BASE..$SCAN_HEAD"';
// Set at workflow level, these reach every step of the job.
const NEUTERING_WORKFLOW_ENV = ['NODE_TEST_CONTEXT', 'NODE_OPTIONS', 'BASH_ENV'];

const STEP = {
  audit: 'Audit dependencies',
  suite: 'Security script specs',
  range: 'Require usable secret scan range',
  scan: 'Secret scanning (trufflehog)',
  enforce: 'Enforce security scan outcomes',
};
const SCANNER_IDS = {
  audit: 'dependency_audit',
  suite: 'security_suite',
  range: 'secret_scan_range',
  scan: 'secret_scan',
};

// ---------------------------------------------------------------------------
// A deliberately small reader for the one job shape this file governs: a job
// at two spaces, `steps:` at four, `- key:` at six, step keys at eight and
// their nested maps or block scalars at ten. Full-line comments are dropped
// (so a commented-out command never satisfies the contract) and a trailing
// ` # ...` is stripped from plain scalars, as YAML does.

function jobRange(lines, jobId) {
  const start = lines.findIndex((line) => new RegExp(`^  ${jobId}:\\s*(#.*)?$`).test(line));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (/^  [A-Za-z_][\w-]*:\s*(#.*)?$/.test(line) || /^[^\s#]/.test(line)) break;
    end += 1;
  }
  return { start, end };
}

function jobText(workflow, jobId) {
  const lines = workflow.split('\n');
  const range = jobRange(lines, jobId);
  return range ? lines.slice(range.start, range.end).join('\n') : null;
}

function replaceJob(workflow, jobId, transform) {
  const lines = workflow.split('\n');
  const range = jobRange(lines, jobId);
  if (!range) return workflow;
  const job = lines.slice(range.start, range.end).join('\n');
  return [...lines.slice(0, range.start), transform(job), ...lines.slice(range.end)].join('\n');
}

function scalar(raw) {
  if (raw === undefined) return '';
  const value = raw.trim();
  const quoted = value.match(/^(['"])(.*)\1(\s+#.*)?$/);
  if (quoted) return quoted[2];
  return value.replace(/\s+#.*$/, '').trim();
}

// The job's own keys, at four spaces, wherever they stand relative to
// `steps:`. Any other line at four spaces or less is one this reader cannot
// read (a quoted key, a flow mapping, a merge key) and is reported.
function parseJobHeader(job) {
  const keys = {};
  const unparsed = [];
  let key = null;
  for (const line of job.split('\n').slice(1)) {
    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    const indent = line.length - line.trimStart().length;
    if (indent > 4) {
      if (key) keys[key].block.push(line.trim());
      continue;
    }
    const match = line.match(/^    ([A-Za-z_][\w-]*):(?:\s+(.*))?$/);
    if (!match) {
      unparsed.push(line.trim());
      key = null;
      continue;
    }
    key = match[1];
    keys[key] = { inline: scalar(match[2]), block: [] };
  }
  return { keys, unparsed };
}

// The workflow's top-level `env:` region, comments dropped.
function workflowEnvText(workflow) {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => /^env\s*:/.test(line));
  if (start < 0) return '';
  const region = [lines[start]];
  for (const line of lines.slice(start + 1)) {
    if (/^[^\s#]/.test(line)) break;
    if (!/^\s*#/.test(line)) region.push(line);
  }
  return region.join('\n');
}

function parseStepsDetailed(job) {
  const lines = job.split('\n');
  const start = lines.findIndex((line) => /^    steps:\s*(#.*)?$/.test(line));
  if (start < 0) return { steps: [], unparsed: [] };
  const raws = [];
  const unparsed = [];
  let step = null;
  let key = null;
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    const indent = line.length - line.trimStart().length;
    if (indent < 6) break;
    const head = line.match(/^      - ([A-Za-z_][\w-]*):(?:\s+(.*))?$/);
    const field = line.match(/^        ([A-Za-z_][\w-]*):(?:\s+(.*))?$/);
    if (head) {
      step = { inline: {}, block: {} };
      raws.push(step);
      key = head[1];
      step.inline[key] = scalar(head[2]);
      step.block[key] = [];
    } else if (step && field) {
      key = field[1];
      step.inline[key] = scalar(field[2]);
      step.block[key] = [];
    } else if (step && key && indent >= 10) {
      step.block[key].push(line.slice(10));
    } else {
      // A quoted key (`"continue-on-error": true`), a flow-mapping step, or
      // an indent this reader does not know: never silently ignored.
      unparsed.push(line.trim());
    }
  }
  const steps = raws.map((raw) => {
    const value = (name) => {
      if (!(name in raw.inline)) return undefined;
      const inline = raw.inline[name];
      if (inline === '' || /^[|>][+-]?$/.test(inline)) return raw.block[name].join('\n');
      return inline;
    };
    const map = (name) =>
      Object.fromEntries(
        (raw.block[name] || [])
          .map((line) => line.match(/^([A-Za-z_][\w-]*):(?:\s+(.*))?$/))
          .filter(Boolean)
          .map((match) => [match[1], scalar(match[2])]),
      );
    return {
      keys: Object.keys(raw.inline),
      name: value('name'),
      id: value('id'),
      if: value('if'),
      uses: value('uses'),
      run: value('run'),
      shell: value('shell'),
      continueOnError: value('continue-on-error'),
      with: map('with'),
      env: map('env'),
    };
  });
  return { steps, unparsed };
}

function parseSteps(job) {
  return parseStepsDetailed(job).steps;
}

function commands(run) {
  return (run || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Executing the three deciding shell steps exactly as GitHub runs them:
// `shell: bash` is `bash --noprofile --norc -eo pipefail {0}`, and a step with
// no shell on Linux is `bash -e {0}`.

const SHELL_BASH = ['--noprofile', '--norc', '-eo', 'pipefail'];
const SHELL_DEFAULT = ['-e'];

let scratchDir = null;
let scriptCounter = 0;
function scratch() {
  scratchDir ??= fs.mkdtempSync(path.join(os.tmpdir(), 'secret-scan-contract-'));
  return scratchDir;
}
function scratchFile(prefix) {
  scriptCounter += 1;
  return path.join(scratch(), `${prefix}-${scriptCounter}`);
}
after(() => {
  if (scratchDir) fs.rmSync(scratchDir, { recursive: true, force: true });
});

const BASE_ENV = () => ({
  PATH: process.env.PATH,
  HOME: scratch(),
  LC_ALL: 'C',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
});

function runBash(script, { cwd, env, shell = SHELL_BASH }) {
  const file = `${scratchFile('step')}.sh`;
  fs.writeFileSync(file, `${script}\n`);
  const result = spawnSync('bash', [...shell, file], {
    cwd,
    env: { ...BASE_ENV(), ...env },
    encoding: 'utf8',
    timeout: 20_000,
  });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

let fixture = null;
function rangeFixture() {
  if (fixture) return fixture;
  const dir = path.join(scratch(), 'repo');
  fs.mkdirSync(dir);
  const git = (...args) => {
    const result = spawnSync(
      'git',
      ['-c', 'user.name=contract', '-c', 'user.email=contract@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args],
      { cwd: dir, env: BASE_ENV(), encoding: 'utf8' },
    );
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    return result.stdout.trim();
  };
  git('init', '-q');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  git('add', 'a.txt');
  git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n');
  git('add', 'b.txt');
  git('commit', '-q', '-m', 'change');
  const head = git('rev-parse', 'HEAD');
  git('commit', '-q', '--allow-empty', '-m', 'empty');
  const empty = git('rev-parse', 'HEAD');
  // A secret added and then reverted: two commits to scan, no net change.
  fs.writeFileSync(path.join(dir, 'leaked.env'), 'TOKEN=not-a-real-token\n');
  git('add', 'leaked.env');
  git('commit', '-q', '-m', 'add leaked.env');
  git('rm', '-q', 'leaked.env');
  git('commit', '-q', '-m', 'revert leaked.env');
  const reverted = git('rev-parse', 'HEAD');
  // A merge whose tree equals its first parent: both sides add the same file.
  git('checkout', '-q', '-b', 'side');
  fs.writeFileSync(path.join(dir, 'c.txt'), 'c\n');
  git('add', 'c.txt');
  git('commit', '-q', '-m', 'side adds c');
  git('checkout', '-q', 'main');
  fs.writeFileSync(path.join(dir, 'c.txt'), 'c\n');
  git('add', 'c.txt');
  git('commit', '-q', '-m', 'main adds c');
  const mainTip = git('rev-parse', 'HEAD');
  git('merge', '-q', '--no-ff', '--no-edit', 'side');
  const merge = git('rev-parse', 'HEAD');
  fixture = { dir, base, head, empty, reverted, mainTip, merge };
  return fixture;
}

function rangeCases() {
  const f = rangeFixture();
  return [
    { name: 'usable range', env: { SCAN_BASE: f.base, SCAN_HEAD: f.head }, pass: true },
    // TruffleHog scans the commits, so a range is usable when any commit in
    // it touches a file, whatever the net tree difference.
    { name: 'net-zero range (a file added, then removed)', env: { SCAN_BASE: f.empty, SCAN_HEAD: f.reverted }, pass: true },
    { name: 'merge whose tree equals its first parent', env: { SCAN_BASE: f.mainTip, SCAN_HEAD: f.merge }, pass: true },
    { name: 'all-zero push base', env: { SCAN_BASE: ZERO_SHA, SCAN_HEAD: f.head }, error: /^::error::.*zero/im },
    { name: 'missing base', env: { SCAN_BASE: '', SCAN_HEAD: f.head } },
    { name: 'missing head', env: { SCAN_BASE: f.base, SCAN_HEAD: '' } },
    { name: 'unknown base commit', env: { SCAN_BASE: 'f'.repeat(40), SCAN_HEAD: f.head } },
    { name: 'unknown head commit', env: { SCAN_BASE: f.base, SCAN_HEAD: 'e'.repeat(40) } },
    { name: 'empty commit difference', env: { SCAN_BASE: f.head, SCAN_HEAD: f.empty } },
    { name: 'base equals head', env: { SCAN_BASE: f.head, SCAN_HEAD: f.head } },
  ];
}

const behaviourMemo = new Map();
function memo(key, compute) {
  if (!behaviourMemo.has(key)) behaviourMemo.set(key, compute());
  return behaviourMemo.get(key);
}

function rangeBehaviourProblems(run) {
  return memo(`range\0${run}`, () => {
    const problems = [];
    for (const c of rangeCases()) {
      const result = runBash(run, { cwd: rangeFixture().dir, env: c.env });
      if (c.pass) {
        if (result.status !== 0) problems.push(`scan-range preflight: refuses a ${c.name} (exit ${result.status})`);
      } else if (result.status === 0) {
        problems.push(`scan-range preflight: accepts an unusable range (${c.name})`);
      } else if (!/^::error::/m.test(result.stdout)) {
        problems.push(`scan-range preflight: ${c.name} fails without an ::error annotation`);
      } else if (c.error && !c.error.test(result.stdout)) {
        problems.push(`scan-range preflight: ${c.name} needs its own explicit ::error`);
      }
    }
    return problems;
  });
}

// The audit step under GitHub's default shell, against a stand-in `pnpm` that
// records its arguments and exits as told.
function fakePnpmDir() {
  const dir = path.join(scratch(), 'fake-pnpm');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, 'pnpm'),
      '#!/usr/bin/env bash\nprintf \'%s\\n\' "$*" > "$FAKE_PNPM_ARGS"\nexit "${FAKE_PNPM_EXIT:-0}"\n',
      { mode: 0o755 },
    );
  }
  return dir;
}

function runAuditStep(run, pnpmExit) {
  const output = scratchFile('audit-output');
  const args = scratchFile('audit-args');
  fs.writeFileSync(output, '');
  const result = runBash(run, {
    cwd: scratch(),
    shell: SHELL_DEFAULT,
    env: {
      PATH: `${fakePnpmDir()}${path.delimiter}${process.env.PATH}`,
      GITHUB_OUTPUT: output,
      FAKE_PNPM_EXIT: String(pnpmExit),
      FAKE_PNPM_ARGS: args,
    },
  });
  return {
    ...result,
    output: fs.readFileSync(output, 'utf8'),
    args: fs.existsSync(args) ? fs.readFileSync(args, 'utf8').trim() : null,
  };
}

function auditBehaviourProblems(run) {
  return memo(`audit\0${run}`, () => {
    const problems = new Set();
    for (const exit of [0, 1]) {
      const result = runAuditStep(run, exit);
      if (result.args !== 'audit --audit-level high') problems.add(`dependency audit: does not run \`${AUDIT}\``);
      if (result.status !== 0) {
        problems.add('dependency audit: the step fails with the audit (D-22 does not make the audit blocking; record it)');
      }
      if (!new RegExp(`^exit_code=${exit}$`, 'm').test(result.output)) {
        problems.add(`dependency audit: pnpm audit exit ${exit} is not recorded as the exit_code output`);
      }
    }
    return [...problems];
  });
}

const BAD_OUTCOMES = ['failure', 'skipped', 'cancelled'];

function outcomeEnv(step) {
  const byStep = {};
  for (const [name, value] of Object.entries(step.env)) {
    const match = value.match(/^\$\{\{\s*steps\.([\w-]+)\.outcome\s*\}\}$/);
    if (match) byStep[match[1]] = name;
  }
  return byStep;
}

function auditExitEnv(step) {
  const found = Object.entries(step.env).find(([, value]) =>
    /^\$\{\{\s*steps\.dependency_audit\.outputs\.exit_code\s*\}\}$/.test(value),
  );
  return found ? found[0] : null;
}

function runEnforceStep(step, outcomes = {}, auditExit = '0') {
  const summary = scratchFile('step-summary');
  const env = Object.fromEntries(Object.entries(outcomeEnv(step)).map(([id, name]) => [name, outcomes[id] ?? 'success']));
  const exitName = auditExitEnv(step);
  if (exitName) env[exitName] = auditExit;
  env.GITHUB_STEP_SUMMARY = summary;
  const result = runBash(step.run, { cwd: scratch(), env });
  return { ...result, summary: fs.existsSync(summary) ? fs.readFileSync(summary, 'utf8') : '' };
}

function enforceBehaviourProblems(step) {
  return memo(`enforce\0${step.run}\0${JSON.stringify(outcomeEnv(step))}\0${auditExitEnv(step)}`, () => {
    const problems = [];
    const green = runEnforceStep(step);
    if (green.status !== 0) problems.push('outcome enforcement: fails although every scanner succeeded');
    else if (/^::(error|warning)::/m.test(green.stdout)) problems.push('outcome enforcement: annotates a run where every scanner succeeded');
    for (const id of Object.values(SCANNER_IDS)) {
      for (const outcome of BAD_OUTCOMES) {
        const result = runEnforceStep(step, { [id]: outcome });
        if (result.status === 0 || !/^::error::/m.test(result.stdout)) {
          problems.push(`outcome enforcement: ${id}=${outcome} is not re-raised as an ::error`);
        }
      }
    }
    // The audit ran and found advisories: recorded, not enforced.
    const advisory = runEnforceStep(step, {}, '1');
    if (advisory.status !== 0 || /^::error::/m.test(advisory.stdout)) {
      problems.push('outcome enforcement: a failing dependency audit fails the job (D-22 does not make the audit blocking; record it)');
    }
    if (!/^::warning::.*dependency_audit/m.test(advisory.stdout) || !/exited 1\b/.test(advisory.summary)) {
      problems.push('outcome enforcement: a failing dependency audit is not recorded as a ::warning and in the step summary');
    }
    if (!/^dependency_audit_exit_code=1$/m.test(advisory.stdout)) {
      problems.push('outcome enforcement: the dependency audit exit code is not in the log');
    }
    // The audit step reported success but recorded nothing: the capture broke.
    const unrecorded = runEnforceStep(step, {}, '');
    if (unrecorded.status === 0 || !/^::error::/m.test(unrecorded.stdout)) {
      problems.push('outcome enforcement: an audit step that recorded no exit code is not an ::error');
    }
    return problems;
  });
}

// ---------------------------------------------------------------------------

function securityContractProblems(workflow, pkg = packageSource) {
  const problems = [];
  const job = jobText(workflow, 'security-scan');
  if (!job) return ['missing security-scan job'];
  const { steps, unparsed } = parseStepsDetailed(job);

  // A job-level `if` skips the job, and GitHub reports a skipped job as
  // success even for a required check; job-level continue-on-error, env or
  // defaults neuter it while every step reports success.
  const header = parseJobHeader(job);
  for (const key of Object.keys(header.keys)) {
    if (!JOB_KEYS.includes(key)) {
      problems.push(`job-level ${key} on security-scan (it may set only ${JOB_KEYS.join(', ')}: a skipped or neutered job reports success)`);
    }
  }
  for (const line of header.unparsed) problems.push(`security-scan job line this contract cannot read: ${line}`);
  for (const key of ['name', 'runs-on', 'steps']) {
    if (!header.keys[key]) problems.push(`security-scan job has no ${key}`);
  }
  const permissions = header.keys.permissions;
  if (!permissions || permissions.inline !== '' || permissions.block.join('\n') !== JOB_PERMISSIONS.join('\n')) {
    problems.push('security-scan must declare permissions: contents: read (the scanner container mounts the whole checkout)');
  }

  // Workflow-level settings reach every step of this job.
  if (workflow.split('\n').some((line) => /^defaults\s*:/.test(line))) {
    problems.push('workflow-level defaults change the shell or directory of every scanner step');
  }
  const workflowEnv = workflowEnvText(workflow);
  for (const name of NEUTERING_WORKFLOW_ENV) {
    if (new RegExp(`\\b${name}\\b`).test(workflowEnv)) {
      problems.push(`workflow-level env sets ${name}, which reaches every scanner step (NODE_TEST_CONTEXT=child makes node --test run nothing and pass)`);
    }
  }

  for (const line of unparsed) problems.push(`security-scan step line this contract cannot read: ${line}`);
  for (const step of steps) {
    if (/\bGITHUB_(ENV|PATH)\b/.test(step.run || '')) {
      problems.push(`'${step.name || step.uses}' writes GITHUB_ENV or GITHUB_PATH, which reaches every scanner step after it`);
    }
  }

  const onlyKeys = (step, label) => {
    const extra = step.keys.filter((key) => !STEP_KEYS[label].includes(key));
    if (extra.length) {
      problems.push(`'${step.name || step.uses}' may not set ${extra.join(', ')} (it may set only ${STEP_KEYS[label].join(', ')})`);
    }
  };
  const find = (label) => {
    const found = steps.filter((step) => step.name === STEP[label]);
    if (found.length !== 1) {
      problems.push(`expected exactly one '${STEP[label]}' step, found ${found.length}`);
      return null;
    }
    const step = found[0];
    if (SCANNER_IDS[label] && step.id !== SCANNER_IDS[label]) {
      problems.push(`'${STEP[label]}' must have id ${SCANNER_IDS[label]}`);
    }
    if (STEP_KEYS[label]) onlyKeys(step, label);
    if (STEP_IF[label] !== undefined && step.if !== STEP_IF[label]) {
      problems.push(
        label === 'scan'
          ? 'the scanner must not run on a range the preflight refused'
          : `'${STEP[label]}' must run with exactly if: ${STEP_IF[label]}`,
      );
    }
    return step;
  };

  // D-22: nothing in this job may swallow a failure.
  for (const step of steps) {
    if (step.continueOnError !== undefined && step.continueOnError !== 'false') {
      problems.push(`continue-on-error on '${step.name || step.uses}' (D-22: the security scans block)`);
    }
  }

  const checkouts = steps.filter((step) => (step.uses || '').startsWith('actions/checkout@'));
  if (checkouts.length > 1) problems.push(`expected exactly one checkout step, found ${checkouts.length}`);
  const checkout = checkouts[0];
  if (!checkout || checkout.with['fetch-depth'] !== '0') {
    problems.push('checkout must fetch full commit history (fetch-depth: 0)');
  }
  if (!checkout || checkout.with['persist-credentials'] !== 'false') {
    problems.push('checkout must not leave the job token in .git/config (persist-credentials: false): the scanner container mounts the checkout');
  }
  if (checkout) {
    onlyKeys(checkout, 'checkout');
    const extra = Object.keys(checkout.with).filter((key) => !['fetch-depth', 'persist-credentials'].includes(key));
    if (extra.length) problems.push(`checkout may not set ${extra.join(', ')}`);
  }

  const audit = find('audit');
  if (audit) {
    if (JSON.stringify(commands(audit.run)) !== JSON.stringify(AUDIT_CAPTURE)) {
      problems.push(`dependency audit must run exactly \`${AUDIT}\` and record its exit code as the exit_code output`);
    }
    if (audit.run) problems.push(...auditBehaviourProblems(audit.run));
  }

  const suite = find('suite');
  if (suite) {
    const lines = commands(suite.run);
    if (lines.length !== 1 || lines[0] !== SECURITY_SUITE) {
      problems.push(`missing executable security suite: the step must run exactly \`${SECURITY_SUITE}\``);
    }
  }
  for (const step of steps) {
    for (const line of commands(step.run)) {
      if (/node\s+--test\s+(\.\/)?scripts\/security\/tests\/?(\s|$)/.test(line)) {
        problems.push('bare-directory node --test runs zero specs on Node 20 and fails on Node 22');
      }
    }
  }

  const range = find('range');
  if (range) {
    for (const [label, variable, expression] of [
      ['base event SHA', 'SCAN_BASE', 'github.event.pull_request.base.sha'],
      ['push before SHA', 'SCAN_BASE', 'github.event.before'],
      ['head event SHA', 'SCAN_HEAD', 'github.event.pull_request.head.sha'],
      ['push head SHA', 'SCAN_HEAD', 'github.sha'],
    ]) {
      if (!(range.env[variable] || '').includes(expression)) problems.push(`missing scan preflight: ${label}`);
    }
    const envKeys = Object.keys(range.env).sort();
    if (
      envKeys.join(',') !== Object.keys(RANGE_ENV).sort().join(',') ||
      envKeys.some((key) => range.env[key] !== RANGE_ENV[key])
    ) {
      problems.push(`scan preflight env must be exactly ${JSON.stringify(RANGE_ENV)}`);
    }
    const run = range.run || '';
    if (range.shell !== 'bash') problems.push('scan preflight must declare shell: bash');
    if (run.includes('${{')) problems.push('scan preflight must read the SHAs from env, never inline expressions');
    for (const [label, needle] of [
      ['commit existence guard (base)', 'git cat-file -e "$SCAN_BASE^{commit}"'],
      ['commit existence guard (head)', 'git cat-file -e "$SCAN_HEAD^{commit}"'],
      ['guard on the files the range commits touch', RANGE_FILES],
      ['all-zero push base rejection', ZERO_SHA],
    ]) {
      if (!run.includes(needle)) problems.push(`missing scan preflight: ${label}`);
    }
    if (run) problems.push(...rangeBehaviourProblems(run));
  }

  const scan = find('scan');
  if (!scan) return [...problems, 'missing TruffleHog step'];
  if (scan.uses !== SCANNER_ACTION) problems.push(`scanner action must be pinned to the v3.99.7 tag commit (${SCANNER_ACTION})`);
  if (scan.with.version !== SCANNER_VERSION) {
    problems.push(`scanner CLI image must be pinned to 3.99.7 by digest (version: '${SCANNER_VERSION}')`);
  }
  if ('base' in scan.with || 'head' in scan.with) {
    problems.push('hardcoded TruffleHog refs override event-specific commit SHA discovery');
  }
  if ('image' in scan.with) problems.push('the scanner image may not be overridden (it gets the whole checkout mounted)');
  if (scan.with.path !== SCANNER_WITH.path) problems.push(`the scanner must scan the whole checkout (path: ${SCANNER_WITH.path})`);
  const extraInputs = Object.keys(scan.with).filter((key) => !(key in SCANNER_WITH));
  if (extraInputs.length) problems.push(`scanner may not set inputs ${extraInputs.join(', ')}`);
  // Inspect the actual CLI arguments, never comments.
  const extraArgs = scan.with.extra_args;
  if (extraArgs === undefined) problems.push('missing scanner extra_args');
  const args = (extraArgs || '').split(/\s+/).filter(Boolean);
  if (!args.includes('--fail-on-scan-errors')) problems.push('scan-source errors must fail the job');
  if (!args.includes('--only-verified')) problems.push('verified-only scan must remain explicit');
  // The pinned action injects --fail; adding it again aborts before any scan.
  if (args.includes('--fail')) problems.push('duplicate --fail aborts scan');
  // Anything else narrows the scan (--exclude-*), or, with --only-verified,
  // stops it reporting at all (--no-verification).
  if (args.join(' ') !== SCANNER_WITH.extra_args) {
    problems.push(`scanner extra_args must be exactly \`${SCANNER_WITH.extra_args}\``);
  }

  const enforce = find('enforce');
  if (enforce) {
    if (!/^(\$\{\{\s*)?always\(\)(\s*\}\})?$/.test(enforce.if || '')) {
      problems.push('outcome enforcement must run with if: always()');
    }
    if (enforce.shell !== 'bash') problems.push('outcome enforcement must declare shell: bash');
    if ((enforce.run || '').includes('${{')) problems.push('outcome enforcement must read outcomes from env');
    const byStep = outcomeEnv(enforce);
    for (const id of Object.values(SCANNER_IDS)) {
      if (!byStep[id]) problems.push(`outcome enforcement does not read steps.${id}.outcome`);
    }
    if (!auditExitEnv(enforce)) problems.push('outcome enforcement does not read steps.dependency_audit.outputs.exit_code');
    const enforceAt = steps.indexOf(enforce);
    for (const label of Object.keys(SCANNER_IDS)) {
      const at = steps.findIndex((step) => step.name === STEP[label]);
      if (at > enforceAt) problems.push(`outcome enforcement runs before '${STEP[label]}'`);
    }
    if (enforce.run) problems.push(...enforceBehaviourProblems(enforce));
    else problems.push('outcome enforcement has no run script');
  }

  let scripts = null;
  try {
    scripts = JSON.parse(pkg).scripts || {};
  } catch {
    problems.push('root package.json does not parse');
  }
  if (scripts && scripts['test:security'] !== SECURITY_SUITE) {
    problems.push(`root package.json test:security must run exactly \`${SECURITY_SUITE}\``);
  }
  return problems;
}

// The job as it stood at 0796a728 (ci-cd.yml:187-219).
const PRE_V1_01_JOB = `  security-scan:
    name: Security Scan
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v3
        with:
          version: \${{ env.PNPM_VERSION }}

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: \${{ env.NODE_VERSION }}
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Audit dependencies
        run: pnpm audit --audit-level high
        continue-on-error: true

      - name: Secret scanning (trufflehog)
        uses: trufflesecurity/trufflehog@main
        with:
          path: ./
          base: main
          head: HEAD
          extra_args: --debug --only-verified
        continue-on-error: true
`;

// #114 (impl/kf-meta-proof-integrity-001) on its own: outcomes captured, but
// still continue-on-error, still @main with base: main.
const PR_114_ALONE_JOB = PRE_V1_01_JOB.replace(
  `      - name: Audit dependencies
        run: pnpm audit --audit-level high
        continue-on-error: true

      - name: Secret scanning (trufflehog)
        uses: trufflesecurity/trufflehog@main
        with:
          path: ./
          base: main
          head: HEAD
          extra_args: --debug --only-verified
        continue-on-error: true
`,
  `      - name: Audit dependencies
        id: dependency_audit
        continue-on-error: true
        run: pnpm audit --audit-level high

      - name: Secret scanning (trufflehog)
        id: secret_scan
        continue-on-error: true
        uses: trufflesecurity/trufflehog@main
        with:
          path: ./
          base: main
          head: HEAD
          extra_args: --debug --only-verified

      - name: Enforce security scan outcomes
        if: always()
        env:
          DEPENDENCY_AUDIT_OUTCOME: \${{ steps.dependency_audit.outcome }}
          SECRET_SCAN_OUTCOME: \${{ steps.secret_scan.outcome }}
        run: |
          echo "dependency_audit=$DEPENDENCY_AUDIT_OUTCOME"
          echo "secret_scan=$SECRET_SCAN_OUTCOME"
          if [ "$DEPENDENCY_AUDIT_OUTCOME" != "success" ] || [ "$SECRET_SCAN_OUTCOME" != "success" ]; then
            echo "::error::Security Scan failed: every required scanner must execute successfully."
            exit 1
          fi
`,
);

function inJob(transform) {
  return replaceJob(source, 'security-scan', transform);
}

function moveEnforceBeforeAudit(job) {
  const marker = `      - name: ${STEP.enforce}\n`;
  const at = job.indexOf(marker);
  if (at < 0) return job;
  const enforceBlock = `${job.slice(at).replace(/\n*$/, '')}\n\n`;
  const without = job.slice(0, at).replace(/\n*$/, '\n');
  return without.replace(`      - name: ${STEP.audit}\n`, `${enforceBlock}      - name: ${STEP.audit}\n`);
}

function withPackageScript(value) {
  const parsed = JSON.parse(packageSource);
  if (value === undefined) delete parsed.scripts['test:security'];
  else parsed.scripts['test:security'] = value;
  return JSON.stringify(parsed, null, 2);
}

test('security-scan job on the actual workflow blocks on the secret scan (D-22) and records the dependency audit', () => {
  assert.deepEqual(securityContractProblems(source), []);
});

test('scan-range preflight fails closed with an ::error for each unusable range', () => {
  const range = parseSteps(jobText(source, 'security-scan') || '').find((step) => step.name === STEP.range);
  assert.ok(range && range.run, `missing '${STEP.range}' step`);
  for (const c of rangeCases()) {
    const result = runBash(range.run, { cwd: rangeFixture().dir, env: c.env });
    if (c.pass) {
      assert.equal(result.status, 0, `${c.name} must pass: ${result.stdout}${result.stderr}`);
      continue;
    }
    assert.notEqual(result.status, 0, `${c.name} must fail`);
    assert.match(result.stdout, /^::error::/m, `${c.name} must emit an ::error annotation`);
    if (c.error) assert.match(result.stdout, c.error, `${c.name} must name its own cause`);
  }
});

test('outcome enforcement re-raises every scanner outcome, including the dependency audit', () => {
  const enforce = parseSteps(jobText(source, 'security-scan') || '').find((step) => step.name === STEP.enforce);
  assert.ok(enforce && enforce.run, `missing '${STEP.enforce}' step`);
  assert.equal(enforce.if, 'always()');
  assert.equal(enforce.env.DEPENDENCY_AUDIT_OUTCOME, '${{ steps.dependency_audit.outcome }}');
  assert.deepEqual(enforceBehaviourProblems(enforce), []);
  const byStep = outcomeEnv(enforce);
  const env = Object.fromEntries(Object.values(byStep).map((name) => [name, 'success']));
  env[byStep.dependency_audit] = 'failure';
  const result = runBash(enforce.run, { cwd: scratch(), env });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /^dependency_audit=failure$/m, 'the outcome is recorded in the log');
  assert.match(result.stdout, /^::error::.*dependency_audit/m);
});

test('the dependency audit is recorded on every run, as a ::warning, without failing the job (D-22 names the secret scan, not the audit)', () => {
  const steps = parseSteps(jobText(source, 'security-scan') || '');
  const audit = steps.find((step) => step.name === STEP.audit);
  const enforce = steps.find((step) => step.name === STEP.enforce);
  assert.ok(audit && audit.run, `missing '${STEP.audit}' step`);
  assert.ok(enforce && enforce.run, `missing '${STEP.enforce}' step`);
  assert.equal(enforce.env.DEPENDENCY_AUDIT_EXIT_CODE, '${{ steps.dependency_audit.outputs.exit_code }}');

  // The audit step runs pnpm audit and records its exit code, whatever it is.
  for (const exit of [0, 1]) {
    const step = runAuditStep(audit.run, exit);
    assert.equal(step.status, 0, `the audit step itself passes when pnpm audit exits ${exit}: ${step.stderr}`);
    assert.equal(step.args, 'audit --audit-level high');
    assert.match(step.output, new RegExp(`^exit_code=${exit}$`, 'm'));
  }

  // Advisories found: a warning in the log and the step summary, job green.
  const advisory = runEnforceStep(enforce, {}, '1');
  assert.equal(advisory.status, 0, advisory.stdout);
  assert.doesNotMatch(advisory.stdout, /^::error::/m);
  assert.match(advisory.stdout, /^dependency_audit_exit_code=1$/m);
  assert.match(advisory.stdout, /^::warning::.*dependency_audit.*exited 1/m);
  assert.match(advisory.summary, /exited 1: recorded, not enforced/);

  // No advisories: no annotation at all.
  const clean = runEnforceStep(enforce, {}, '0');
  assert.equal(clean.status, 0, clean.stdout);
  assert.doesNotMatch(clean.stdout, /^::(error|warning)::/m);

  // The audit step succeeded but recorded nothing: the capture broke, so fail.
  const unrecorded = runEnforceStep(enforce, {}, '');
  assert.notEqual(unrecorded.status, 0);
  assert.match(unrecorded.stdout, /^::error::.*dependency audit.*no usable exit code/m);
});

test('the CI glob and test:security cover this contract and the R0-31 no-committed-credential spec', () => {
  const specs = fs.readdirSync(SUITE_DIR).filter((file) => file.endsWith('.spec.mjs'));
  for (const required of ['secret-scan-contract.spec.mjs', 'no-committed-credential.spec.mjs']) {
    assert.ok(specs.includes(required), `${required} must be in scripts/security/tests`);
  }
  assert.equal(JSON.parse(packageSource).scripts['test:security'], SECURITY_SUITE);
});

test('negative controls: restoring any old false-green mechanism makes the contract fail', () => {
  const zeroGuard = /          if \[ "\$SCAN_BASE" = "0{40}" \]; then\n[\s\S]*?\n          fi\n/;
  const versionLine = `          version: '${SCANNER_VERSION}'\n`;
  const auditId = '        id: dependency_audit\n';
  const suiteRun = `        run: ${SECURITY_SUITE}\n`;
  const runsOn = '    runs-on: ubuntu-latest\n';
  const mutations = [
    ['shallow checkout', inJob((job) => job.replace('          fetch-depth: 0\n', '          fetch-depth: 1\n'))],
    ['default checkout depth', inJob((job) => job.replace('          fetch-depth: 0\n', ''))],
    ['hardcoded base', inJob((job) => job.replace(versionLine, `          base: main\n${versionLine}`))],
    ['hardcoded head', inJob((job) => job.replace(versionLine, `          head: HEAD\n${versionLine}`))],
    ['swallowed scan failure', inJob((job) => job.replace('          extra_args: --only-verified --fail-on-scan-errors\n', '          extra_args: --only-verified --fail-on-scan-errors\n        continue-on-error: true\n'))],
    ['swallowed audit capture failure', inJob((job) => job.replace(auditId, `${auditId}        continue-on-error: true\n`))],
    ['audit failure masked in shell', inJob((job) => job.replace(`${AUDIT} || audit_exit=$?`, `${AUDIT} || true`))],
    ['audit level lowered', inJob((job) => job.replace(`${AUDIT} ||`, 'pnpm audit --audit-level critical ||'))],
    ['audit result not recorded', inJob((job) => job.replace('          echo "exit_code=$audit_exit" >> "$GITHUB_OUTPUT"\n', ''))],
    // CR-V101-1: a blocking audit turns the required pipeline red at every
    // head until every advisory is cleared, without a ruling that it blocks.
    ['audit made blocking in its step', inJob((job) => job.replace(/        run: \|\n          audit_exit=0\n.*\n.*\n/, `        run: ${AUDIT}\n`))],
    ['audit made blocking in the enforcement', inJob((job) => job.replace(/^( *)echo "::warning::.*\n/m, '$1status=1\n'))],
    ['audit verdict dropped', inJob((job) => job.replace(/^ *echo "::warning::.*\n/m, ''))],
    ['enforcement unmapped from the audit exit code', inJob((job) => job.replace('${{ steps.dependency_audit.outputs.exit_code }}', "${{ '0' }}"))],
    ['swallowed suite failure', inJob((job) => job.replace(suiteRun, `${suiteRun}        continue-on-error: true\n`))],
    ['scan error ignored', inJob((job) => job.replace('--only-verified --fail-on-scan-errors', '--only-verified'))],
    ['duplicate --fail', inJob((job) => job.replace('--only-verified --fail-on-scan-errors', '--only-verified --fail --fail-on-scan-errors'))],
    ['verified filtering omitted', inJob((job) => job.replace('--only-verified --fail-on-scan-errors', '--fail-on-scan-errors'))],
    // SEC-V101-3: anything added to the scanner arguments, or a narrowed path.
    ['verification disabled', inJob((job) => job.replace('--only-verified --fail-on-scan-errors', '--only-verified --fail-on-scan-errors --no-verification'))],
    ['detectors excluded', inJob((job) => job.replace('--only-verified --fail-on-scan-errors', '--only-verified --fail-on-scan-errors --exclude-detectors=aws'))],
    ['paths excluded', inJob((job) => job.replace('--only-verified --fail-on-scan-errors', '--only-verified --fail-on-scan-errors --exclude-paths=.trufflehogignore'))],
    ['scan path narrowed', inJob((job) => job.replace('          path: ./\n', '          path: ./docs\n'))],
    ['floating action', inJob((job) => job.replace(SCANNER_ACTION, 'trufflesecurity/trufflehog@main'))],
    ['untagged commit pin', inJob((job) => job.replace(SCANNER_ACTION, UNTAGGED_PIN))],
    ['floating CLI image', inJob((job) => job.replace(versionLine, '          version: latest\n'))],
    // SEC-V101-2: the image the action runs, and what it can reach.
    ['CLI image pinned by tag only', inJob((job) => job.replace(versionLine, "          version: '3.99.7'\n"))],
    ['CLI image overridden', inJob((job) => job.replace(versionLine, `${versionLine}          image: ghcr.io/someone-else/not-trufflehog\n`))],
    ['scanner step env', inJob((job) => job.replace(`        uses: ${SCANNER_ACTION}`, `        env:\n          DOCKER_HOST: tcp://127.0.0.1:2375\n        uses: ${SCANNER_ACTION}`))],
    ['job token persisted in the checkout', inJob((job) => job.replace('          persist-credentials: false\n', ''))],
    ['job token scope widened', inJob((job) => job.replace('      contents: read\n', '      contents: write\n'))],
    ['job token scope undeclared', inJob((job) => job.replace('    permissions:\n      contents: read\n', ''))],
    ['scan runs on a refused range', inJob((job) => job.replace(" && steps.secret_scan_range.outcome == 'success'", ''))],
    ['no all-zero base rejection', inJob((job) => job.replace(zeroGuard, ''))],
    ['no commit existence check', inJob((job) => job.replaceAll('git cat-file -e', 'true'))],
    ['no nonempty check', inJob((job) => job.replace(RANGE_FILES, 'git status --porcelain'))],
    // CR-V101-2: the tree difference refuses a net-zero range of commits.
    ['tree-difference preflight restored', inJob((job) => job.replace(RANGE_FILES, 'git diff --name-only "$SCAN_BASE" "$SCAN_HEAD"'))],
    ['push range dropped', inJob((job) => job.replace(' || github.event.before', ''))],
    ['bare-directory suite', inJob((job) => job.replace(`run: ${SECURITY_SUITE}`, 'run: node --test scripts/security/tests/'))],
    ['suite narrowed to this contract', inJob((job) => job.replace(`run: ${SECURITY_SUITE}`, 'run: node --test scripts/security/tests/secret-scan-contract.spec.mjs'))],
    ['suite commented out', inJob((job) => job.replace(`run: ${SECURITY_SUITE}`, `run: echo skipped # ${SECURITY_SUITE}`))],
    // SEC-V101-1 / CR-V101-3: skipping or neutering the job or a scanner
    // while every step reports success.
    ['job skipped on pull requests', inJob((job) => job.replace(runsOn, `${runsOn}    if: github.event_name == 'push'\n`))],
    ['job if false', inJob((job) => job.replace(runsOn, `${runsOn}    if: \${{ false }}\n`))],
    ['job continue-on-error', inJob((job) => job.replace(runsOn, `${runsOn}    continue-on-error: true\n`))],
    ['job env NODE_TEST_CONTEXT', inJob((job) => job.replace(runsOn, `${runsOn}    env:\n      NODE_TEST_CONTEXT: child\n`))],
    ['job defaults shell', inJob((job) => job.replace(runsOn, `${runsOn}    defaults:\n      run:\n        shell: 'true {0}'\n`))],
    ['job key the reader cannot parse', inJob((job) => job.replace(runsOn, `${runsOn}    'if': \${{ false }}\n`))],
    ['suite env NODE_TEST_CONTEXT', inJob((job) => job.replace(suiteRun, `${suiteRun}        env:\n          NODE_TEST_CONTEXT: child\n`))],
    ['suite shell override', inJob((job) => job.replace(suiteRun, `${suiteRun}        shell: true {0}\n`))],
    ['suite working-directory', inJob((job) => job.replace(suiteRun, `${suiteRun}        working-directory: apps/web\n`))],
    ['audit shell override', inJob((job) => job.replace(auditId, `${auditId}        shell: true {0}\n`))],
    ['audit env', inJob((job) => job.replace(auditId, `${auditId}        env:\n          npm_config_registry: http://127.0.0.1:9\n`))],
    ['audit skipped', inJob((job) => job.replace(auditId, `${auditId}        if: \${{ false }}\n`))],
    ['quoted continue-on-error key', inJob((job) => job.replace(auditId, `${auditId}        "continue-on-error": true\n`))],
    ['suite neutered through GITHUB_ENV', inJob((job) => job.replace('        run: pnpm install --frozen-lockfile\n', '        run: pnpm install --frozen-lockfile && echo NODE_TEST_CONTEXT=child >> "$GITHUB_ENV"\n'))],
    ['workflow env NODE_TEST_CONTEXT', source.replace(/^env:\n/m, 'env:\n  NODE_TEST_CONTEXT: child\n')],
    ['workflow defaults shell', source.replace(/^jobs:\n/m, "defaults:\n  run:\n    shell: 'true {0}'\n\njobs:\n")],
    ['enforcement not always()', inJob((job) => job.replace('        if: always()\n', ''))],
    ['enforcement ignores the dependency audit', inJob((job) => job.replace(/^[ \t]*check dependency_audit .*\n/m, ''))],
    ['enforcement unmapped from the dependency audit', inJob((job) => job.replace('${{ steps.dependency_audit.outcome }}', "${{ 'success' }}"))],
    ['enforcement before the scanners', inJob(moveEnforceBeforeAudit)],
    ['pre-V1-01 job restored', inJob(() => PRE_V1_01_JOB.replace(/\n$/, ''))],
    ['#114 ported alone', inJob(() => PR_114_ALONE_JOB.replace(/\n$/, ''))],
  ];
  for (const [name, mutated] of mutations) {
    assert.notEqual(mutated, source, `${name}: mutation must change the source`);
    assert.notDeepEqual(securityContractProblems(mutated), [], `${name}: restored defect must be detected`);
  }

  const packageMutations = [
    ['package script bare directory', withPackageScript('node --test scripts/security/tests/')],
    ['package script missing', withPackageScript(undefined)],
  ];
  for (const [name, mutatedPackage] of packageMutations) {
    assert.notDeepEqual(securityContractProblems(source, mutatedPackage), [], `${name}: restored defect must be detected`);
  }
});
