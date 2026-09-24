/**
 * Windows install / uninstall proofs.
 *
 * The install path shipped broken once (W0: a cmdlet that does not exist)
 * because no test ever executed it. These run the real scripts against a
 * throwaway repo root, a throwaway Startup folder and a unique task name, so
 * they can never touch the operator's installed worker.
 *
 * Windows-only, and FAILS elsewhere rather than skipping: the ScheduledTasks
 * module exists only on Windows, and a Linux runner lacking it proves nothing
 * about whether the cmdlets resolve (WORKER-CI-PLATFORM-001).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { requireWindows } from '../helpers/powershell.mjs';

const WORKER = 'scripts/agent-control/claude-worker.ps1';
const INSTALL = 'scripts/agent-control/install-claude-worker.ps1';
const UNINSTALL = 'scripts/agent-control/uninstall-claude-worker.ps1';

function ps(file, ...args) {
  const run = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve(file), ...args], {
    encoding: 'utf8',
    timeout: 180000,
  });
  return { status: run.status, out: (run.stdout || '') + (run.stderr || '') };
}

function sandbox() {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kf-install-')));
  const root = path.join(tmp, 'repo');
  const startup = path.join(tmp, 'Startup');
  fs.mkdirSync(root);
  fs.mkdirSync(startup);
  return { tmp, root, startup, task: `KEYFLOWOS-Worker-Test-${process.pid}-${Date.now()}` };
}

const launcher = (s) => path.join(s.startup, 'KEYFLOWOS-Claude-Worker.vbs');
const record = (s) => path.join(s.root, '.agent-control', '.worker', 'install.json');

test('every cmdlet the worker scripts invoke actually resolves on Windows', () => {
  requireWindows(assert);
  // The install script shipped calling New-ScheduledTaskSettings, which is not
  // a cmdlet (the real one is New-ScheduledTaskSettingsSet). It parsed fine and
  // -WhatIfOnly exits before reaching it, and the old test only string-matched
  // "Register-ScheduledTask" -- so a broken install path merged. Resolve every
  // invoked command instead of trusting the parse.
  const files = [WORKER, INSTALL, UNINSTALL, 'scripts/agent-control/select-directive.ps1', 'scripts/agent-control/evaluate-run.ps1'];
  const script = `
    $ErrorActionPreference = 'Stop'
    $missing = @()
    foreach ($file in @(${files.map((f) => `'${f}'`).join(',')})) {
      $ast = [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $file).Path, [ref]$null, [ref]$null)
      # Functions the file defines itself are resolvable at runtime.
      $defined = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true) | ForEach-Object { $_.Name }
      $cmds = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true)
      foreach ($c in $cmds) {
        $name = $c.GetCommandName()
        if (-not $name) { continue }
        if ($defined -contains $name) { continue }
        # Skip native executables and this repo's own scripts.
        if ($name -match '^(gh|claude|git|node|powershell|pwsh)$') { continue }
        if ($name -match '\\.ps1$') { continue }
        if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { $missing += "$file : $name" }
      }
    }
    if ($missing.Count) { $missing -join "; "; exit 1 } else { exit 0 }
  `;
  const run = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
  assert.equal(run.status, 0, `unresolvable commands: ${run.stdout.trim()} ${run.stderr.trim()}`);
});

test('the ScheduledTask install path names only cmdlets the ScheduledTasks module exports', () => {
  requireWindows(assert);
  const run = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', "Import-Module ScheduledTasks -ErrorAction Stop; foreach ($c in 'Get-ScheduledTask','Register-ScheduledTask','Unregister-ScheduledTask','New-ScheduledTaskAction','New-ScheduledTaskTrigger','New-ScheduledTaskSettingsSet','Stop-ScheduledTask') { if (-not (Get-Command $c -Module ScheduledTasks -ErrorAction SilentlyContinue)) { \"missing $c\"; exit 1 } }; exit 0"],
    { encoding: 'utf8' },
  );
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const text = fs.readFileSync(INSTALL, 'utf8');
  assert.match(text, /New-ScheduledTaskSettingsSet/);
});

test('-WhatIfOnly creates nothing', () => {
  requireWindows(assert);
  const s = sandbox();
  try {
    const r = ps(INSTALL, '-WhatIfOnly', '-RepoRoot', s.root, '-StartupDir', s.startup, '-TaskName', s.task);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /WhatIfOnly: nothing was created/);
    assert.ok(!fs.existsSync(launcher(s)));
    assert.ok(!fs.existsSync(record(s)), 'no install record without an install');
  } finally {
    fs.rmSync(s.tmp, { recursive: true, force: true });
  }
});

test('the non-elevated Startup fallback is explicit, recorded and fully reversible', () => {
  requireWindows(assert);
  const s = sandbox();
  try {
    const r = ps(INSTALL, '-Method', 'Startup', '-RepoRoot', s.root, '-StartupDir', s.startup, '-TaskName', s.task);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /Installed via : Startup/);
    assert.ok(fs.existsSync(launcher(s)), 'the Startup launcher must exist');
    const vbs = fs.readFileSync(launcher(s), 'utf8');
    assert.match(vbs, /claude-worker\.ps1/);
    assert.ok(vbs.includes(s.root), 'the launcher must pin the repo root it was installed for');
    assert.match(vbs, /uninstall-claude-worker\.ps1/, 'the launcher says how to remove it');

    const rec = JSON.parse(fs.readFileSync(record(s), 'utf8').replace(/^﻿/, ''));
    assert.equal(rec.contract_version, 2);
    assert.equal(rec.method, 'Startup');
    assert.match(ps(WORKER, '-Status', '-RepoRoot', s.root).out, /install\s+:\s+contract 2/);

    const u = ps(UNINSTALL, '-RepoRoot', s.root, '-StartupDir', s.startup, '-TaskName', s.task);
    assert.equal(u.status, 0, u.out);
    assert.ok(!fs.existsSync(launcher(s)), 'uninstall removes the launcher');
    assert.ok(!fs.existsSync(record(s)), 'uninstall removes the install record');
    assert.match(ps(WORKER, '-Status', '-RepoRoot', s.root).out, /install\s+:\s+MISSING/);
  } finally {
    fs.rmSync(s.tmp, { recursive: true, force: true });
  }
});

test('Auto installs a Scheduled Task when allowed and falls back explicitly when denied', () => {
  requireWindows(assert);
  // Both branches are asserted: which one runs depends on whether this shell
  // may register tasks (a CI runner may; the operator's non-admin shell may
  // not). Neither branch is skipped.
  const s = sandbox();
  try {
    const r = ps(INSTALL, '-RepoRoot', s.root, '-StartupDir', s.startup, '-TaskName', s.task);
    assert.equal(r.status, 0, r.out);
    const method = (r.out.match(/Installed via : (\w+)/) || [])[1];
    assert.ok(method === 'ScheduledTask' || method === 'Startup', r.out);

    const taskExists = () =>
      spawnSync('powershell', ['-NoProfile', '-Command', `if (Get-ScheduledTask -TaskName '${s.task}' -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }`]).status === 0;

    if (method === 'ScheduledTask') {
      assert.ok(taskExists(), 'the registered task must exist');
      assert.ok(!fs.existsSync(launcher(s)), 'no fallback when the task registered');
    } else {
      assert.match(r.out, /Falling back to a per-user Startup entry/, 'the fallback must announce itself');
      assert.ok(fs.existsSync(launcher(s)));
      assert.ok(!taskExists());
    }

    const u = ps(UNINSTALL, '-RepoRoot', s.root, '-StartupDir', s.startup, '-TaskName', s.task);
    assert.equal(u.status, 0, u.out);
    assert.ok(!taskExists(), 'uninstall removes the task');
    assert.ok(!fs.existsSync(launcher(s)), 'uninstall removes the launcher');
    assert.ok(!fs.existsSync(record(s)));
  } finally {
    spawnSync('powershell', ['-NoProfile', '-Command', `Unregister-ScheduledTask -TaskName '${s.task}' -Confirm:$false -ErrorAction SilentlyContinue`]);
    fs.rmSync(s.tmp, { recursive: true, force: true });
  }
});

test('a forced ScheduledTask install fails loudly instead of silently falling back', () => {
  requireWindows(assert);
  const s = sandbox();
  try {
    const r = ps(INSTALL, '-Method', 'ScheduledTask', '-RepoRoot', s.root, '-StartupDir', s.startup, '-TaskName', s.task);
    if (r.status === 0) {
      assert.match(r.out, /Installed via : ScheduledTask/);
    } else {
      assert.match(r.out, /Scheduled Task registration failed/);
    }
    assert.ok(!fs.existsSync(launcher(s)), 'a forced ScheduledTask never writes the Startup fallback');
    ps(UNINSTALL, '-RepoRoot', s.root, '-StartupDir', s.startup, '-TaskName', s.task);
  } finally {
    spawnSync('powershell', ['-NoProfile', '-Command', `Unregister-ScheduledTask -TaskName '${s.task}' -Confirm:$false -ErrorAction SilentlyContinue`]);
    fs.rmSync(s.tmp, { recursive: true, force: true });
  }
});
