import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Behavioural coverage for the cross-session guard (.claude/hooks/session-guard.mjs).
 *
 * WHY THIS EXISTS. The guard is what stops a dozen concurrent Claude sessions
 * destroying each other's uncommitted work in this repository. It has shipped
 * four serious defects since it was written, and one of them — resolving its own
 * directory through `URL.pathname`, which keeps percent-encoding — made it
 * SILENTLY ALLOW EVERYTHING on any checkout path containing a space. No error,
 * no log. Forty-six passing cases in a scratch directory never saw it, because
 * they only ever ran on a path without a space.
 *
 * The guard protects the repo; until now nothing protected the guard. These
 * cases run under `pnpm test:ci`, so they enforce on every push.
 *
 * ISOLATION. The guard derives its registry path from its own file location, so
 * running it in place would mutate the live session registry that other Claude
 * sessions are actively using. Every case here runs against a COPY of the guard
 * inside a throwaway git repository, which gives it a registry of its own and a
 * dirty tree the repo-global rules can react to.
 */

// Walk up to the repo root rather than counting `..` segments, so moving this
// file does not silently point it at a guard that does not exist — which would
// make every case below fail loudly, but for the wrong reason.
function repoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, '.claude', 'hooks', 'session-guard.mjs'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('could not locate the repo root from ' + __dirname);
}

const GUARD_SRC = join(repoRoot(), '.claude', 'hooks', 'session-guard.mjs');

let fixture: string;
let guard: string;
let registry: string;

/** ISO timestamp offset from now, for building fresh or expired claims. */
function ago(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function writeSession(id: string, claims: Record<string, string>, lastSeen = ago(0)) {
  writeFileSync(
    join(registry, `${id}.json`),
    JSON.stringify({ sessionId: id, startedAt: ago(5), lastSeen, label: '', claims }, null, 2),
  );
}

function clearRegistry() {
  for (const f of readdirSync(registry)) unlinkSync(join(registry, f));
}

type Decision = 'allow' | 'ask' | 'deny';

function run(mode: 'bash' | 'edit', sessionId: string, payload: Record<string, unknown>): Decision {
  const out = execFileSync('node', [guard, mode], {
    input: JSON.stringify({ session_id: sessionId, tool_input: payload }),
    encoding: 'utf8',
    cwd: fixture,
  });
  const parsed = JSON.parse(out || '{}');
  return (parsed.hookSpecificOutput?.permissionDecision as Decision) ?? 'allow';
}

const cmd = (sessionId: string, command: string) => run('bash', sessionId, { command });
const edit = (sessionId: string, file_path: string) => run('edit', sessionId, { file_path });

/** A file the peer holds a claim on, used throughout. */
const HELD = 'apps/web/src/lib/api.ts';

beforeAll(() => {
  fixture = mkdtempSync(join(tmpdir(), 'kf-guard-'));
  mkdirSync(join(fixture, '.claude', 'hooks'), { recursive: true });
  registry = join(fixture, '.claude', 'coordination', 'sessions');
  mkdirSync(registry, { recursive: true });
  guard = join(fixture, '.claude', 'hooks', 'session-guard.mjs');
  copyFileSync(GUARD_SRC, guard);

  // A real git repo, because the repo-global rules only fire on a dirty tree and
  // read it with `git status --porcelain`. An initial commit keeps
  // `git diff --cached` well-defined.
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: fixture, stdio: 'pipe', encoding: 'utf8' });
  git('init', '--quiet');
  git('config', 'user.email', 'guard-spec@example.invalid');
  git('config', 'user.name', 'guard spec');
  writeFileSync(join(fixture, 'seed.txt'), 'seed\n');
  git('add', 'seed.txt');
  git('commit', '--quiet', '-m', 'seed');

  // Leave the tree dirty so the destructive rules have something to protect.
  mkdirSync(join(fixture, 'apps', 'web', 'src', 'lib'), { recursive: true });
  writeFileSync(join(fixture, HELD), 'export const x = 1;\n');
});

afterAll(() => {
  rmSync(fixture, { recursive: true, force: true });
});

beforeEach(() => {
  clearRegistry();
  writeSession('peer1', { [HELD]: ago(0) });
});

describe('guard: repo-global destructive git is refused while the tree is dirty', () => {
  it.each([
    ['git stash'],
    ['git stash -u'],
    ['git checkout -- .'],
    ['git checkout .'],
    ['git restore .'],
    ['git clean -fd'],
    ['git clean -f'],
    ['git reset --hard origin/main'],
    ['git checkout -f'],
  ])('denies %s', (c) => {
    expect(cmd('me', c)).toBe('deny');
  });

  it('allows every one of them once the tree is clean', () => {
    // Proves the refusal is conditional on there being work to destroy, rather
    // than a blanket ban on the verb.
    const clean = mkdtempSync(join(tmpdir(), 'kf-guard-clean-'));
    mkdirSync(join(clean, '.claude', 'hooks'), { recursive: true });
    mkdirSync(join(clean, '.claude', 'coordination', 'sessions'), { recursive: true });
    const g = join(clean, '.claude', 'hooks', 'session-guard.mjs');
    copyFileSync(GUARD_SRC, g);
    execFileSync('git', ['init', '--quiet'], { cwd: clean });
    // The guard's own directory would otherwise show as untracked, making the
    // tree dirty and defeating the point of this case.
    writeFileSync(join(clean, '.git', 'info', 'exclude'), '.claude/\n');

    const out = execFileSync('node', [g, 'bash'], {
      input: JSON.stringify({ session_id: 'me', tool_input: { command: 'git stash' } }),
      encoding: 'utf8',
      cwd: clean,
    });
    expect(JSON.parse(out || '{}')).toEqual({});
    rmSync(clean, { recursive: true, force: true });
  });
});

describe('guard: ordinary git is never obstructed', () => {
  // A guard that blocks normal work gets switched off, and a switched-off guard
  // protects nothing. These are the cases that keep it usable.
  it.each([
    ['git status'],
    ['git diff'],
    ['git log --oneline -5'],
    ['git add -p'],
    ['git add apps/server/src/mine.ts'],
    ['git commit -m "x"'],
    ['git stash list'],
    ['git stash show'],
    ['git stash pop'],
    ['git stash apply'],
    ['git stash drop'],
    ['git stash push -- apps/web'],
    ['git checkout main'],
    ['git checkout -b feature/x'],
    ['git reset --soft HEAD~1'],
    ['git reset HEAD file.ts'],
    ['git clean -n'],
    ['git pull'],
    ['git push'],
    ['git fetch --all'],
    ['npm run build'],
    ['npm run format'],
    ['rm -rf node_modules'],
  ])('allows %s', (c) => {
    expect(cmd('me', c)).toBe('allow');
  });
});

describe("guard: reverting or deleting a peer's claimed file", () => {
  // The vector that actually caused the 2026-08-23 loss. Not a repo-global
  // sweep — scoped `git checkout --` plus `rm -f`, run by a session that had no
  // way to know another session owned those paths.
  it.each([
    [`git checkout -- ${HELD}`],
    [`git restore ${HELD}`],
    [`rm -f ${HELD}`],
    [`rm -rf apps/web/src/lib`],
    [`mv ${HELD} /tmp/x`],
    // PowerShell is the primary shell on Windows and shares no delete/move
    // vocabulary with POSIX beyond the rm/mv aliases.
    [`Remove-Item ${HELD}`],
    [`Remove-Item -Recurse -Force apps/web/src/lib`],
    [`ri ${HELD}`],
    [`Move-Item ${HELD} C:/tmp`],
  ])('asks before %s', (c) => {
    expect(cmd('me', c)).toBe('ask');
  });

  it('does not fire on an unclaimed path', () => {
    expect(cmd('me', 'git checkout -- apps/server/src/nope.ts')).toBe('allow');
  });

  it('does not treat a branch name as a path', () => {
    // Token-matching against existing claims is what keeps false positives near
    // zero: "main" is a token no claim can ever match.
    expect(cmd('me', 'git checkout main')).toBe('allow');
  });

  it('lets a session delete a file it holds itself', () => {
    expect(cmd('peer1', `rm -f ${HELD}`)).toBe('allow');
  });

  it('ignores a claim older than the 30 minute TTL', () => {
    clearRegistry();
    writeSession('peer1', { [HELD]: ago(31) });
    expect(cmd('me', `rm -f ${HELD}`)).toBe('allow');
  });

  it('ignores a session unseen for longer than 45 minutes', () => {
    clearRegistry();
    writeSession('peer1', { [HELD]: ago(0) }, ago(46));
    expect(cmd('me', `rm -f ${HELD}`)).toBe('allow');
  });
});

describe('guard: the git index is shared between sessions', () => {
  // A plain `git commit` — no -a, no add -A — commits the WHOLE index, so one
  // session's staged files land under another's message. Confirmed in the wild:
  // commit 35f42129 carried four files belonging to a session that had merely
  // staged them.
  beforeEach(() => {
    execFileSync('git', ['add', HELD], { cwd: fixture, stdio: 'pipe' });
  });

  afterAll(() => {
    try {
      execFileSync('git', ['reset', '--quiet'], { cwd: fixture, stdio: 'pipe' });
    } catch {
      /* fixture is discarded anyway */
    }
  });

  it.each([
    ['git commit -m "mine"'],
    ['git commit'],
    ['git commit -am "mine"'],
    // Global options must not hide the subcommand from the rules.
    ['git -C . commit -m "mine"'],
    ['git --no-pager commit -m "mine"'],
  ])("asks when a peer's file is staged: %s", (c) => {
    expect(cmd('me', c)).toBe('ask');
  });

  it('allows committing an index that is entirely your own', () => {
    clearRegistry();
    writeSession('me', { [HELD]: ago(0) });
    expect(cmd('me', 'git commit -m "mine"')).toBe('allow');
  });
});

describe('guard: staging the whole tree', () => {
  it.each([['git add -A'], ['git add .'], ['git commit -am "x"']])(
    "asks when a peer's file is dirty: %s",
    (c) => {
      expect(cmd('me', c)).toBe('ask');
    },
  );

  it('allows explicit path staging', () => {
    expect(cmd('me', 'git add apps/server/src/mine.ts')).toBe('allow');
  });
});

describe('guard: regressions found in review (all four shipped)', () => {
  it('scoped `git clean -fd <path>` is allowed, not denied', () => {
    // The original test only recognised a pathspec introduced by `--`, so the
    // far commoner flags-then-path form was refused. A false positive on
    // legitimate scoped work is what gets a guard disabled.
    expect(cmd('me', 'git clean -fd apps/server/tmp')).toBe('allow');
    expect(cmd('me', 'git clean -fdx apps/server/tmp')).toBe('allow');
    expect(cmd('me', 'git clean -f -- apps/server/tmp')).toBe('allow');
  });

  it('still denies `git clean -fd` with no pathspec at all', () => {
    expect(cmd('me', 'git clean -fd')).toBe('deny');
  });

  it('sees through git global options', () => {
    expect(cmd('me', 'git -C . stash')).toBe('deny');
    expect(cmd('me', 'git --no-pager reset --hard')).toBe('deny');
    expect(cmd('me', `git -C . checkout -- ${HELD}`)).toBe('ask');
  });

  it('resolves its own directory without percent-encoding', () => {
    // The silent-and-open defect: `new URL(...).pathname` keeps %20, so a
    // checkout under "C:/My Projects/..." pointed the registry at a directory
    // that does not exist, every lookup came back empty, and the guard allowed
    // everything. Running from a path WITH a space is the only way to see it.
    const spaced = mkdtempSync(join(tmpdir(), 'kf guard space-'));
    mkdirSync(join(spaced, '.claude', 'hooks'), { recursive: true });
    const reg = join(spaced, '.claude', 'coordination', 'sessions');
    mkdirSync(reg, { recursive: true });
    const g = join(spaced, '.claude', 'hooks', 'session-guard.mjs');
    copyFileSync(GUARD_SRC, g);
    writeFileSync(
      join(reg, 'peer1.json'),
      JSON.stringify({ sessionId: 'peer1', startedAt: ago(5), lastSeen: ago(0), label: '', claims: { [HELD]: ago(0) } }),
    );
    execFileSync('git', ['init', '--quiet'], { cwd: spaced });

    const out = execFileSync('node', [g, 'bash'], {
      input: JSON.stringify({ session_id: 'me', tool_input: { command: `rm -f ${HELD}` } }),
      encoding: 'utf8',
      cwd: spaced,
    });
    expect(
      JSON.parse(out || '{}').hookSpecificOutput?.permissionDecision,
      'the guard did not read its registry from a path containing a space, so it ' +
        'is silently allowing everything there',
    ).toBe('ask');
    rmSync(spaced, { recursive: true, force: true });
  });
});

describe('guard: file claims on edit', () => {
  it("asks before editing a file a peer touched", () => {
    expect(edit('me', join(fixture, HELD))).toBe('ask');
  });

  it('allows editing an unclaimed file, and records a claim for it', () => {
    expect(edit('me', join(fixture, 'apps/server/src/fresh.ts'))).toBe('allow');
    // The claim is recorded automatically — nothing has to be declared, which is
    // what makes the system work without cooperation.
    expect(cmd('other', 'rm -f apps/server/src/fresh.ts')).toBe('ask');
  });

  it('never blocks a session on its own claim', () => {
    expect(edit('peer1', join(fixture, HELD))).toBe('allow');
  });

  it('never guards its own registry', () => {
    expect(edit('me', join(fixture, '.claude/coordination/sessions/peer1.json'))).toBe('allow');
  });
});

describe('guard: escape hatch and failure behaviour', () => {
  it('honours KF_SESSION_GUARD=off in both shells', () => {
    expect(cmd('me', `KF_SESSION_GUARD=off rm -f ${HELD}`)).toBe('allow');
    expect(cmd('me', `$env:KF_SESSION_GUARD='off'; Remove-Item ${HELD}`)).toBe('allow');
  });

  it('fails OPEN on malformed input rather than blocking work', () => {
    // Breaking the tool would be worse than the harm the guard prevents.
    const out = execFileSync('node', [guard, 'bash'], { input: 'not json', encoding: 'utf8', cwd: fixture });
    expect(JSON.parse(out || '{}')).toEqual({});
  });

  it('fails OPEN on a corrupt registry record', () => {
    writeFileSync(join(registry, 'broken.json'), 'NOT JSON');
    expect(cmd('me', 'git status')).toBe('allow');
  });

  it('fails OPEN when the payload has no command or file_path', () => {
    expect(run('bash', 'me', {})).toBe('allow');
    expect(run('edit', 'me', {})).toBe('allow');
  });
});
