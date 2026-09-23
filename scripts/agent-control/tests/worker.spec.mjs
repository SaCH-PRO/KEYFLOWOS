/**
 * Worker proofs.
 *
 * These exercise the PowerShell worker's real behaviour where PowerShell is
 * available, and its parseable structure everywhere else. A worker that cannot
 * be verified is a worker that can silently stop waking Claude.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const WORKER = 'scripts/agent-control/claude-worker.ps1';
const INSTALL = 'scripts/agent-control/install-claude-worker.ps1';
const UNINSTALL = 'scripts/agent-control/uninstall-claude-worker.ps1';

function powershell() {
  for (const bin of ['pwsh', 'powershell']) {
    const probe = spawnSync(bin, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' });
    if (probe.status === 0) return bin;
  }
  return null;
}

const PS = powershell();

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
  assert.match(text, /gh auth status/, 'it must probe the existing gh session instead');
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
  for (const file of [WORKER, INSTALL, UNINSTALL]) {
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
  assert.match(run.stdout, /lock\s+:\s+free/, '-Status must not take the lock');
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

/**
 * Reading the control issue needs an authenticated `gh`. On a CI runner there
 * is none, so this proof is skipped rather than passed vacuously: without a
 * readable channel "no directive was processed" is true for the wrong reason.
 */
function ghAuthenticated() {
  const probe = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8', shell: process.platform === 'win32' });
  return probe.status === 0;
}

const CHANNEL_READY = PS && ghAuthenticated();

test('the cursor makes directive processing idempotent', { skip: CHANNEL_READY ? false : 'needs PowerShell and an authenticated gh' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-worker-'));
  const stateDir = path.join(root, '.agent-control', '.worker');
  fs.mkdirSync(stateDir, { recursive: true });
  // Pre-record the newest directive as already processed.
  fs.writeFileSync(
    path.join(stateDir, 'cursor.json'),
    JSON.stringify({ processed_message_ids: ['CG-REVIEW-META-AUTO-001'], last_processed_at: '2026-09-23T21:00:00Z' }),
  );

  const run = spawnSync(
    PS,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve(WORKER), '-DryRun', '-RepoRoot', root],
    { encoding: 'utf8', timeout: 180000 },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /no unprocessed directive/, 'an already-processed directive must not wake Claude again');
  assert.ok(!/would invoke claude/.test(run.stdout), 'no invocation may be planned for a processed directive');
  fs.rmSync(root, { recursive: true, force: true });
});
