/**
 * Portable worker proofs.
 *
 * These exercise the PowerShell worker's real behaviour where PowerShell is
 * available (pwsh on Linux included), and its parseable structure everywhere
 * else. A worker that cannot be verified is a worker that can silently stop
 * waking Claude.
 *
 * Proofs that need Windows itself -- ScheduledTasks cmdlet resolution, the
 * install/uninstall round trip, and the real worker tick with its worktree,
 * retry bound and authority filter -- live in tests/windows/, which FAILS off
 * Windows instead of skipping (WORKER-CI-PLATFORM-001).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PS } from './helpers/powershell.mjs';

const WORKER = 'scripts/agent-control/claude-worker.ps1';
const INSTALL = 'scripts/agent-control/install-claude-worker.ps1';
const UNINSTALL = 'scripts/agent-control/uninstall-claude-worker.ps1';

test('all worker scripts exist', () => {
  for (const file of [WORKER, INSTALL, UNINSTALL]) {
    assert.ok(fs.existsSync(file), `${file} must exist`);
  }
});

test('the worker never embeds a credential', () => {
  const text = fs.readFileSync(WORKER, 'utf8') + fs.readFileSync(INSTALL, 'utf8');
  // It must rely on existing sessions, not carry secrets.
  assert.ok(!/gh(p|o|u|s|r)_[A-Za-z0-9]{20,}/.test(text), 'no GitHub token may appear');
  assert.ok(!/sk-[A-Za-z0-9]{20,}/.test(text), 'no API key may appear');
  assert.ok(!/ANTHROPIC_API_KEY\s*=/.test(text), 'the worker must not set an API key');
  assert.match(text, /'auth', 'status'/, 'it must probe the existing gh session instead');
});

test('the worker declares the constraints it must not relax', () => {
  const text = fs.readFileSync(WORKER, 'utf8');
  for (const constraint of [/do not merge/i, /do not resolve a contradiction/i, /touch production/i]) {
    assert.match(text, constraint);
  }
});

test('install and uninstall are a matched, reversible pair', () => {
  const install = fs.readFileSync(INSTALL, 'utf8');
  const uninstall = fs.readFileSync(UNINSTALL, 'utf8');
  assert.match(install, /Register-ScheduledTask/);
  assert.match(uninstall, /Unregister-ScheduledTask/);
  assert.match(install, /KEYFLOWOS-Claude-Worker/);
  assert.match(uninstall, /KEYFLOWOS-Claude-Worker/);
});

// ------------------------------------------------------- live PowerShell

test('every worker script parses with zero errors', { skip: PS ? false : 'no PowerShell available' }, () => {
  for (const file of [WORKER, INSTALL, UNINSTALL, 'scripts/agent-control/select-directive.ps1', 'scripts/agent-control/evaluate-run.ps1']) {
    const script = `$e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path '${file}').Path,[ref]$null,[ref]$e); if($e -and $e.Count){ exit 1 } else { exit 0 }`;
    const run = spawnSync(PS, ['-NoProfile', '-Command', script], { encoding: 'utf8' });
    assert.equal(run.status, 0, `${file} has parse errors`);
  }
});

test('-Status reports auth without side effects', { skip: PS ? false : 'no PowerShell available' }, () => {
  const run = spawnSync(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', WORKER, '-Status'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /KEYFLOWOS Claude worker status/);
  assert.match(run.stdout, /gh\s+:\s+(READY|WAITING_EXTERNAL_AGENT)/);
  assert.match(run.stdout, /claude\s+:\s+(READY|WAITING_EXTERNAL_AGENT)/);
  // Assert -Status does not CHANGE the lock, not that the lock happens to be
  // free: a worker installed by this very directive legitimately holds it.
  assert.match(run.stdout, /lock\s+:\s+(free|held)/, '-Status must report the lock');
  const after = spawnSync(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', WORKER, '-Status'], { encoding: 'utf8' });
  const lockLine = (out) => (out.match(/lock\s+:\s+\S+/) || [''])[0];
  assert.equal(lockLine(run.stdout), lockLine(after.stdout), '-Status must not mutate the lock');
});

test('a held lock stops a second worker from starting', { skip: PS ? false : 'no PowerShell available' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-worker-'));
  const stateDir = path.join(root, '.agent-control', '.worker');
  fs.mkdirSync(stateDir, { recursive: true });
  // A lock owned by this live process: the worker must refuse to start.
  fs.writeFileSync(path.join(stateDir, 'worker.lock'), JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));

  const run = spawnSync(
    PS,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve(WORKER), '-DryRun', '-RepoRoot', root],
    { encoding: 'utf8' },
  );
  assert.equal(run.status, 1, 'a second worker must exit non-zero');
  assert.match(run.stdout + run.stderr, /another worker is already running/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('a stale lock from a dead process is reclaimed', { skip: PS ? false : 'no PowerShell available' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-worker-'));
  const stateDir = path.join(root, '.agent-control', '.worker');
  fs.mkdirSync(stateDir, { recursive: true });
  // PID 999999 is not a running process.
  fs.writeFileSync(path.join(stateDir, 'worker.lock'), JSON.stringify({ pid: 999999, started_at: new Date().toISOString() }));

  const run = spawnSync(
    PS,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve(WORKER), '-DryRun', '-RepoRoot', root],
    { encoding: 'utf8', timeout: 120000 },
  );
  assert.match(run.stdout, /removing a stale lock/, 'a dead owner must not block the worker forever');
  assert.ok(!fs.existsSync(path.join(stateDir, 'worker.lock')), 'the lock is released on exit');
  fs.rmSync(root, { recursive: true, force: true });
});

const CURSOR_FIXTURE = 'scripts/agent-control/tests/fixtures/issue-80-cursor.json';
const STUB_GH = 'scripts/agent-control/fixtures/stub-gh.ps1';
const STUB_CLAUDE = 'scripts/agent-control/fixtures/stub-claude.ps1';
const EXPECTED_FIXTURE_DIRECTIVE = 'CG-CURSOR-PROOF-002';
const OLDER_FIXTURE_DIRECTIVE = 'CG-CURSOR-PROOF-001';

/**
 * TOF-WORKER-CURSOR-PROOF (#114 part 2, PRS-M49, D-61):
 * The cursor idempotency proof runs against a recorded #80 channel fixture via
 * stub-gh.ps1 + stub-claude.ps1 (no live GitHub token or claude session).
 *
 * In CI (CI=true / CI=1 / KF_REQUIRE_POWERSHELL=1), a missing PowerShell or
 * missing fixture/stub FAILS CLOSED instead of skipping. Missing tracked
 * fixture/stub files always fail closed, locally and in CI.
 */
function isCiEnv(env = process.env) {
  const ci = String(env.CI ?? '').trim().toLowerCase();
  if (ci !== '' && ci !== 'false' && ci !== '0' && ci !== 'no' && ci !== 'off') return true;
  if (String(env.GITHUB_ACTIONS ?? '').trim().toLowerCase() === 'true') return true;
  return String(env.KF_REQUIRE_POWERSHELL ?? '').trim() === '1';
}

function cursorChannelStatus({
  ps = PS,
  fixturePath = CURSOR_FIXTURE,
  stubGhPath = STUB_GH,
  stubClaudePath = STUB_CLAUDE,
  env = process.env,
} = {}) {
  for (const [label, filePath] of [
    ['recorded #80 cursor fixture', fixturePath],
    ['gh stub', stubGhPath],
    ['claude stub', stubClaudePath],
  ]) {
    if (!fs.existsSync(filePath)) {
      return { ready: false, skip: false, reason: `missing ${label}: ${filePath}` };
    }
  }
  if (!ps) {
    if (isCiEnv(env)) {
      return {
        ready: false,
        skip: false,
        reason: 'CI requires PowerShell for the cursor idempotency proof (D-61: fail closed instead of skipping)',
      };
    }
    return { ready: false, skip: 'no PowerShell available', reason: 'no PowerShell available' };
  }
  return { ready: true, skip: false, reason: null };
}

const CURSOR_CHANNEL = cursorChannelStatus();

function runWorkerWithFixture(root, fixturePath = CURSOR_FIXTURE) {
  return spawnSync(
    PS,
    [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve(WORKER),
      '-DryRun',
      '-RepoRoot', root,
      '-LockRoot', path.join(root, 'locks'),
      '-GhPath', path.resolve(STUB_GH),
      '-ClaudePath', path.resolve(STUB_CLAUDE),
    ],
    {
      encoding: 'utf8',
      timeout: 180000,
      env: {
        ...process.env,
        KF_STUB_COMMENTS: path.resolve(fixturePath),
      },
    },
  );
}

test('the cursor makes directive processing idempotent', { skip: CURSOR_CHANNEL.skip }, () => {
  assert.ok(CURSOR_CHANNEL.ready, CURSOR_CHANNEL.reason);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-worker-'));
  try {
    const stateDir = path.join(root, '.agent-control', '.worker');
    fs.mkdirSync(stateDir, { recursive: true });

    // First tick against the recorded #80 fixture must find the newest directive.
    const first = runWorkerWithFixture(root);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    assert.match(
      first.stdout,
      new RegExp(`unprocessed DIRECTIVE: ${EXPECTED_FIXTURE_DIRECTIVE}`),
      `expected newest fixture directive ${EXPECTED_FIXTURE_DIRECTIVE}; stdout:\n${first.stdout}`,
    );
    assert.match(
      first.stdout,
      new RegExp(`DRY RUN: would invoke claude for ${EXPECTED_FIXTURE_DIRECTIVE}`),
      `expected dry-run wake plan for ${EXPECTED_FIXTURE_DIRECTIVE}; stdout:\n${first.stdout}`,
    );

    // Record that directive id in cursor.json, then run a second tick.
    fs.writeFileSync(
      path.join(stateDir, 'cursor.json'),
      JSON.stringify({ processed_message_ids: [EXPECTED_FIXTURE_DIRECTIVE], last_processed_at: new Date().toISOString() }),
      'utf8',
    );

    const second = runWorkerWithFixture(root);
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.match(
      second.stdout,
      /no unprocessed directive/,
      `${EXPECTED_FIXTURE_DIRECTIVE} was recorded as processed and must not wake Claude again; stdout:\n${second.stdout}`,
    );
    assert.ok(!/would invoke claude/.test(second.stdout), 'no invocation may be planned for a processed directive');
    assert.ok(
      !second.stdout.includes(OLDER_FIXTURE_DIRECTIVE),
      `marking ${EXPECTED_FIXTURE_DIRECTIVE} processed must not fall back to older directive ${OLDER_FIXTURE_DIRECTIVE}`,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the worker delegates authority and verdict to the shared scripts', () => {
  // Both decisions are proved behaviourally: select-directive.spec.mjs and
  // evaluate-run.spec.mjs against fixtures, and tests/windows/worker-*.spec.mjs
  // through the real tick. This only pins that the worker calls those scripts
  // rather than growing a second, untested copy of either rule.
  const text = fs.readFileSync(WORKER, 'utf8');
  assert.match(text, /select-directive\.ps1/, 'the worker must call the shared selector');
  assert.match(text, /evaluate-run\.ps1/, 'the worker must call the shared evaluator');
  assert.ok(!/function Get-ControlField/.test(text), 'the worker must not parse authority itself');
});

test('the woken session gets a bounded allowlist, not a permission bypass', () => {
  const text = fs.readFileSync(WORKER, 'utf8');
  assert.match(text, /--allowedTools/, 'the non-interactive session needs an explicit allowlist');
  // Look for real usage, not the comment that explains why it is not used:
  // scan only non-comment lines.
  const code = text
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
  assert.ok(
    !/--dangerously-skip-permissions/.test(code),
    'the worker must not bypass all permission checks',
  );
  for (const allowed of ["Bash(gh *)", "Bash(git *)", "Bash(node *)"]) {
    assert.ok(text.includes(allowed), `allowlist must cover ${allowed}`);
  }
});

test('the recorded #80 cursor fixture exists and drives idempotent directive selection', () => {
  const fixturePath = path.resolve(CURSOR_FIXTURE);
  assert.ok(fs.existsSync(fixturePath), `recorded #80 fixture must exist at ${fixturePath}`);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-cursor-fixture-'));
  try {
    const cursorFile = path.join(root, 'cursor.json');
    const selector = path.resolve('scripts/agent-control/select-directive.mjs');

    const first = spawnSync(
      process.execPath,
      [selector, `--comments-file=${fixturePath}`, `--cursor-file=${cursorFile}`, '--authorized-authors=SaCH-PRO'],
      { encoding: 'utf8' },
    );
    assert.equal(first.status, 0, first.stderr || first.stdout);
    const firstOut = JSON.parse(first.stdout);
    assert.equal(
      firstOut.selected?.message_id,
      EXPECTED_FIXTURE_DIRECTIVE,
      'fixture must select the newest directive before cursor update',
    );
    assert.deepEqual(firstOut.rejected, [], 'recorded fixture must have zero rejected comments');

    fs.writeFileSync(
      cursorFile,
      JSON.stringify({ processed_message_ids: [firstOut.selected.message_id], last_processed_at: new Date().toISOString() }),
      'utf8',
    );

    const second = spawnSync(
      process.execPath,
      [selector, `--comments-file=${fixturePath}`, `--cursor-file=${cursorFile}`, '--authorized-authors=SaCH-PRO'],
      { encoding: 'utf8' },
    );
    assert.equal(second.status, 0, second.stderr || second.stdout);
    const secondOut = JSON.parse(second.stdout);
    assert.equal(secondOut.selected, null, 'recording the newest directive in cursor.json must suppress re-selection');
    assert.equal(
      secondOut.reason,
      `newest_already_processed:${EXPECTED_FIXTURE_DIRECTIVE}`,
      'suppression must be attributed specifically to the processed cursor entry',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('cursorChannelStatus fails closed in CI and on missing fixtures, skipping only locally without PowerShell', () => {
  for (const [label, env] of [
    ['CI=true', { CI: 'true' }],
    ['CI=1', { CI: '1' }],
    ['CI=yes', { CI: 'yes' }],
    ['GITHUB_ACTIONS=true', { GITHUB_ACTIONS: 'true' }],
    ['KF_REQUIRE_POWERSHELL=1', { KF_REQUIRE_POWERSHELL: '1' }],
  ]) {
    const status = cursorChannelStatus({ ps: null, env });
    assert.equal(status.ready, false, `${label}: not ready without PowerShell`);
    assert.equal(status.skip, false, `${label}: must not skip without PowerShell`);
    assert.match(status.reason, /fail closed/i, `${label}: reason must explain fail-closed`);
  }

  for (const [label, env] of [
    ['empty env', {}],
    ['CI=false', { CI: 'false' }],
    ['CI=0', { CI: '0' }],
  ]) {
    const localNoPs = cursorChannelStatus({ ps: null, env });
    assert.equal(localNoPs.ready, false, `${label}: not ready without PowerShell`);
    assert.equal(localNoPs.skip, 'no PowerShell available', `${label}: local dev without PowerShell skips cleanly`);
  }

  const missingFixtureLocal = cursorChannelStatus({
    ps: 'pwsh',
    fixturePath: 'scripts/agent-control/tests/fixtures/does-not-exist.json',
    env: {},
  });
  assert.equal(missingFixtureLocal.ready, false);
  assert.equal(missingFixtureLocal.skip, false, 'a missing fixture must fail closed even locally');

  const missingStubCi = cursorChannelStatus({
    ps: 'pwsh',
    stubGhPath: 'scripts/agent-control/fixtures/missing-stub.ps1',
    env: { CI: 'true' },
  });
  assert.equal(missingStubCi.ready, false);
  assert.equal(missingStubCi.skip, false, 'a missing stub must fail closed');

  const ready = cursorChannelStatus({ ps: 'pwsh', env: { CI: 'true' } });
  assert.deepEqual(ready, { ready: true, skip: false, reason: null });
});

test('in CI (CI=true) without PowerShell, the cursor proof fails closed instead of skipping', () => {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    const upper = k.toUpperCase();
    if (
      upper === 'PATH' ||
      upper === 'CI' ||
      upper === 'GITHUB_ACTIONS' ||
      upper === 'KF_REQUIRE_POWERSHELL' ||
      upper === 'NODE_TEST_CONTEXT'
    ) {
      continue;
    }
    env[k] = v;
  }
  env.CI = 'true';
  env.PATH = '';

  const run = spawnSync(
    process.execPath,
    [
      '--test',
      '--test-reporter=tap',
      '--test-name-pattern=^the cursor makes directive processing idempotent$',
      path.resolve('scripts/agent-control/tests/worker.spec.mjs'),
    ],
    { encoding: 'utf8', env, timeout: 60000 },
  );
  const out = `${run.stdout}\n${run.stderr}`;
  assert.equal(run.error, undefined, `subprocess spawn must not error or time out: ${run.error?.message}`);
  assert.equal(run.status, 1, `CI=true with no PowerShell must fail closed (exit 1) instead of skipping; got ${run.status}:\n${out}`);
  assert.ok(!/skipped\s+[1-9]/.test(out), `cursor proof must not be skipped in CI=true:\n${out}`);
  assert.match(out, /CI requires PowerShell/i, `failure output must name the fail-closed CI guard:\n${out}`);
});

