/**
 * FU-CI-WINDOWS-INPUT-GATE (P39, owner ruling D-279): the input gate of the
 * Windows worker proof.
 *
 * D-279: "The Windows worker proof is gated by its inputs and sharded. The job
 * always runs and always reports, so admission keeps its required check. It
 * diffs the PR against its merge base. If no proof input changed
 * (scripts/agent-control/**, its workflow file, the package manifests and
 * lockfile, the Node pin), it reports success with the diff it checked.
 * Otherwise it runs in full, sharded (C2). It also runs in full nightly on
 * main."
 *
 * A skip that should have been a run is a weakened gate, so this spec holds:
 *   1. decide(): no input change skips and names the diff it checked; each
 *      input in scripts/ci/worker-proof-inputs.json, the gate's own files and
 *      the workflow make it run; matching ignores case (a Windows checkout
 *      does); a schedule, an unknown event, a malformed sha, a shallow clone,
 *      a missing base, no single merge base and every git failure make it run
 *      (fail closed); a changed path that a Windows checkout cannot reproduce
 *      exactly (reserved name, case collision, symlink, CRLF, long path)
 *      makes it run, because the negative controls check out the whole tree.
 *   2. The CLI on real repositories: a rename across the input boundary runs;
 *      the gate at the merge base is asked too and its "run" wins, so a PR
 *      cannot skip by breaking the gate it brings.
 *   3. Completeness: every file the suites and the negative controls read is
 *      an input. The suite sources are scanned for every tracked path they
 *      name; each must be covered by the input list, or be in NOT_READ (named
 *      but never read, with the reason), or, for a directory, be read through
 *      a filter declared in DIRECTORY_READS whose files are all covered.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../agent-control/lib/yaml.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const GATE = path.join(HERE, 'worker-proof-inputs.mjs');
const LIST = path.join(HERE, 'worker-proof-inputs.json');
const gate = () => import('./worker-proof-inputs.mjs');

const H = 'a'.repeat(40);
const B = 'b'.repeat(40);
const MB = 'c'.repeat(40);

/** The real input list, as committed. */
const inputs = () => JSON.parse(fs.readFileSync(LIST, 'utf8')).inputs;

/**
 * A git double. Every method can be made to throw (`throws: { name: true }`),
 * so each failure is shown to run in full.
 */
function fakeGit(o = {}) {
  const changed = o.changed ?? ['apps/web/src/page.tsx'];
  const tree = o.tree ?? new Map([...changed, 'README.md', 'apps/web/package-name.txt'].map((p) => [p, '100644']));
  const fail = (name) => {
    if (o.throws?.[name]) throw new Error(`${name} failed`);
  };
  return {
    isShallow: () => (fail('isShallow'), o.shallow ?? false),
    headSha: () => (fail('headSha'), o.headSha ?? H),
    hasCommit: (sha) => (fail('hasCommit'), (o.commits ?? [B, H, MB]).includes(sha)),
    mergeBases: () => (fail('mergeBases'), o.bases ?? [MB]),
    changed: () => (fail('changed'), changed),
    tree: () => (fail('tree'), tree),
    crlf: () => (fail('crlf'), new Set(o.crlf ?? [])),
  };
}

const prArgs = (git, extra = {}) => ({ event: 'pull_request', base: B, head: H, inputs: inputs(), git, ...extra });

/** Every alternative of a `{a,b}` group, then `**` and `*` replaced by short, hazard-free names. */
function samples(glob) {
  const m = /\{([^}]*)\}/.exec(glob);
  if (m) return m[1].split(',').flatMap((alt) => samples(glob.slice(0, m.index) + alt + glob.slice(m.index + m[0].length)));
  const fill = (g) => g.replace(/\*\*\//g, 'deep/er/').replace(/\/\*\*$/, '/deep/file.txt').replace(/\*/g, 'x');
  const shallow = glob.replace(/\*\*\//g, '').replace(/\/\*\*$/, '/file.txt').replace(/\*/g, '');
  return [...new Set([fill(glob), shallow])].filter((s) => s && !s.endsWith('/'));
}

describe('worker proof input gate: decide (D-279)', () => {
  it('no proof input changed: skips, and names the merge base, the head and every path it checked', async () => {
    const { decide } = await gate();
    const changed = ['apps/web/src/page.tsx', 'docs/reconstruction/V1-STATUS.md'];
    const d = decide(prArgs(fakeGit({ changed })));
    assert.equal(d.run, false, d.reason);
    assert.equal(d.merge_base, MB);
    assert.equal(d.head, H);
    assert.equal(d.base, B);
    assert.deepEqual(d.changed, changed);
    assert.deepEqual(d.inputs_hit, []);
    assert.deepEqual(d.hazards, []);
    assert.match(d.reason, new RegExp(`${MB}\\.\\.${H}`));
  });

  it('an empty diff skips too (nothing changed against the merge base)', async () => {
    const { decide } = await gate();
    const d = decide(prArgs(fakeGit({ changed: [] })));
    assert.equal(d.run, false, d.reason);
    assert.deepEqual(d.changed, []);
  });

  it('merge_group diffs merge_group.base_sha..head_sha the same way', async () => {
    const { decide } = await gate();
    assert.equal(decide({ ...prArgs(fakeGit()), event: 'merge_group' }).run, false);
    const d = decide({ ...prArgs(fakeGit({ changed: ['scripts/agent-control/lib/yaml.mjs'] })), event: 'merge_group' });
    assert.equal(d.run, true);
  });

  it('each input in the committed list makes it run (every alternative of every pattern)', async () => {
    const { decide } = await gate();
    const list = inputs();
    assert.ok(list.length >= 10, 'the input list is not empty');
    for (const { pattern } of list) {
      for (const sample of samples(pattern)) {
        const d = decide(prArgs(fakeGit({ changed: ['apps/web/src/page.tsx', sample] })));
        assert.equal(d.run, true, `${sample} (from ${pattern}) must run the proof: ${d.reason}`);
        assert.ok(d.inputs_hit.some((h) => h.path === sample), `${sample} is reported as the input that changed`);
      }
    }
  });

  it('the ruling\'s named inputs run: the control plane, the workflow, the package manifests and lockfile, the Node pin', async () => {
    const { decide } = await gate();
    for (const p of [
      'scripts/agent-control/claude-worker.ps1',
      'scripts/agent-control/lib/admission.mjs',
      'scripts/agent-control/negative-controls.yaml',
      'scripts/agent-control/tests/windows/harness.mjs',
      '.github/workflows/agent-control-worker-proof.yml',
      'package.json',
      'apps/web/package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      '.npmrc',
      '.nvmrc',
      '.node-version',
    ]) {
      assert.equal(decide(prArgs(fakeGit({ changed: [p] }))).run, true, p);
    }
  });

  it('the gate\'s own files and its workflow make it run', async () => {
    const { decide, GATE_FILES } = await gate();
    assert.ok(GATE_FILES.includes('scripts/ci/worker-proof-inputs.json'));
    assert.ok(GATE_FILES.includes('scripts/ci/worker-proof-inputs.mjs'));
    assert.ok(GATE_FILES.includes('.github/workflows/agent-control-worker-proof.yml'));
    for (const file of GATE_FILES) {
      assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} is tracked`);
      assert.equal(decide(prArgs(fakeGit({ changed: [file] }))).run, true, file);
    }
  });

  it('matching ignores case, as a Windows checkout does', async () => {
    const { decide } = await gate();
    for (const p of ['Scripts/Agent-Control/lib/yaml.mjs', 'PACKAGE.JSON', '.GitHub/workflows/x.yml', 'apps/web/.GITATTRIBUTES']) {
      assert.equal(decide(prArgs(fakeGit({ changed: [p] }))).run, true, p);
    }
  });

  it('deleting an input runs; deleting anything else does not', async () => {
    const { decide } = await gate();
    const tree = new Map([['README.md', '100644']]);
    assert.equal(decide(prArgs(fakeGit({ changed: ['scripts/agent-control/lib/yaml.mjs'], tree }))).run, true);
    assert.equal(decide(prArgs(fakeGit({ changed: ['apps/web/src/gone.tsx'], tree }))).run, false);
  });

  it('a schedule (the nightly run on main) runs in full without asking git anything', async () => {
    const { decide } = await gate();
    const all = { isShallow: true, headSha: true, hasCommit: true, mergeBases: true, changed: true, tree: true, crlf: true };
    const d = decide({ event: 'schedule', base: '', head: H, inputs: inputs(), git: fakeGit({ throws: all }) });
    assert.equal(d.run, true);
    assert.match(d.reason, /schedule/);
  });

  it('any other event runs in full', async () => {
    const { decide } = await gate();
    for (const event of ['push', 'workflow_dispatch', 'pull_request_target', '', undefined, 'Pull_Request']) {
      assert.equal(decide({ ...prArgs(fakeGit()), event }).run, true, String(event));
    }
  });

  it('a missing or malformed base or head runs in full', async () => {
    const { decide } = await gate();
    for (const [base, head] of [['', H], [B, ''], [undefined, H], [B, undefined], ['main', H], [B, 'HEAD'], [B.slice(1), H], [B, `${H} `], [B.toUpperCase(), H]]) {
      assert.equal(decide({ ...prArgs(fakeGit()), base, head }).run, true, `${base} ${head}`);
    }
  });

  it('fails closed: a shallow clone, a checkout that is not the head, a base that is not there, no single merge base', async () => {
    const { decide } = await gate();
    assert.equal(decide(prArgs(fakeGit({ shallow: true }))).run, true, 'shallow');
    assert.equal(decide(prArgs(fakeGit({ headSha: 'd'.repeat(40) }))).run, true, 'checked out another commit');
    assert.equal(decide(prArgs(fakeGit({ commits: [H, MB] }))).run, true, 'base missing');
    assert.equal(decide(prArgs(fakeGit({ commits: [B, MB] }))).run, true, 'head missing');
    assert.equal(decide(prArgs(fakeGit({ bases: [] }))).run, true, 'no merge base');
    assert.equal(decide(prArgs(fakeGit({ bases: [MB, 'e'.repeat(40)] }))).run, true, 'two merge bases');
    assert.equal(decide(prArgs(fakeGit({ bases: ['not-a-sha'] }))).run, true, 'merge base not a sha');
  });

  it('fails closed: every git failure runs in full', async () => {
    const { decide } = await gate();
    for (const name of ['isShallow', 'headSha', 'hasCommit', 'mergeBases', 'changed', 'tree', 'crlf']) {
      const d = decide(prArgs(fakeGit({ throws: { [name]: true } })));
      assert.equal(d.run, true, name);
      assert.match(d.reason, new RegExp(`${name} failed`), name);
    }
  });

  it('a malformed input list runs in full', async () => {
    const { decide } = await gate();
    for (const bad of [undefined, null, [], [{ pattern: '' }], [{ why: 'x' }], 'scripts/**']) {
      assert.equal(decide({ ...prArgs(fakeGit()), inputs: bad }).run, true, JSON.stringify(bad));
    }
  });

  it('loadInputs refuses a list with no reason, a duplicate or an empty pattern', async () => {
    const { loadInputs } = await gate();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-wpi-list-'));
    try {
      const write = (inputs) => {
        const f = path.join(tmp, 'list.json');
        fs.writeFileSync(f, JSON.stringify({ inputs }));
        return f;
      };
      assert.throws(() => loadInputs(write([{ pattern: 'a/**' }])), /why/);
      assert.throws(() => loadInputs(write([{ pattern: 'a/**', why: 'x' }, { pattern: 'a/**', why: 'y' }])), /duplicate/);
      assert.throws(() => loadInputs(write([{ pattern: '', why: 'x' }])), /pattern/);
      assert.throws(() => loadInputs(write([])), /empty/);
      assert.equal(loadInputs(LIST).length, inputs().length);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('worker proof input gate: the whole tree a Windows checkout writes', () => {
  // proof-mutation.mjs checks out the whole tree and requires `git status --porcelain --ignored` to be empty before
  // each control, so a path anywhere that a Windows checkout cannot reproduce exactly changes the proof's verdict.
  const hazardous = [
    ['apps/web/con.tsx', /reserved/],
    ['apps/web/NUL', /reserved/],
    ['docs/aux.md', /reserved/],
    ['docs/Com1.txt', /reserved/],
    ['docs/lpt9/readme.md', /reserved/],
    ['docs/a:b.md', /character/],
    ['docs/a<b.md', /character/],
    ['docs/a|b.md', /character/],
    ['docs/a?b.md', /character/],
    ['docs/a*b.md', /character/],
    ['docs/a"b.md', /character/],
    ['docs/a\\b.md', /character/],
    ['docs/a\tb.md', /character/],
    ['docs/trailing.', /ends with/],
    ['docs/trailing /x.md', /ends with/],
    ['docs/été.md', /non-ASCII/],
    [`docs/${'d'.repeat(200)}.md`, /long/],
    ['apps/web/sub/.git/x', /\.git/],
    ['apps/web/GIT~1/x', /\.git/],
  ];

  it('each kind of path a Windows checkout cannot reproduce runs in full', async () => {
    const { decide } = await gate();
    for (const [p, why] of hazardous) {
      const d = decide(prArgs(fakeGit({ changed: [p] })));
      assert.equal(d.run, true, p);
      assert.ok(d.hazards.some((h) => h.path === p && why.test(h.why)), `${JSON.stringify(p)}: ${JSON.stringify(d.hazards)}`);
    }
  });

  it('a path that collides in case with another tracked path, as a file or a directory, runs in full', async () => {
    const { decide } = await gate();
    const tree = new Map([['docs/Readme.md', '100644'], ['docs/README.md', '100644'], ['Apps/x.md', '100644'], ['apps/web/y.md', '100644']]);
    const file = decide(prArgs(fakeGit({ changed: ['docs/README.md'], tree })));
    assert.equal(file.run, true);
    assert.match(file.hazards[0].why, /case/);
    const dir = decide(prArgs(fakeGit({ changed: ['apps/web/y.md'], tree })));
    assert.equal(dir.run, true);
    assert.match(dir.hazards[0].why, /case/);
  });

  it('a symlink, a submodule or a text file with CRLF in the commit runs in full', async () => {
    const { decide } = await gate();
    const tree = (mode) => new Map([['docs/link.md', mode]]);
    assert.equal(decide(prArgs(fakeGit({ changed: ['docs/link.md'], tree: tree('120000') }))).run, true, 'symlink');
    assert.equal(decide(prArgs(fakeGit({ changed: ['docs/link.md'], tree: tree('160000') }))).run, true, 'gitlink');
    assert.equal(decide(prArgs(fakeGit({ changed: ['docs/link.md'], tree: tree('100755') }))).run, false, 'an executable file is fine');
    const crlf = decide(prArgs(fakeGit({ changed: ['docs/link.md'], tree: tree('100644'), crlf: ['docs/link.md'] })));
    assert.equal(crlf.run, true);
    assert.match(crlf.hazards[0].why, /CR/);
  });

  it('ordinary paths raise no hazard', async () => {
    const { checkoutHazards } = await gate();
    const paths = ['apps/web/src/app/(app)/quotes/[id]/page.tsx', 'docs/reconstruction/V1-STATUS.md', 'apps/server/src/a-b_c.d.ts', 'docs/console.md', 'docs/CONTRIBUTING.md', 'docs/nul-handling.md', 'docs/auxiliary/x.md'];
    const tree = new Map(paths.map((p) => [p, '100644']));
    assert.deepEqual(checkoutHazards(paths, tree, new Set()), []);
  });
});

describe('worker proof input gate: combining the head gate with the gate at the merge base', () => {
  it('run wins: either gate saying run, or the merge base gate being unusable, runs in full', async () => {
    const { combine } = await gate();
    const skip = { run: false, reason: 'no proof input changed' };
    const run = { run: true, reason: 'input changed' };
    assert.equal(combine(skip, { decision: skip }).run, false);
    assert.equal(combine(skip, { decision: run }).run, true);
    assert.equal(combine(run, { decision: skip }).run, true);
    assert.equal(combine(skip, { error: 'no gate at the merge base' }).run, true);
    assert.equal(combine(skip, { decision: { run: 'false' } }).run, true, 'a non-boolean answer is not a skip');
    assert.equal(combine(skip, null).run, true);
    assert.match(combine(skip, { error: 'boom' }).reason, /boom/);
  });
});

// --- the CLI on real repositories --------------------------------------------------------------------------------

function sh(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'core.autocrlf=false', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/** A repository whose main carries the real gate, with a base commit and a branch for the PR. */
function repo({ withGate = true } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kf-wpi-repo-')));
  sh(dir, 'init', '-q');
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  write('README.md', 'seed\n');
  write('apps/web/page.tsx', 'export {}\n');
  write('scripts/agent-control/a.mjs', 'export const a = 1;\n');
  if (withGate) {
    write('scripts/ci/worker-proof-inputs.mjs', fs.readFileSync(GATE, 'utf8'));
    write('scripts/ci/worker-proof-inputs.json', fs.readFileSync(LIST, 'utf8'));
  }
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-qm', 'base');
  const base = sh(dir, 'rev-parse', 'HEAD');
  sh(dir, 'switch', '-q', '-c', 'pr');
  return { dir, base, write };
}

/** The gate the checkout carries (as the workflow runs it), or the real one when the checkout has none. */
function cli(dir, args) {
  const own = path.join(dir, 'scripts/ci/worker-proof-inputs.mjs');
  const r = spawnSync(process.execPath, [fs.existsSync(own) ? own : GATE, ...args], { cwd: dir, encoding: 'utf8' });
  return { ...r, decision: r.status === 0 && args.includes('--json') ? JSON.parse(r.stdout) : null };
}

function commitPr(r, msg) {
  sh(r.dir, 'add', '-A');
  sh(r.dir, 'commit', '-qm', msg);
  return sh(r.dir, 'rev-parse', 'HEAD');
}

describe('worker proof input gate: the CLI on real repositories', () => {
  it('a web-only PR skips, asks the gate at the merge base too, and writes run, sha and decision outputs', async () => {
    const r = repo();
    try {
      r.write('apps/web/page.tsx', 'export const x = 1;\n');
      const head = commitPr(r, 'web');
      const out = path.join(r.dir, '..', `${path.basename(r.dir)}-out.txt`);
      const res = cli(r.dir, ['--event', 'pull_request', '--base', r.base, '--head', head, '--json', '--github-output', out]);
      assert.equal(res.status, 0, res.stderr);
      assert.equal(res.decision.run, false, res.decision.reason);
      assert.deepEqual(res.decision.changed, ['apps/web/page.tsx']);
      assert.equal(res.decision.merge_base, r.base);
      assert.equal(res.decision.base_gate, 'skip', 'the merge base gate was asked and agreed');
      const written = fs.readFileSync(out, 'utf8');
      fs.rmSync(out);
      assert.match(written, /^run=false$/m);
      assert.match(written, new RegExp(`^sha=${head}$`, 'm'));
      const line = written.split('\n').find((l) => l.startsWith('decision='));
      assert.equal(JSON.parse(line.slice('decision='.length)).head, head);
    } finally {
      fs.rmSync(r.dir, { recursive: true, force: true });
    }
  });

  it('a PR touching the control plane runs', async () => {
    const r = repo();
    try {
      r.write('scripts/agent-control/a.mjs', 'export const a = 2;\n');
      const head = commitPr(r, 'cp');
      const res = cli(r.dir, ['--event', 'pull_request', '--base', r.base, '--head', head, '--json']);
      assert.equal(res.decision.run, true);
    } finally {
      fs.rmSync(r.dir, { recursive: true, force: true });
    }
  });

  it('a rename across the boundary runs, in either direction', async () => {
    for (const [from, to] of [['scripts/agent-control/a.mjs', 'apps/web/a.mjs'], ['apps/web/page.tsx', 'scripts/agent-control/page.tsx']]) {
      const r = repo();
      try {
        sh(r.dir, 'mv', from, to);
        const head = commitPr(r, 'rename');
        const res = cli(r.dir, ['--event', 'pull_request', '--base', r.base, '--head', head, '--json']);
        assert.equal(res.decision.run, true, `${from} -> ${to}`);
        assert.ok(res.decision.changed.includes(from) && res.decision.changed.includes(to), 'both sides of the rename are checked');
      } finally {
        fs.rmSync(r.dir, { recursive: true, force: true });
      }
    }
  });

  it('a merge base with no gate (first adoption) runs in full', async () => {
    const r = repo({ withGate: false });
    try {
      r.write('apps/web/page.tsx', 'export const x = 1;\n');
      const head = commitPr(r, 'web');
      const res = cli(r.dir, ['--event', 'pull_request', '--base', r.base, '--head', head, '--json']);
      assert.equal(res.decision.run, true);
      assert.match(res.decision.reason, /merge base/);
    } finally {
      fs.rmSync(r.dir, { recursive: true, force: true });
    }
  });

  it('a PR whose own gate would skip its own change still runs: the gate at the merge base says run', async () => {
    const r = repo();
    try {
      // The PR empties the list down to a pattern nothing matches: its own gate then sees no input change.
      r.write('scripts/ci/worker-proof-inputs.json', JSON.stringify({ inputs: [{ pattern: 'nothing/**', why: 'broken on purpose' }] }));
      const head = commitPr(r, 'break the gate');
      const alone = cli(r.dir, ['--event', 'pull_request', '--base', r.base, '--head', head, '--json', '--no-base']);
      assert.equal(alone.decision.run, false, 'the PR\'s own gate is fooled');
      const res = cli(r.dir, ['--event', 'pull_request', '--base', r.base, '--head', head, '--json']);
      assert.equal(res.decision.run, true, 'the gate at the merge base is not');
      assert.equal(res.decision.base_gate, 'run');
    } finally {
      fs.rmSync(r.dir, { recursive: true, force: true });
    }
  });

  it('a broken gate at the merge base runs in full', async () => {
    const r = repo();
    try {
      sh(r.dir, 'switch', '-q', 'main');
      r.write('scripts/ci/worker-proof-inputs.mjs', 'this is not javascript\n');
      const base = commitPr(r, 'broken gate on main');
      sh(r.dir, 'switch', '-q', 'pr');
      sh(r.dir, 'merge', '-q', '--ff-only', 'main');
      r.write('scripts/ci/worker-proof-inputs.mjs', fs.readFileSync(GATE, 'utf8'));
      r.write('apps/web/page.tsx', 'export const y = 1;\n');
      const head = commitPr(r, 'fix gate and web');
      const res = cli(r.dir, ['--event', 'pull_request', '--base', base, '--head', head, '--json']);
      assert.equal(res.decision.run, true);
    } finally {
      fs.rmSync(r.dir, { recursive: true, force: true });
    }
  });

  it('a shallow clone, an unknown base and a checkout that is not the head run in full', async () => {
    const r = repo();
    const clone = `${r.dir}-shallow`;
    try {
      r.write('apps/web/page.tsx', 'export const x = 1;\n');
      const head = commitPr(r, 'web');
      const missing = cli(r.dir, ['--event', 'pull_request', '--base', 'f'.repeat(40), '--head', head, '--json']);
      assert.equal(missing.decision.run, true, 'unknown base');
      sh(r.dir, 'switch', '-q', 'main');
      const elsewhere = cli(r.dir, ['--event', 'pull_request', '--base', r.base, '--head', head, '--json']);
      assert.equal(elsewhere.decision.run, true, 'HEAD is not the head');
      sh(os.tmpdir(), 'clone', '-q', '--depth', '1', '--branch', 'pr', `file://${r.dir}`, clone);
      const shallow = cli(clone, ['--event', 'pull_request', '--base', r.base, '--head', head, '--json']);
      assert.equal(shallow.decision.run, true, 'shallow clone');
    } finally {
      fs.rmSync(r.dir, { recursive: true, force: true });
      fs.rmSync(clone, { recursive: true, force: true });
    }
  });

  it('the schedule runs in full and still writes the head it ran on', async () => {
    const r = repo();
    try {
      const head = sh(r.dir, 'rev-parse', 'HEAD');
      const out = `${r.dir}-out.txt`;
      const res = cli(r.dir, ['--event', 'schedule', '--base', '', '--head', head, '--json', '--github-output', out]);
      assert.equal(res.decision.run, true);
      const written = fs.readFileSync(out, 'utf8');
      fs.rmSync(out);
      assert.match(written, /^run=true$/m);
      assert.match(written, new RegExp(`^sha=${head}$`, 'm'));
    } finally {
      fs.rmSync(r.dir, { recursive: true, force: true });
    }
  });

  it('the gate imports only node: builtins, so the copy taken from the merge base runs on its own', () => {
    const text = fs.readFileSync(GATE, 'utf8');
    const specifiers = [...text.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm), ...text.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    assert.ok(specifiers.length > 0);
    assert.deepEqual(specifiers.filter((s) => !s.startsWith('node:')), []);
  });
});

// --- completeness: every file the suites read is an input --------------------------------------------------------

/**
 * Tracked paths the suite sources name that are never read by them. Each says why; a stale entry fails.
 */
export const NOT_READ = {
  'AGENTS.md': 'claude-worker.ps1 names it in the prompt it hands Claude; the worker never opens it',
  'CLAUDE.md': 'claude-worker.ps1 names it in the prompt it hands Claude; the worker never opens it',
  'README.md': 'the Windows harness writes README.md into its own temporary seed repository',
  'docs/development/AGENT_CONTROL_PLANE.md': 'cited in a comment of auto-merge-admitted.mjs',
  'docs/development/EXECUTION_CONTROL_STANDARD.md': 'cited in comments and in the worker\'s prompt text',
  'docs/development/KEYFLOWOS_AUTONOMOUS_AGENT_ROLES.md': 'a line of fixture text in tests/helpers/merge-grant-fixture.mjs',
  'docs/development/KEYFLOWOS_PLATFORM_CONVERGENCE_PROGRAMME.md': 'a line of fixture text in tests/helpers/merge-grant-fixture.mjs',
  'apps/server/src/main.ts': 'a file name in admission.spec.mjs fixtures (non-control files of a PR)',
  'apps/server': 'a path glob in negative-controls.yaml fixture text',
  'architecture': 'part of identifiers such as architecture_authority',
  'artifacts': 'part of prose and identifiers (control artifacts)',
  'attached_assets/screenshots': 'a long file name built for the Windows worktree-path test, in a temporary world',
  docs: 'a directory made inside temporary fixtures (reconcile.spec.mjs) and fixture text',
  'docs/development': 'a directory made inside a temporary fixture (reconcile.spec.mjs); its files read are listed singly',
  'docs/intelligence': 'cited in a comment of lib/state.mjs',
  'docs/intelligence/sessions/2026-10-17-p0-safety-review/f9': 'cited in a comment of admission.spec.mjs',
};

/**
 * Directories a suite reads through a filter: every tracked file under the directory that passes the filter must be
 * an input.
 */
export const DIRECTORY_READS = {
  scripts: {
    why: 'authority-effects.spec.mjs reads every .mjs/.js/.ps1/.yml/.yaml/.json under scripts/ (not inside a fixtures or node_modules directory) for a file name',
    reads: (rel) => /\.(mjs|js|ps1|ya?ml|json)$/.test(rel) && !/(^|\/)(fixtures|node_modules)\//.test(rel),
  },
};

const tracked = () => spawnSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).stdout.split('\0').filter(Boolean);

/** Every tracked file or directory a source names, as a literal path or as path.join / Join-Path segments. */
export function namedPaths(text, files, dirs) {
  const found = new Set();
  const add = (c) => {
    const p = c.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    if (p && (files.has(p) || dirs.has(p))) found.add(p);
  };
  for (const m of text.matchAll(/[A-Za-z0-9_.\-/\\]+/g)) add(m[0]);
  for (const m of text.matchAll(/(?:path\.(?:join|resolve)|Join-Path)\s*\(?([^)\n]*)\)?/g)) {
    const segs = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
    for (let i = 0; i < segs.length; i += 1) for (let j = i + 1; j <= segs.length; j += 1) add(segs.slice(i, j).join('/'));
  }
  return found;
}

/** The suite sources: what the Windows legs run (the suites, the libraries and CLIs they load, the manifest). */
function suiteSources(all) {
  return all.filter((f) => f.startsWith('scripts/agent-control/') && !f.startsWith('scripts/agent-control/research/') && /\.(mjs|ps1|ya?ml)$/.test(f));
}

/** The problems with the input list's coverage of what `sources` name (see the header, part 3). */
export function coverageProblems({ all, sources, read, isInput, notRead = NOT_READ, directoryReads = DIRECTORY_READS }) {
  const files = new Set(all);
  const dirs = new Set();
  for (const f of all) {
    const parts = f.split('/');
    for (let i = 1; i < parts.length; i += 1) dirs.add(parts.slice(0, i).join('/'));
  }
  const named = new Map();
  for (const src of sources) {
    for (const p of namedPaths(read(src), files, dirs)) {
      if (!named.has(p)) named.set(p, src);
    }
  }
  const problems = [];
  for (const [p, src] of named) {
    if (Object.hasOwn(notRead, p)) continue;
    if (files.has(p)) {
      if (!isInput(p)) problems.push(`${p} (named by ${src}) is not a worker proof input`);
      continue;
    }
    const under = all.filter((f) => f.startsWith(`${p}/`));
    const filter = directoryReads[p];
    const wanted = filter ? under.filter((f) => filter.reads(f.slice(p.length + 1))) : under;
    const uncovered = wanted.filter((f) => !isInput(f));
    if (uncovered.length) problems.push(`${p}/ (named by ${src}) has ${uncovered.length} file(s) that are not inputs, e.g. ${uncovered.slice(0, 3).join(', ')}`);
  }
  for (const p of Object.keys(notRead)) {
    if (!named.has(p)) problems.push(`NOT_READ ${p}: no suite source names it (stale entry; remove it)`);
    else if (!notRead[p]) problems.push(`NOT_READ ${p}: no reason`);
    else if (files.has(p) && isInput(p)) problems.push(`NOT_READ ${p}: is an input anyway (needless entry; remove it)`);
  }
  for (const p of Object.keys(directoryReads)) {
    if (!named.has(p)) problems.push(`DIRECTORY_READS ${p}: no suite source names it (stale entry; remove it)`);
  }
  return problems;
}

describe('worker proof input list: completeness (every file the suites read is an input)', () => {
  it('every file a negative control mutates, and every path its proof command names, is an input', async () => {
    const { loadInputs, inputFor } = await gate();
    const list = loadInputs(LIST);
    const manifest = parseYaml(fs.readFileSync(path.join(ROOT, 'scripts/agent-control/negative-controls.yaml'), 'utf8'));
    const missing = [];
    let named = 0;
    for (const c of manifest.negative_controls) {
      if (!inputFor(c.mutation.file, list)) missing.push(`${c.id}: mutation.file ${c.mutation.file}`);
      // Path arguments only: a --test-name-pattern="..." value names a test, not a file.
      for (const m of c.proof_command.matchAll(/(?:^|\s)([^\s"'=]+\/[^\s"']+\.(?:mjs|js|ps1|ya?ml|json|md))(?=\s|$)/g)) {
        named += 1;
        if (!inputFor(m[1], list)) missing.push(`${c.id}: proof_command names ${m[1]}`);
      }
    }
    assert.ok(named >= manifest.negative_controls.length, `every proof command names its spec (${named} paths found)`);
    assert.deepEqual(missing, []);
  });

  it('every tracked path the suite sources name is an input, a declared filtered directory read, or recorded as not read', async () => {
    const { loadInputs, inputFor } = await gate();
    const list = loadInputs(LIST);
    const all = tracked();
    const problems = coverageProblems({
      all,
      sources: suiteSources(all),
      read: (f) => fs.readFileSync(path.join(ROOT, f), 'utf8'),
      isInput: (p) => Boolean(inputFor(p, list)),
    });
    assert.deepEqual(problems, []);
  });

  it('the paths the worker proof workflow names are inputs', async () => {
    const { loadInputs, inputFor } = await gate();
    const list = loadInputs(LIST);
    const all = tracked();
    const files = new Set(all);
    const text = fs.readFileSync(path.join(ROOT, '.github/workflows/agent-control-worker-proof.yml'), 'utf8');
    const named = [...namedPaths(text, files, new Set())];
    assert.ok(named.includes('scripts/agent-control/negative-controls.yaml'));
    assert.deepEqual(named.filter((p) => !inputFor(p, list)), []);
  });

  it('the scan cannot pass vacuously: an uncovered file, an uncovered filtered file and stale entries are reported', () => {
    const all = ['scripts/agent-control/x.mjs', 'docs/secret-input.md', 'scripts/other/y.mjs', 'scripts/other/z.md', 'docs/a.md'];
    const sources = ['scripts/agent-control/x.mjs'];
    const text = "fs.readFileSync('docs/secret-input.md'); walk('scripts'); path.join(root, 'docs', 'a.md');";
    const problems = coverageProblems({
      all,
      sources,
      read: () => text,
      isInput: (p) => p.startsWith('scripts/agent-control/'),
      notRead: { 'gone.md': 'was removed' },
      directoryReads: { scripts: { why: 'walk', reads: (rel) => rel.endsWith('.mjs') }, nowhere: { why: 'x', reads: () => true } },
    });
    assert.ok(problems.some((p) => p.startsWith('docs/secret-input.md ')), problems.join('\n'));
    assert.ok(problems.some((p) => p.startsWith('docs/a.md ')), 'path.join segments are joined');
    assert.ok(problems.some((p) => p.startsWith('scripts/ ') && p.includes('scripts/other/y.mjs') && !p.includes('z.md')), problems.join('\n'));
    assert.ok(problems.some((p) => p.startsWith('NOT_READ gone.md')));
    assert.ok(problems.some((p) => p.startsWith('DIRECTORY_READS nowhere')));
  });

  it('the suites the Windows legs run are all under scripts/agent-control', () => {
    const wf = parseYaml(fs.readFileSync(path.join(ROOT, '.github/workflows/agent-control-worker-proof.yml'), 'utf8'));
    const runs = Object.values(wf.jobs).flatMap((j) => (j.steps || []).map((s) => s.run || '')).join('\n');
    const specs = [...runs.matchAll(/node --test ([^\n]+)/g)].flatMap((m) => m[1].split(/\s+/)).filter((t) => t.endsWith('.spec.mjs'));
    assert.ok(specs.includes('scripts/agent-control/tests/windows/*.spec.mjs'));
    for (const spec of specs) assert.ok(spec.startsWith('scripts/agent-control/') || spec.startsWith('scripts/ci/worker-proof-'), spec);
  });
});
