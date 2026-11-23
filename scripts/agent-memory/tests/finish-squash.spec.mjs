// finish-squash.sh: resolves an append-only fixture-prefixes.json conflict and makes the RED + fix commits.
// Codex on #223: with COMMIT_TRAILER unset, `set -u` aborted before committing and left the squash staged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HELPER = join(dirname(fileURLToPath(import.meta.url)), '..', 'finish-squash.sh');
const REG = 'apps/server/test/helpers/fixture-prefixes.json';
const reg = (rows) => JSON.stringify({ prefixes: rows.map((p) => ({ prefix: p, owner: `test/${p}.test.ts`, packet: 'V1-99 (T)' })) }, null, 2) + '\n';

function sh(cwd, cmd, args, env = {}) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
}
const git = (cwd, ...a) => sh(cwd, 'git', a);

function conflictedWave() {
  const root = mkdtempSync(join(tmpdir(), 'finish-squash-'));
  const origin = join(root, 'origin');
  mkdirSync(join(origin, dirname(REG)), { recursive: true });
  git(origin, 'init', '-q', '-b', 'main');
  git(origin, 'config', 'user.email', 't@example.test'); git(origin, 'config', 'user.name', 't');
  writeFileSync(join(origin, REG), reg(['v10a_']));
  git(origin, 'add', '-A'); git(origin, 'commit', '-q', '-m', 'base');
  // the packet appends a row and adds a test and a source file
  git(origin, 'checkout', '-q', '-b', 'pkt/V1-T');
  writeFileSync(join(origin, REG), reg(['v10a_', 'v99t_']));
  mkdirSync(join(origin, 'apps/server/test'), { recursive: true });
  writeFileSync(join(origin, 'apps/server/test/t.test.ts'), 'x\n');
  mkdirSync(join(origin, 'apps/server/src'), { recursive: true });
  writeFileSync(join(origin, 'apps/server/src/t.ts'), 'y\n');
  git(origin, 'add', '-A'); git(origin, 'commit', '-q', '-m', 'packet');
  // main meanwhile appends a different row at the same place
  git(origin, 'checkout', '-q', 'main');
  writeFileSync(join(origin, REG), reg(['v10a_', 'v98m_']));
  git(origin, 'add', '-A'); git(origin, 'commit', '-q', '-m', 'main row');
  const wave = join(root, 'wave');
  git(root, 'clone', '-q', origin, wave);
  git(wave, 'config', 'user.email', 't@example.test'); git(wave, 'config', 'user.name', 't');
  git(wave, 'fetch', '-q', 'origin', 'pkt/V1-T:refs/remotes/origin/pkt/V1-T');
  try { git(wave, 'merge', '--squash', '-q', 'origin/pkt/V1-T'); } catch { /* the expected conflict */ }
  return wave;
}

test('finish-squash with COMMIT_TRAILER unset: resolves the registry and makes both commits', () => {
  const wave = conflictedWave();
  const env = { ...process.env }; delete env.COMMIT_TRAILER;
  execFileSync('bash', [HELPER, 'pkt/V1-T', 'T', 'demo'], { cwd: wave, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(git(wave, 'status', '--porcelain').trim(), '', 'nothing left staged or unmerged');
  const subjects = git(wave, 'log', '--format=%s', '-2').trim().split('\n');
  assert.deepEqual(subjects, ['fix(demo): pkt/V1-T (compacted)', 'test(demo): RED for pkt/V1-T (compacted)']);
  const rows = JSON.parse(readFileSync(join(wave, REG), 'utf8')).prefixes.map((r) => r.prefix);
  assert.deepEqual(rows, ['v10a_', 'v98m_', 'v99t_'], 'both sides kept, HEAD first');
  assert.doesNotMatch(git(wave, 'log', '-1', '--format=%B'), /COMMIT_TRAILER|\$/);
});

test('finish-squash with COMMIT_TRAILER set: the trailer ends both commit messages', () => {
  const wave = conflictedWave();
  execFileSync('bash', [HELPER, 'pkt/V1-T', 'T', 'demo'], { cwd: wave, encoding: 'utf8', env: { ...process.env, COMMIT_TRAILER: 'Trailer: yes' }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const rev of ['HEAD', 'HEAD~1']) assert.match(git(wave, 'log', '-1', '--format=%B', rev).trim(), /\n\nTrailer: yes$/);
});
