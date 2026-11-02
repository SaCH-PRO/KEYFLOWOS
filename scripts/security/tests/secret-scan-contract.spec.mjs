/**
 * Security Scan contract (V1-01-SEC-CREDENTIAL-SECRET-SCAN, PRS-M07).
 *
 * Ports the secret-scan hunk of #189 (this spec started as its contract at
 * 861f5c14) and the dependency-audit outcome capture of #114. Owner ruling
 * D-22 (docs/reconstruction/BUILD-MAP-001.md section (g)) makes the secret
 * scan and the dependency audit blocking: no step of the security-scan job
 * may be continue-on-error.
 *
 * Before this packet the job could never fail: a shallow checkout,
 * trufflehog@main told to scan from a literal `base: main` that a checkout
 * need not contain, and continue-on-error on both the audit and the scan
 * (ci-cd.yml:187-219 at 0796a728).
 *
 * The contract reads the security-scan job of .github/workflows/ci-cd.yml
 * and the root package.json. It checks the step fields statically, and it
 * also EXECUTES the two shell steps that decide the outcome:
 *   - the scan-range preflight, against a throwaway git repository, for a
 *     usable range and for each unusable one (all-zero push base, missing or
 *     unknown endpoint, empty difference);
 *   - the outcome enforcement, once with every scanner green and once for
 *     each scanner failed, skipped or cancelled.
 * The negative controls restore each old false-green mechanism (and the
 * whole pre-V1-01 job, and #114's job ported alone) and require the contract
 * to reject it.
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
const SCANNER_VERSION = '3.99.7';
// An explicit file glob. `node --test scripts/security/tests/` runs ZERO specs
// on Node 20 (a .spec.mjs file in a directory not named `test` matches none
// of its naming rules, and it exits 0) and fails to start on Node 22.
const SECURITY_SUITE = 'node --test scripts/security/tests/*.spec.mjs';
const AUDIT = 'pnpm audit --audit-level high';
const ZERO_SHA = '0'.repeat(40);

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

function parseSteps(job) {
  const lines = job.split('\n');
  const start = lines.findIndex((line) => /^    steps:\s*(#.*)?$/.test(line));
  if (start < 0) return [];
  const raws = [];
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
    }
  }
  return raws.map((raw) => {
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
}

function commands(run) {
  return (run || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Executing the two deciding shell steps exactly as GitHub runs `shell: bash`.

let scratchDir = null;
let scriptCounter = 0;
function scratch() {
  scratchDir ??= fs.mkdtempSync(path.join(os.tmpdir(), 'secret-scan-contract-'));
  return scratchDir;
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

function runBash(script, { cwd, env }) {
  scriptCounter += 1;
  const file = path.join(scratch(), `step-${scriptCounter}.sh`);
  fs.writeFileSync(file, `${script}\n`);
  const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', file], {
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
  fixture = { dir, base, head, empty };
  return fixture;
}

function rangeCases() {
  const f = rangeFixture();
  return [
    { name: 'usable range', env: { SCAN_BASE: f.base, SCAN_HEAD: f.head }, pass: true },
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

const BAD_OUTCOMES = ['failure', 'skipped', 'cancelled'];

function outcomeEnv(step) {
  const byStep = {};
  for (const [name, value] of Object.entries(step.env)) {
    const match = value.match(/^\$\{\{\s*steps\.([\w-]+)\.outcome\s*\}\}$/);
    if (match) byStep[match[1]] = name;
  }
  return byStep;
}

function enforceBehaviourProblems(step) {
  const byStep = outcomeEnv(step);
  return memo(`enforce\0${step.run}\0${JSON.stringify(byStep)}`, () => {
    const problems = [];
    const envFor = (overrides) =>
      Object.fromEntries(Object.entries(byStep).map(([id, name]) => [name, overrides[id] ?? 'success']));
    const green = runBash(step.run, { cwd: scratch(), env: envFor({}) });
    if (green.status !== 0) problems.push('outcome enforcement: fails although every scanner succeeded');
    for (const id of Object.values(SCANNER_IDS)) {
      for (const outcome of BAD_OUTCOMES) {
        const result = runBash(step.run, { cwd: scratch(), env: envFor({ [id]: outcome }) });
        if (result.status === 0 || !/^::error::/m.test(result.stdout)) {
          problems.push(`outcome enforcement: ${id}=${outcome} is not re-raised as an ::error`);
        }
      }
    }
    return problems;
  });
}

// ---------------------------------------------------------------------------

function securityContractProblems(workflow, pkg = packageSource) {
  const problems = [];
  const job = jobText(workflow, 'security-scan');
  if (!job) return ['missing security-scan job'];
  const steps = parseSteps(job);

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
    return step;
  };

  // D-22: nothing in this job may swallow a failure.
  for (const step of steps) {
    if (step.continueOnError !== undefined && step.continueOnError !== 'false') {
      problems.push(`continue-on-error on '${step.name || step.uses}' (D-22: the security scans block)`);
    }
  }

  const checkout = steps.find((step) => (step.uses || '').startsWith('actions/checkout@'));
  if (!checkout || checkout.with['fetch-depth'] !== '0') {
    problems.push('checkout must fetch full commit history (fetch-depth: 0)');
  }

  const audit = find('audit');
  if (audit && (audit.run || '').trim() !== AUDIT) {
    problems.push(`dependency audit must run exactly \`${AUDIT}\``);
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
    const run = range.run || '';
    if (range.shell !== 'bash') problems.push('scan preflight must declare shell: bash');
    if (run.includes('${{')) problems.push('scan preflight must read the SHAs from env, never inline expressions');
    for (const [label, needle] of [
      ['commit existence guard (base)', 'git cat-file -e "$SCAN_BASE^{commit}"'],
      ['commit existence guard (head)', 'git cat-file -e "$SCAN_HEAD^{commit}"'],
      ['nonempty diff guard', 'git diff --name-only "$SCAN_BASE" "$SCAN_HEAD"'],
      ['all-zero push base rejection', ZERO_SHA],
    ]) {
      if (!run.includes(needle)) problems.push(`missing scan preflight: ${label}`);
    }
    if (run) problems.push(...rangeBehaviourProblems(run));
  }

  const scan = find('scan');
  if (!scan) return [...problems, 'missing TruffleHog step'];
  if (scan.uses !== SCANNER_ACTION) problems.push(`scanner action must be pinned to the v3.99.7 tag commit (${SCANNER_ACTION})`);
  if (scan.with.version !== SCANNER_VERSION) problems.push('scanner CLI version must be pinned to 3.99.7');
  if ('base' in scan.with || 'head' in scan.with) {
    problems.push('hardcoded TruffleHog refs override event-specific commit SHA discovery');
  }
  if (!/steps\.secret_scan_range\.outcome\s*==\s*'success'/.test(scan.if || '')) {
    problems.push('the scanner must not run on a range the preflight refused');
  }
  // Inspect the actual CLI arguments, never comments.
  const extraArgs = scan.with.extra_args;
  if (extraArgs === undefined) problems.push('missing scanner extra_args');
  const args = (extraArgs || '').split(/\s+/).filter(Boolean);
  if (!args.includes('--fail-on-scan-errors')) problems.push('scan-source errors must fail the job');
  if (!args.includes('--only-verified')) problems.push('verified-only scan must remain explicit');
  // The pinned action injects --fail; adding it again aborts before any scan.
  if (args.includes('--fail')) problems.push('duplicate --fail aborts scan');

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

test('security-scan job on the actual workflow blocks on the secret scan and the dependency audit (D-22)', () => {
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

test('the CI glob and test:security cover this contract and the R0-31 no-committed-credential spec', () => {
  const specs = fs.readdirSync(SUITE_DIR).filter((file) => file.endsWith('.spec.mjs'));
  for (const required of ['secret-scan-contract.spec.mjs', 'no-committed-credential.spec.mjs']) {
    assert.ok(specs.includes(required), `${required} must be in scripts/security/tests`);
  }
  assert.equal(JSON.parse(packageSource).scripts['test:security'], SECURITY_SUITE);
});

test('negative controls: restoring any old false-green mechanism makes the contract fail', () => {
  const zeroGuard = /          if \[ "\$SCAN_BASE" = "0{40}" \]; then\n[\s\S]*?\n          fi\n/;
  const mutations = [
    ['shallow checkout', inJob((job) => job.replace('          fetch-depth: 0\n', '          fetch-depth: 1\n'))],
    ['default checkout depth', inJob((job) => job.replace('        with:\n          fetch-depth: 0\n', ''))],
    ['hardcoded base', inJob((job) => job.replace("          version: '3.99.7'\n", "          base: main\n          version: '3.99.7'\n"))],
    ['hardcoded head', inJob((job) => job.replace("          version: '3.99.7'\n", "          head: HEAD\n          version: '3.99.7'\n"))],
    ['swallowed scan failure', inJob((job) => job.replace('          extra_args: --only-verified --fail-on-scan-errors\n', '          extra_args: --only-verified --fail-on-scan-errors\n        continue-on-error: true\n'))],
    ['swallowed audit failure', inJob((job) => job.replace(`        run: ${AUDIT}\n`, `        run: ${AUDIT}\n        continue-on-error: true\n`))],
    ['audit failure masked in shell', inJob((job) => job.replace(`        run: ${AUDIT}\n`, `        run: ${AUDIT} || true\n`))],
    ['audit level lowered', inJob((job) => job.replace(`        run: ${AUDIT}\n`, '        run: pnpm audit --audit-level critical\n'))],
    ['swallowed suite failure', inJob((job) => job.replace(`        run: ${SECURITY_SUITE}\n`, `        run: ${SECURITY_SUITE}\n        continue-on-error: true\n`))],
    ['scan error ignored', inJob((job) => job.replace('--only-verified --fail-on-scan-errors', '--only-verified'))],
    ['duplicate --fail', inJob((job) => job.replace('--only-verified --fail-on-scan-errors', '--only-verified --fail --fail-on-scan-errors'))],
    ['verified filtering omitted', inJob((job) => job.replace('--only-verified --fail-on-scan-errors', '--fail-on-scan-errors'))],
    ['floating action', inJob((job) => job.replace(SCANNER_ACTION, 'trufflesecurity/trufflehog@main'))],
    ['untagged commit pin', inJob((job) => job.replace(SCANNER_ACTION, UNTAGGED_PIN))],
    ['floating CLI image', inJob((job) => job.replace("          version: '3.99.7'\n", '          version: latest\n'))],
    ['scan runs on a refused range', inJob((job) => job.replace(" && steps.secret_scan_range.outcome == 'success'", ''))],
    ['no all-zero base rejection', inJob((job) => job.replace(zeroGuard, ''))],
    ['no commit existence check', inJob((job) => job.replaceAll('git cat-file -e', 'true'))],
    ['no nonempty check', inJob((job) => job.replace('git diff --name-only', 'git status --porcelain'))],
    ['push range dropped', inJob((job) => job.replace(' || github.event.before', ''))],
    ['bare-directory suite', inJob((job) => job.replace(`run: ${SECURITY_SUITE}`, 'run: node --test scripts/security/tests/'))],
    ['suite narrowed to this contract', inJob((job) => job.replace(`run: ${SECURITY_SUITE}`, 'run: node --test scripts/security/tests/secret-scan-contract.spec.mjs'))],
    ['suite commented out', inJob((job) => job.replace(`run: ${SECURITY_SUITE}`, `run: echo skipped # ${SECURITY_SUITE}`))],
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
