import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lib from '../lib.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const GUARD_SCRIPT = resolve(REPO_ROOT, '.claude/hooks/session-guard.mjs');
const LIB_SCRIPT = resolve(REPO_ROOT, 'scripts/agent-memory/lib.mjs');
const SCOPE_SCRIPT = resolve(REPO_ROOT, 'scripts/agent-memory/scope.mjs');

function makeTempRepo(planContent, branch = 'pkt/V1-A', { includeGuard = true, includeLib = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kf-write-set-'));
  const git = (args) =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'test',
        GIT_AUTHOR_EMAIL: 't@e.com',
        GIT_COMMITTER_NAME: 'test',
        GIT_COMMITTER_EMAIL: 't@e.com',
      },
    });
  git(['init', '-b', 'main']);
  if (includeGuard) {
    mkdirSync(join(dir, '.claude/hooks'), { recursive: true });
    copyFileSync(GUARD_SCRIPT, join(dir, '.claude/hooks/session-guard.mjs'));
  }
  if (includeLib) {
    mkdirSync(join(dir, 'scripts/agent-memory'), { recursive: true });
    copyFileSync(LIB_SCRIPT, join(dir, 'scripts/agent-memory/lib.mjs'));
  }
  if (planContent !== null) {
    mkdirSync(join(dir, 'docs/reconstruction'), { recursive: true });
    writeFileSync(
      join(dir, 'docs/reconstruction/V1-PLAN-RECUT.json'),
      typeof planContent === 'string' ? planContent : JSON.stringify(planContent, null, 2),
      'utf8',
    );
  }
  git(['add', '.']);
  git(['commit', '-m', 'chore: init plan']);
  // Mirror origin/main locally so `origin/main...ref` works identically to a cloned repo.
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  if (branch && branch !== 'main') {
    git(['checkout', '-b', branch]);
  }
  return { dir, git };
}

function runGuardEdit(cwd, payload, envExtra = {}) {
  const localGuard = join(cwd, '.claude/hooks/session-guard.mjs');
  const script = existsSync(localGuard) ? '.claude/hooks/session-guard.mjs' : GUARD_SCRIPT;
  const res = spawnSync(process.execPath, [script, 'edit'], {
    cwd,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, ...envExtra },
  });
  return {
    status: res.status,
    stdout: res.stdout,
    stderr: res.stderr,
    json: res.stdout.trim() ? JSON.parse(res.stdout) : null,
  };
}

test('RR-HOOK-PACKET-SCOPE: writeSetMatch handles exact paths, directory prefixes, single-segment and ** globs, [param] routes, traversal rejection, and uncheckable prose', () => {
  assert.equal(typeof lib.writeSetMatch, 'function', 'lib.mjs must export writeSetMatch');

  // Exact path
  assert.deepEqual(lib.writeSetMatch('apps/x.ts', ['apps/x.ts']), { inside: true, checkable: true });
  assert.deepEqual(lib.writeSetMatch('apps/y.ts', ['apps/x.ts']), { inside: false, checkable: true });
  assert.deepEqual(lib.writeSetMatch('apps/x.ts.bak', ['apps/x.ts']), { inside: false, checkable: true });

  // Single-segment glob '*'
  assert.deepEqual(lib.writeSetMatch('architecture/a.md', ['architecture/*.md']), { inside: true, checkable: true });
  assert.deepEqual(lib.writeSetMatch('architecture/sub/a.md', ['architecture/*.md']), { inside: false, checkable: true });
  assert.deepEqual(lib.writeSetMatch('architecture/a.txt', ['architecture/*.md']), { inside: false, checkable: true });

  // Multi-segment glob '**' (7 real plan packets)
  assert.deepEqual(
    lib.writeSetMatch('apps/web/src/app/app/store/orders/page.tsx', ['apps/web/src/app/app/store/**']),
    { inside: true, checkable: true },
  );
  assert.deepEqual(
    lib.writeSetMatch('apps/server/src/modules/ai/foo.spec.ts', ['apps/server/src/**/*.spec.ts']),
    { inside: true, checkable: true },
  );
  assert.deepEqual(
    lib.writeSetMatch('apps/web/src/components/invoice-stat-cards.tsx', ['apps/web/src/components/**/invoice-stat-cards.tsx']),
    { inside: true, checkable: true },
  );
  assert.deepEqual(
    lib.writeSetMatch('apps/web/src/components/a/b/invoice-stat-cards.tsx', ['apps/web/src/components/**/invoice-stat-cards.tsx']),
    { inside: true, checkable: true },
  );

  // ReDoS guard: repeated '*' pattern must evaluate linearly (< 50ms)
  const t0 = Date.now();
  assert.deepEqual(
    lib.writeSetMatch('apps/' + 'a'.repeat(500) + 'c', ['apps/********b']),
    { inside: false, checkable: true },
  );
  assert.ok(Date.now() - t0 < 50, 'glob matching must stay linear-time without catastrophic backtracking');

  // Next.js App Router [param] dynamic routes (25 real plan packets)
  assert.deepEqual(
    lib.writeSetMatch('apps/web/src/app/app/commerce/invoices/[id]/page.tsx', [
      'apps/web/src/app/app/commerce/invoices/[id]/page.tsx',
    ]),
    { inside: true, checkable: true },
  );
  assert.deepEqual(
    lib.writeSetMatch('apps/web/src/app/app/crm/contacts/[id]/page.tsx', [
      'apps/web/src/app/app/crm/contacts/[id]',
    ]),
    { inside: true, checkable: true },
  );

  // Path traversal bypass rejection
  assert.deepEqual(
    lib.writeSetMatch('apps/server/src/modules/identity/../../other/evil.ts', ['apps/server/src/modules/identity/']),
    { inside: false, checkable: true },
  );
  assert.deepEqual(
    lib.writeSetMatch('../outside.ts', ['apps/x.ts']),
    { inside: false, checkable: true },
  );

  // Directory prefix in prose entry
  const dirEntry = 'apps/server/src/modules/identity/ (business settings route)';
  assert.deepEqual(lib.writeSetMatch('apps/server/src/modules/identity/settings.ts', [dirEntry]), { inside: true, checkable: true });
  assert.deepEqual(lib.writeSetMatch('apps/server/src/modules/identity/sub/a.ts', [dirEntry]), { inside: true, checkable: true });
  assert.deepEqual(lib.writeSetMatch('apps/server/src/modules/identity-other/a.ts', [dirEntry]), { inside: false, checkable: true });

  // Prose entry with "(new)" and HTTP verbs in parens + multiple paths
  assert.deepEqual(
    lib.writeSetMatch('scripts/agent-memory/scope.mjs', ['scripts/agent-memory/scope.mjs (new)']),
    { inside: true, checkable: true },
  );
  assert.deepEqual(
    lib.writeSetMatch('apps/server/src/core/config/rest-scope-census.spec.ts', [
      'apps/server/src/core/connectors/connector-exports.ts (GET/PATCH settings) and apps/server/src/core/config/rest-scope-census.spec.ts',
    ]),
    { inside: true, checkable: true },
  );

  // Prose-only entry (including prose slashes like dna/export) -> whole write set is not checkable
  assert.deepEqual(
    lib.writeSetMatch('apps/x.ts', ['apps/x.ts', 'the Prisma token-encryption extension (find it)']),
    { inside: false, checkable: false },
  );
  assert.deepEqual(
    lib.writeSetMatch('apps/x.ts', ['constitution and document-pack dna/export']),
    { inside: false, checkable: false },
  );
  assert.deepEqual(lib.writeSetMatch('apps/x.ts', []), { inside: false, checkable: false });
});

test('RR-HOOK-PACKET-SCOPE: session-guard.mjs edit warns outside write set on pkt/V1-* branches, respects KF_PACKET_SCOPE=ask, and fails open', () => {
  const plan = {
    packets: [
      { id: 'A', files: ['apps/x.ts'] },
      { id: 'PROSE', files: ['the Prisma token-encryption extension (find it)'] },
    ],
  };

  // 1. On pkt/V1-A: outside write set -> non-blocking warning naming packet A & apps/y.ts, recorded in session file.
  const { dir, git } = makeTempRepo(plan, 'pkt/V1-A');
  try {
    const outRes = runGuardEdit(dir, { session_id: 'sess-1', tool_input: { file_path: 'apps/y.ts' } });
    assert.equal(outRes.status, 0);
    assert.ok(outRes.json, 'expected JSON output');
    assert.notEqual(outRes.json?.hookSpecificOutput?.permissionDecision, 'deny');
    assert.notEqual(outRes.json?.hookSpecificOutput?.permissionDecision, 'ask');
    const msg = JSON.stringify(outRes.json);
    assert.match(msg, /\bA\b/, 'warning must name packet A');
    assert.match(msg, /apps\/y\.ts/, 'warning must name the out-of-scope path');
    assert.match(msg, /outside the write set: keep it minimal and report it/i);
    assert.match(msg, /apps\/x\.ts/, 'warning must include nearest write-set entry');

    // Session record persisted the out-of-scope edit path.
    const sessPath = join(dir, '.claude/coordination/sessions/sess-1.json');
    assert.equal(existsSync(sessPath), true);
    const sess = JSON.parse(readFileSync(sessPath, 'utf8'));
    assert.ok(Array.isArray(sess.outOfScope) && sess.outOfScope.includes('apps/y.ts'));

    // 2. Inside write set -> {}.
    const inRes = runGuardEdit(dir, { session_id: 'sess-1', tool_input: { file_path: 'apps/x.ts' } });
    assert.deepEqual(inRes.json, {});

    // 3. KF_PACKET_SCOPE=ask -> permissionDecision: 'ask' (never 'deny').
    const askRes = runGuardEdit(
      dir,
      { session_id: 'sess-1', tool_input: { file_path: 'apps/y.ts' } },
      { KF_PACKET_SCOPE: 'ask' },
    );
    assert.equal(askRes.json?.hookSpecificOutput?.permissionDecision, 'ask');
    assert.match(askRes.json?.hookSpecificOutput?.permissionDecisionReason ?? '', /\bA\b/);
    assert.match(askRes.json?.hookSpecificOutput?.permissionDecisionReason ?? '', /apps\/y\.ts/);

    // 4. Existing peer-claim behavior unchanged: another live session holding apps/x.ts still triggers 'ask'.
    const peerRes = runGuardEdit(dir, { session_id: 'sess-peer', tool_input: { file_path: 'apps/x.ts' } });
    assert.equal(peerRes.json?.hookSpecificOutput?.permissionDecision, 'ask');
    assert.match(peerRes.json?.hookSpecificOutput?.permissionDecisionReason ?? '', /Another live Claude session/);

    // 5. On main (not pkt/V1-*) -> {}.
    git(['checkout', 'main']);
    const mainRes = runGuardEdit(dir, { session_id: 'sess-main', tool_input: { file_path: 'apps/z.ts' } });
    assert.deepEqual(mainRes.json, {});

    // 6. On pkt/V1-PROSE (prose-only write set -> not checkable) -> {}.
    git(['checkout', '-b', 'pkt/V1-PROSE']);
    const proseRes = runGuardEdit(dir, { session_id: 'sess-prose', tool_input: { file_path: 'apps/w.ts' } });
    assert.deepEqual(proseRes.json, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // 7. Corrupt plan fails open ({} plus a stderr note).
  const corrupt = makeTempRepo('{ not valid json', 'pkt/V1-A');
  try {
    const res = runGuardEdit(corrupt.dir, { session_id: 'sess-corrupt', tool_input: { file_path: 'apps/y.ts' } });
    assert.equal(res.status, 0);
    assert.deepEqual(res.json, {});
    assert.ok(res.stderr.trim().length > 0, 'corrupt plan must write a note on stderr');
  } finally {
    rmSync(corrupt.dir, { recursive: true, force: true });
  }

  // 8. Missing plan at HEAD fails open ({} plus a stderr note).
  const missingPlan = makeTempRepo(null, 'pkt/V1-A');
  try {
    const res = runGuardEdit(missingPlan.dir, { session_id: 'sess-noplan', tool_input: { file_path: 'apps/y.ts' } });
    assert.equal(res.status, 0);
    assert.deepEqual(res.json, {});
    assert.ok(res.stderr.trim().length > 0, 'unreadable plan must write a note on stderr');
  } finally {
    rmSync(missingPlan.dir, { recursive: true, force: true });
  }

  // 9. Isolated copy of session-guard.mjs WITHOUT scripts/agent-memory/lib.mjs fails open (never crashes at ESM link time).
  const isolated = makeTempRepo(plan, 'pkt/V1-A', { includeGuard: true, includeLib: false });
  try {
    const res = runGuardEdit(isolated.dir, { session_id: 'sess-iso', tool_input: { file_path: 'apps/y.ts' } });
    assert.equal(res.status, 0, `isolated guard must fail open with exit 0, stderr: ${res.stderr}`);
    assert.deepEqual(res.json, {});
    assert.ok(res.stderr.trim().length > 0, 'missing lib.mjs must log a fail-open note on stderr');
  } finally {
    rmSync(isolated.dir, { recursive: true, force: true });
  }
});

test('RR-HOOK-PACKET-SCOPE: scope.mjs lists changed files outside the write set (including renames/default HEAD) and reports uncheckable/unknown packets', () => {
  const plan = {
    packets: [
      { id: 'A', files: ['apps/x.ts'] },
      { id: 'PROSE', files: ['the Prisma token-encryption extension (find it)'] },
    ],
  };
  const { dir, git } = makeTempRepo(plan, 'main', { includeGuard: false, includeLib: false });
  try {
    // Seed an out-of-scope file on main so we can test git mv (rename) into the write set.
    mkdirSync(join(dir, 'apps'), { recursive: true });
    writeFileSync(join(dir, 'apps/outside.ts'), 'export const old = 1;\n', 'utf8');
    git(['add', 'apps/outside.ts']);
    git(['commit', '-m', 'chore: add outside file on main']);
    git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);

    git(['checkout', '-b', 'pkt/V1-A']);
    git(['mv', 'apps/outside.ts', 'apps/x.ts']);
    writeFileSync(join(dir, 'apps/y.ts'), 'export const y = 2;\n', 'utf8');
    git(['add', 'apps/y.ts']);
    git(['commit', '-m', 'feat: rename outside->x and add y']);

    // Explicit --ref pkt/V1-A AND default --ref HEAD both list apps/y.ts AND apps/outside.ts (no-renames), never apps/x.ts.
    for (const extraArgs of [['--ref', 'pkt/V1-A'], []]) {
      const out = execFileSync(process.execPath, [SCOPE_SCRIPT, 'A', ...extraArgs], {
        cwd: dir,
        encoding: 'utf8',
      });
      const outsideLines = out.split('\n').filter((l) => l.trim().startsWith('- '));
      assert.ok(!outsideLines.some((l) => l.includes('apps/x.ts')), `apps/x.ts is in scope: ${out}`);
      assert.ok(outsideLines.some((l) => l.includes('apps/y.ts')), `apps/y.ts must be listed: ${out}`);
      assert.ok(outsideLines.some((l) => l.includes('apps/outside.ts')), `renamed-away apps/outside.ts must be listed: ${out}`);
    }

    // Prose-only packet reports 'not checkable'.
    const outProse = execFileSync(process.execPath, [SCOPE_SCRIPT, 'PROSE', '--ref', 'pkt/V1-A'], {
      cwd: dir,
      encoding: 'utf8',
    });
    assert.match(outProse, /not checkable/i);

    // Unknown packet exits 1 cleanly.
    const unknownRes = spawnSync(process.execPath, [SCOPE_SCRIPT, 'DOES-NOT-EXIST', '--ref', 'pkt/V1-A'], {
      cwd: dir,
      encoding: 'utf8',
    });
    assert.equal(unknownRes.status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

