/**
 * Shared harness for the Windows worker proofs (tests/windows/worker-*.spec.mjs) (not a spec file).
 *
 * Builds a throwaway origin + "interactive" clone, points the worker at stub
 * gh and claude scripts (scripts/agent-control/fixtures/), and runs
 * claude-worker.ps1 exactly as the installed launcher runs it, under Windows
 * PowerShell. The claude stub records every invocation and the directory it
 * ran in, so the proofs count real wakes and inspect the real working
 * directory. None of them reads the worker's source.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const WORKER = path.resolve('scripts/agent-control/claude-worker.ps1');
const STUB_GH = path.resolve('scripts/agent-control/fixtures/stub-gh.ps1');
const STUB_CLAUDE = path.resolve('scripts/agent-control/fixtures/stub-claude.ps1');
export const OWNER = 'SaCH-PRO';

export function git(cwd, ...args) {
  const run = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { cwd, encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${run.stderr}`);
  return run.stdout.trim();
}

export function samePath(a, b) {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

/** origin (bare) + an interactive clone + a worktree root outside it. */
export function makeWorld() {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kf-tick-')));
  const origin = path.join(tmp, 'origin.git');
  const seed = path.join(tmp, 'seed');
  const root = path.join(tmp, 'checkout');
  const wtRoot = path.join(tmp, 'worktrees');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'init', '-q', '-b', 'main', seed);
  fs.writeFileSync(path.join(seed, 'README.md'), 'seed\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'seed');
  git(seed, 'remote', 'add', 'origin', origin);
  git(seed, 'push', '-q', 'origin', 'main');
  git(seed, 'checkout', '-q', '-b', 'impl/test-branch');
  fs.writeFileSync(path.join(seed, 'impl.txt'), 'impl\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'impl');
  git(seed, 'push', '-q', 'origin', 'impl/test-branch');
  git(tmp, 'clone', '-q', origin, root);

  const world = {
    tmp,
    root,
    wtRoot,
    implSha: git(seed, 'rev-parse', 'HEAD'),
    comments: path.join(tmp, 'comments.json'),
    transcripts: path.join(tmp, 'transcripts.json'),
    claudeLog: path.join(tmp, 'claude.log'),
    ghLog: path.join(tmp, 'gh.log'),
    env: {},
  };
  setComments(world, []);
  setTranscripts(world, [done('UNUSED')]);
  return world;
}

export function cleanup(world) {
  spawnSync('git', ['-C', world.root, 'worktree', 'prune'], { encoding: 'utf8' });
  fs.rmSync(world.tmp, { recursive: true, force: true });
}

export function comment({ id, type = 'DIRECTIVE', sender = 'chatgpt', author = OWNER, extra = '' }) {
  const lines = ['```yaml', `message_id: ${id}`, `message_type: ${type}`, 'packet_id: KF-TEST-001'];
  if (sender !== null) lines.push(`sender: ${sender}`);
  if (extra) lines.push(extra);
  lines.push('```');
  return { author: { login: author }, body: lines.join('\n'), createdAt: '2026-09-24T00:00:00Z', url: `u/${id}` };
}

export const done = (id) => ({ is_error: false, permission_denials: [], result: `Processed.\n\nKEYFLOW-WORKER-DONE: ${id}` });
export const blocked = (why) => ({ is_error: false, permission_denials: [], result: `KEYFLOW-WORKER-BLOCKED: ${why}` });

export function setComments(world, comments) {
  fs.writeFileSync(world.comments, JSON.stringify({ comments }), 'utf8');
}
export function setTranscripts(world, transcripts) {
  fs.writeFileSync(world.transcripts, JSON.stringify(transcripts), 'utf8');
}

export function worker(world, ...extra) {
  const run = spawnSync(
    'powershell',
    [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', WORKER,
      '-RepoRoot', world.root, '-WorktreeRoot', world.wtRoot,
      '-GhPath', STUB_GH, '-ClaudePath', STUB_CLAUDE,
      ...extra,
    ],
    {
      encoding: 'utf8',
      timeout: 180000,
      env: {
        ...process.env,
        KF_STUB_COMMENTS: world.comments,
        KF_STUB_TRANSCRIPTS: world.transcripts,
        KF_STUB_CLAUDE_LOG: world.claudeLog,
        KF_STUB_GH_LOG: world.ghLog,
        ...world.env,
      },
    },
  );
  return { status: run.status, out: (run.stdout || '') + (run.stderr || '') };
}

export const install = (world) => {
  const r = worker(world, '-RecordInstall', '-InstallMethod', 'Test', '-InstallLocation', 'test');
  assert.equal(r.status, 0, r.out);
};
export const tick = (world) => worker(world, '-Once');

export function invocations(world) {
  if (!fs.existsSync(world.claudeLog)) return [];
  return fs.readFileSync(world.claudeLog, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l.replace(/^﻿/, '')));
}
export function posts(world) {
  if (!fs.existsSync(world.ghLog)) return [];
  return fs.readFileSync(world.ghLog, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l.replace(/^﻿/, '')));
}
export function cursor(world) {
  const f = path.join(world.root, '.agent-control', '.worker', 'cursor.json');
  return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')).processed_message_ids || [];
}

