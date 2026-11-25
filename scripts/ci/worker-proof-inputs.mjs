#!/usr/bin/env node
/**
 * The input gate of the Windows worker proof (FU-CI-WINDOWS-INPUT-GATE, owner ruling D-279).
 *
 * Decides whether the full Windows proof (the suites and the sharded negative controls) must run for an event:
 *   - pull_request: the diff from the merge base of the PR base and the PR head, to the head;
 *   - merge_group: the same, from merge_group.base_sha to merge_group.head_sha;
 *   - schedule (the nightly run on main): always runs in full;
 *   - anything else: runs in full.
 * It runs in full when any changed path is a proof input (worker-proof-inputs.json, matched without regard to case),
 * or is a path a Windows checkout cannot reproduce exactly (the negative controls check out the whole tree and need
 * it pristine), and whenever it cannot tell: a malformed sha, a shallow clone, a base it cannot find, no single merge
 * base, any git failure. Otherwise it skips, naming the merge base, the head and every path it checked.
 *
 * The gate at the merge base is asked too (its copy of this file and of the list, run on their own: this file
 * imports only node: builtins), and the full proof runs when either gate says so, when the merge base has no gate,
 * or when it cannot be run. A PR therefore cannot skip by changing the gate it brings.
 *
 * Usage:
 *   node scripts/ci/worker-proof-inputs.mjs --event <name> --base <sha> --head <sha>
 *        [--json] [--no-base] [--github-output <file>] [--summary <file>]
 * Exit 0 with a decision; any other exit is a failure of the gate itself (the workflow then fails).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
export const INPUTS_PATH = path.join(path.dirname(SELF), 'worker-proof-inputs.json');
const GATE_REL = 'scripts/ci/worker-proof-inputs.mjs';
const LIST_REL = 'scripts/ci/worker-proof-inputs.json';

/** The gate's own files and its workflow: each is an input (worker-proof-inputs.spec.mjs proves it). */
export const GATE_FILES = Object.freeze([
  GATE_REL,
  LIST_REL,
  'scripts/ci/worker-proof-shard.mjs',
  'scripts/ci/worker-proof-aggregate.mjs',
  'scripts/ci/worker-proof-inputs.spec.mjs',
  'scripts/ci/worker-proof-shards.spec.mjs',
  'scripts/ci/worker-proof-workflow.spec.mjs',
  '.github/workflows/agent-control-worker-proof.yml',
]);

/** Longest path a changed file may have and still be skipped: the worktrees live under the runner's temp dir. */
export const MAX_PATH_LENGTH = 160;
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const GATED_EVENTS = new Set(['pull_request', 'merge_group']);

/** The list in `file`, validated: a non-empty array of { pattern, why }, no pattern twice. Throws otherwise. */
export function loadInputs(file = INPUTS_PATH) {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = doc?.inputs;
  if (!Array.isArray(list) || list.length === 0) throw new Error(`${file}: inputs is empty or not a list`);
  const seen = new Set();
  for (const entry of list) {
    if (!entry || typeof entry.pattern !== 'string' || entry.pattern.trim() === '') throw new Error(`${file}: an entry has no pattern`);
    if (typeof entry.why !== 'string' || entry.why.trim() === '') throw new Error(`${file}: ${entry.pattern} has no why`);
    const key = entry.pattern.toLowerCase();
    if (seen.has(key)) throw new Error(`${file}: duplicate pattern ${entry.pattern}`);
    seen.add(key);
  }
  return list;
}

/** A glob as an anchored, case-insensitive RegExp: `**` any depth, `*` and `?` within one name, `{a,b}` alternatives. */
export function globToRegExp(glob) {
  let re = '';
  let depth = 0;
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '{') {
      re += '(?:';
      depth += 1;
    } else if (c === '}' && depth > 0) {
      re += ')';
      depth -= 1;
    } else if (c === ',' && depth > 0) re += '|';
    else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  if (depth !== 0) throw new Error(`unbalanced braces in ${glob}`);
  return new RegExp(`^${re}$`, 'i');
}

const compiled = new WeakMap();
const regexesOf = (inputs) => {
  if (!compiled.has(inputs)) compiled.set(inputs, inputs.map((entry) => ({ pattern: entry.pattern, re: globToRegExp(entry.pattern) })));
  return compiled.get(inputs);
};

/** The first input pattern `file` matches, or null. */
export function inputFor(file, inputs) {
  const hit = regexesOf(inputs).find(({ re }) => re.test(file));
  return hit ? hit.pattern : null;
}

const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

/**
 * Why each changed path a Windows checkout cannot reproduce exactly is a hazard: [{ path, why }]. `tree` maps every
 * path at the head to its mode (deleted paths are absent and raise nothing); `crlf` holds the paths whose content at
 * the head has a carriage return.
 */
export function checkoutHazards(paths, tree, crlf) {
  const spellings = new Map();
  for (const p of tree.keys()) {
    const parts = p.split('/');
    for (let i = 1; i <= parts.length; i += 1) {
      const prefix = parts.slice(0, i).join('/');
      const key = prefix.toLowerCase();
      if (!spellings.has(key)) spellings.set(key, new Set());
      spellings.get(key).add(prefix);
    }
  }
  const hazards = [];
  for (const p of paths) {
    if (!tree.has(p)) continue;
    const why = [];
    const parts = p.split('/');
    for (const part of parts) {
      if (RESERVED.test(part)) why.push(`"${part}" is a reserved name on Windows`);
      if (/[<>:"|?*\\\x00-\x1f\x7f]/.test(part)) why.push(`"${part}" has a character Windows refuses`);
      if (/[. ]$/.test(part)) why.push(`"${part}" ends with a dot or a space`);
      if (/^(\.git|git~\d+)$/i.test(part)) why.push(`"${part}" names a .git directory`);
    }
    if (/[^\x20-\x7e]/.test(p)) why.push('a non-ASCII name');
    if (p.length > MAX_PATH_LENGTH) why.push(`a long path (${p.length} > ${MAX_PATH_LENGTH} characters)`);
    for (let i = 1; i <= parts.length; i += 1) {
      const names = spellings.get(parts.slice(0, i).join('/').toLowerCase());
      if (names && names.size > 1) {
        why.push(`a case collision: ${[...names].sort().join(', ')}`);
        break;
      }
    }
    const mode = tree.get(p);
    if (mode === '120000') why.push('a symbolic link');
    if (mode === '160000') why.push('a submodule');
    if (crlf.has(p)) why.push('CR line endings in the commit');
    for (const w of why) hazards.push({ path: p, why: w });
  }
  return hazards;
}

/**
 * The decision for one event. `git` answers questions about the checkout (see gitAdapter); any of its errors runs in
 * full. Returns { schema, run, reason, event, base, head, merge_base, changed, inputs_hit, hazards }.
 */
export function decide({ event, base, head, inputs, git }) {
  const d = {
    schema: 'worker-proof-gate/1',
    run: true,
    reason: '',
    event: event ?? null,
    base: base ?? null,
    head: head ?? null,
    merge_base: null,
    changed: [],
    inputs_hit: [],
    hazards: [],
  };
  const run = (reason) => Object.assign(d, { run: true, reason });
  if (event === 'schedule') return run('schedule: the nightly run on main is always in full');
  if (!GATED_EVENTS.has(event)) return run(`event ${JSON.stringify(event ?? null)} is not gated: run in full`);
  if (typeof base !== 'string' || !SHA.test(base)) return run(`base ${JSON.stringify(base ?? null)} is not a full commit id: run in full`);
  if (typeof head !== 'string' || !SHA.test(head)) return run(`head ${JSON.stringify(head ?? null)} is not a full commit id: run in full`);
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.some((e) => !e || typeof e.pattern !== 'string' || !e.pattern)) {
    return run('the input list is malformed: run in full');
  }
  try {
    if (git.isShallow() !== false) return run('the clone is shallow: the merge base cannot be trusted; run in full');
    const checkedOut = git.headSha();
    if (checkedOut !== head) return run(`the checkout is ${checkedOut}, not the head ${head}: run in full`);
    if (!git.hasCommit(head)) return run(`the head ${head} is not in the clone: run in full`);
    if (!git.hasCommit(base)) return run(`the base ${base} is not in the clone: run in full`);
    const bases = git.mergeBases(base, head);
    if (!Array.isArray(bases) || bases.length !== 1 || !SHA.test(bases[0])) {
      return run(`${bases?.length ?? 0} merge bases of ${base} and ${head}: run in full`);
    }
    d.merge_base = bases[0];
    d.changed = git.changed(d.merge_base, head);
    d.inputs_hit = d.changed.map((p) => ({ path: p, pattern: inputFor(p, inputs) })).filter((h) => h.pattern);
    if (d.inputs_hit.length) {
      return run(`${d.inputs_hit.length} proof input(s) changed in ${d.merge_base}..${head}, e.g. ${d.inputs_hit[0].path} (${d.inputs_hit[0].pattern})`);
    }
    const tree = git.tree(head);
    const present = d.changed.filter((p) => tree.has(p));
    d.hazards = checkoutHazards(present, tree, present.length ? git.crlf(head, present) : new Set());
    if (d.hazards.length) {
      return run(`${d.hazards.length} change(s) in ${d.merge_base}..${head} a Windows checkout may not reproduce, e.g. ${d.hazards[0].path}: ${d.hazards[0].why}`);
    }
  } catch (error) {
    return run(`git: ${error.message}: run in full`);
  }
  d.run = false;
  d.reason = `no proof input changed in ${d.merge_base}..${head} (${d.changed.length} path(s) checked)`;
  return d;
}

/** The head gate's decision combined with the merge base gate's answer ({ decision } or { error }): run wins. */
export function combine(headDecision, baseAnswer) {
  const out = { ...headDecision };
  if (!baseAnswer || (!baseAnswer.decision && !baseAnswer.error)) {
    return Object.assign(out, { run: true, base_gate: 'unavailable', reason: `${headDecision.reason}; the gate at the merge base gave no answer: run in full` });
  }
  if (baseAnswer.error) {
    return Object.assign(out, { run: true, base_gate: 'unavailable', reason: `${headDecision.reason}; the gate at the merge base could not decide (${baseAnswer.error}): run in full` });
  }
  const said = baseAnswer.decision;
  if (said.run !== false) {
    return Object.assign(out, { run: true, base_gate: 'run', reason: headDecision.run ? headDecision.reason : `the gate at the merge base says run: ${said.reason ?? 'no reason given'}` });
  }
  return Object.assign(out, { base_gate: 'skip' });
}

// --- git ----------------------------------------------------------------------------------------------------------

const GIT_LOCATION_VARS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE'];

/** git in `cwd`, never steered by a git location variable; throws on any failure unless `ok` accepts the status. */
function gitRun(cwd, args, { ok = [0], input, encoding = 'utf8' } = {}) {
  const env = { ...process.env };
  for (const name of GIT_LOCATION_VARS) delete env[name];
  const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd, env, encoding, input, maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw new Error(`git ${args[0]}: ${r.error.message}`);
  if (!ok.includes(r.status)) throw new Error(`git ${args.join(' ').slice(0, 120)} exited ${r.status}: ${String(r.stderr).trim().slice(0, 300)}`);
  return r;
}

/** The questions decide() asks, answered by git in `cwd`. */
export function gitAdapter(cwd) {
  return {
    isShallow: () => {
      const out = gitRun(cwd, ['rev-parse', '--is-shallow-repository']).stdout.trim();
      if (out !== 'true' && out !== 'false') throw new Error(`rev-parse --is-shallow-repository said ${out}`);
      return out === 'true';
    },
    headSha: () => gitRun(cwd, ['rev-parse', '--verify', 'HEAD^{commit}']).stdout.trim(),
    hasCommit: (sha) => gitRun(cwd, ['cat-file', '-e', `${sha}^{commit}`], { ok: [0, 1, 128] }).status === 0,
    mergeBases: (a, b) => {
      const r = gitRun(cwd, ['merge-base', '--all', a, b], { ok: [0, 1] });
      return r.status === 1 ? [] : r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    },
    changed: (from, to) => {
      // Renames are a deletion and an addition, so both sides of a rename across the boundary are checked; no config
      // can make the diff relative, hide submodules or hand it to an external tool.
      const r = gitRun(cwd, ['diff', '--no-renames', '--no-relative', '--ignore-submodules=none', '--no-ext-diff', '--no-textconv', '--name-only', '-z', from, to, '--']);
      return r.stdout.split('\0').filter((p) => p !== '');
    },
    tree: (commit) => {
      const r = gitRun(cwd, ['ls-tree', '-r', '-z', '--full-tree', commit]);
      const tree = new Map();
      for (const entry of r.stdout.split('\0')) {
        if (!entry) continue;
        const tab = entry.indexOf('\t');
        const [mode] = entry.slice(0, tab).split(' ');
        tree.set(entry.slice(tab + 1), mode);
      }
      return tree;
    },
    crlf: (commit, paths) => {
      const found = new Set();
      for (let i = 0; i < paths.length; i += 200) {
        const chunk = paths.slice(i, i + 200);
        // -I skips binary files: only text a checkout converts is asked about.
        const r = gitRun(cwd, ['--literal-pathspecs', 'grep', '-I', '-l', '-z', '-F', '-e', '\r', commit, '--', ...chunk], { ok: [0, 1] });
        for (const hit of r.stdout.split('\0')) if (hit.startsWith(`${commit}:`)) found.add(hit.slice(commit.length + 1));
      }
      return found;
    },
  };
}

/**
 * Asks the gate at `mergeBase`: its copy of this file and of the list, run on their own from a temporary directory.
 * Returns { decision } or { error }.
 */
export function askBaseGate({ cwd, mergeBase, event, base, head }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-wp-basegate-'));
  try {
    for (const rel of [GATE_REL, LIST_REL]) {
      const r = gitRun(cwd, ['cat-file', 'blob', `${mergeBase}:${rel}`], { ok: [0, 128], encoding: 'buffer' });
      if (r.status !== 0) return { error: `the merge base ${mergeBase} has no ${rel} (first adoption)` };
      fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
      fs.writeFileSync(path.join(tmp, rel), r.stdout);
    }
    const child = spawnSync(process.execPath, [path.join(tmp, GATE_REL), '--event', event, '--base', base, '--head', head, '--json', '--no-base'], {
      cwd,
      encoding: 'utf8',
      timeout: 300_000,
      maxBuffer: 256 * 1024 * 1024,
    });
    if (child.status !== 0) return { error: `it exited ${child.status ?? child.signal}: ${String(child.stderr).trim().slice(0, 300)}` };
    let decision;
    try {
      decision = JSON.parse(child.stdout);
    } catch {
      return { error: 'its output is not JSON' };
    }
    if (!decision || typeof decision !== 'object' || typeof decision.run !== 'boolean') return { error: 'its decision has no boolean run' };
    return { decision };
  } catch (error) {
    return { error: error.message };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// --- CLI ----------------------------------------------------------------------------------------------------------

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

/** The decision as one line for GITHUB_OUTPUT: every changed path up to a bound, and how many there were. */
function compact(decision, bound = 300) {
  const changed = decision.changed.slice(0, bound);
  return JSON.stringify({ ...decision, changed, changed_count: decision.changed.length, changed_truncated: decision.changed.length > bound, inputs_hit: decision.inputs_hit.slice(0, bound), hazards: decision.hazards.slice(0, bound) });
}

function human(decision) {
  const hit = new Map(decision.inputs_hit.map((h) => [h.path, `input: ${h.pattern}`]));
  for (const h of decision.hazards) hit.set(h.path, `Windows checkout: ${h.why}`);
  const lines = [
    `Windows worker proof input gate (D-279): ${decision.run ? 'RUN IN FULL' : 'SKIP'}`,
    `  reason: ${decision.reason}`,
    `  event: ${decision.event}  base: ${decision.base}  merge base: ${decision.merge_base}  head: ${decision.head}`,
    `  gate at the merge base: ${decision.base_gate ?? 'not asked'}`,
    `  changed paths checked (${decision.changed.length}):`,
    ...decision.changed.map((p) => `    ${JSON.stringify(p)}${hit.has(p) ? `  <- ${hit.get(p)}` : ''}`),
  ];
  return lines.join('\n');
}

function main(argv) {
  const event = arg(argv, '--event');
  const base = arg(argv, '--base');
  const head = arg(argv, '--head');
  const cwd = process.cwd();
  let inputs;
  try {
    inputs = loadInputs(INPUTS_PATH);
  } catch {
    inputs = null; // decide() runs in full on a malformed list
  }
  let decision = decide({ event, base, head, inputs, git: gitAdapter(cwd) });
  if (!argv.includes('--no-base')) {
    decision = decision.run
      ? { ...decision, base_gate: 'not asked (already running in full)' }
      : combine(decision, askBaseGate({ cwd, mergeBase: decision.merge_base, event, base, head }));
  }
  const sha = typeof head === 'string' && SHA.test(head) ? head : '';
  const out = arg(argv, '--github-output');
  if (out) fs.appendFileSync(out, `run=${decision.run ? 'true' : 'false'}\nsha=${sha}\ndecision=${compact(decision)}\n`);
  const summary = arg(argv, '--summary');
  if (summary) fs.appendFileSync(summary, `\`\`\`\n${human(decision)}\n\`\`\`\n`);
  process.stdout.write(argv.includes('--json') ? `${JSON.stringify(decision)}\n` : `${human(decision)}\n`);
}

const invokedDirectly = (() => {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(SELF);
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`worker-proof-inputs: ${error.stack || error.message}\n`);
    process.exit(2);
  }
}
